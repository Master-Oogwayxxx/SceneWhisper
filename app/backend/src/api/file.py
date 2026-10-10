import asyncio
import logging
import mimetypes
import os
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, aliased

from ..api.tasks import task_manager
from ..crud.actress_work_file_state import mark_file_present
from ..crud.deleted_file import record_deleted_file
from ..crud.directory import Directory
from ..crud.file import File as FileCRUD
from ..crud.task import delete_tasks_by_ids, get_task_ids_by_file_and_statuses, get_task_ids_by_file_statuses_and_types
from ..models.models import FileQueryParams, TaskStatus, TaskType
from ..schemas.actress_work_file_state import ActressWorkFileStateRecord
from ..schemas.directory import DirectoryRecord
from ..schemas.db_helper import db_session
from ..schemas.deleted_file import DeletedFileRecord
from ..schemas.file import FileRecord
from ..schemas.scene import SceneRecord
from ..schemas.task import TaskRecord
from ..utils import utc_isoformat

_DATETIME_COLS = {"created_at", "modified_at", "last_scanned_at"}
logger = logging.getLogger(__name__)


def _file_date_range_cutoff(date_range: str, now: datetime | None = None) -> datetime | None:
    current = now or datetime.utcnow()
    range_days = {"today": 1, "last_7_days": 7, "last_30_days": 30, "last_year": 365}
    cutoffs = [
        current.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if value == "this_month"
        else current.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        if value == "this_year"
        else current - timedelta(days=range_days[value])
        for value in (item.strip() for item in date_range.split(","))
        if value in {"this_month", "this_year"} or value in range_days
    ]
    return min(cutoffs) if cutoffs else None


def _parse_file_date_bound(value: str | None, *, end_of_day: bool = False) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if end_of_day and len(value.strip()) == 10:
        return parsed.replace(hour=23, minute=59, second=59, microsecond=999999)
    return parsed


def _log_file_query_timing(endpoint: str, started_at: float, **phases: float | int) -> None:
    """Emit one searchable timing record for each file-list request."""
    logger.info(
        "file_query_timing endpoint=%s total_ms=%.1f %s",
        endpoint,
        (time.perf_counter() - started_at) * 1000,
        " ".join(
            f"{key}={value:.1f}" if isinstance(value, float) else f"{key}={value}"
            for key, value in phases.items()
        ),
    )


def _apply_status_filter(query, statuses: list[str]):
    """Apply task status filters with derived-artifact aware unprocessed semantics."""
    cleaned_statuses = [status for status in statuses if status]
    if not cleaned_statuses:
        return query

    conditions = []
    task_statuses = [status.value for status in TaskStatus if status.value in cleaned_statuses]
    if task_statuses:
        StatusTask = aliased(TaskRecord)
        conditions.append(
            select(StatusTask.id)
            .where(
                StatusTask.file_id == FileRecord.id,
                StatusTask.status.in_(task_statuses),
            )
            .exists()
        )

    legacy_file_statuses = [
        status
        for status in cleaned_statuses
        if status not in {"unprocessed", *[task_status.value for task_status in TaskStatus]}
    ]
    if legacy_file_statuses:
        conditions.append(FileRecord.status.in_(legacy_file_statuses))

    if "unprocessed" in cleaned_statuses:
        SplitChild = aliased(FileRecord)
        SubtitleChild = aliased(FileRecord)
        SrtSibling = aliased(FileRecord)
        ActiveTask = aliased(TaskRecord)
        srt_name = func.substr(
            FileRecord.name,
            1,
            func.length(FileRecord.name) - func.length(FileRecord.format) - 1,
        ).concat(".srt")
        conditions.append(
            (
                (FileRecord.status == "unprocessed")
                & (FileRecord.file_type == "video")
                & FileRecord.parent_id.is_(None)
                & (func.regexp(r"-\d{3}\.[^.]+$", FileRecord.name) == 0)
                & ~select(SceneRecord.id).where(SceneRecord.file_id == FileRecord.id).exists()
                & ~select(ActiveTask.id)
                .where(
                    ActiveTask.file_id == FileRecord.id,
                    ActiveTask.status.in_([TaskStatus.QUEUED, TaskStatus.PROCESSING, TaskStatus.PAUSED]),
                )
                .exists()
                & ~select(SplitChild.id)
                .where(
                    SplitChild.parent_id == FileRecord.id,
                    SplitChild.file_type == "video",
                    SplitChild.is_deleted.is_(False),
                )
                .exists()
                & ~select(SubtitleChild.id)
                .where(
                    SubtitleChild.parent_id == FileRecord.id,
                    SubtitleChild.file_type == "subtitle",
                    SubtitleChild.is_deleted.is_(False),
                )
                .exists()
                & ~select(SrtSibling.id)
                .where(
                    SrtSibling.directory_id == FileRecord.directory_id,
                    SrtSibling.name == srt_name,
                    SrtSibling.is_deleted.is_(False),
                )
                .correlate(FileRecord)
                .exists()
            )
        )

    return query.filter(or_(*conditions))


def _apply_file_size_filter(query, operator: str | None, size_bytes: int | None):
    if size_bytes is None:
        return query

    if operator == "lte":
        return query.filter(FileRecord.size <= size_bytes)
    if operator == "eq":
        return query.filter(FileRecord.size == size_bytes)
    return query.filter(FileRecord.size >= size_bytes)


def _new_video_condition(record):
    stem = func.substr(
        record.name,
        1,
        func.length(record.name) - func.length(record.format),
    )
    dash_count = func.length(stem) - func.length(func.replace(stem, "-", ""))
    return (
        (record.file_type == "video")
        & record.parent_id.is_(None)
        & or_(
            dash_count == 1,
            func.regexp(r"-(RM|SUB)\.[^.]+$", record.name) == 1,
        )
    )


def _apply_new_videos_filter(query, *, include_group_children: bool = False):
    """Filter to root video names with one dash, or explicit RM/SUB release suffixes."""
    condition = _new_video_condition(FileRecord)
    if include_group_children:
        NewParent = aliased(FileRecord)
        matching_parent_ids = select(NewParent.id).where(_new_video_condition(NewParent))
        condition = condition | FileRecord.parent_id.in_(matching_parent_ids)
    return query.filter(
        FileRecord.file_type == "video",
        condition,
    )


def _content_tag_condition(record, content_tag: str):
    name = func.lower(record.name)
    uncensored_marker = func.regexp(r"(^|[-_ .])(rm|un)([-_ .]|$)", name) == 1
    subtitled_marker = func.regexp(r"(^|[-_ .])sub([-_ .]|$)", name) == 1
    if content_tag == "uncensored":
        return uncensored_marker
    if content_tag == "subtitled":
        return subtitled_marker
    return ~uncensored_marker


def _apply_content_tag_filter(query, content_tag: str | None, *, include_group_children: bool = False):
    if content_tag not in {"censored", "uncensored", "subtitled"}:
        return query

    condition = _content_tag_condition(FileRecord, content_tag)
    if include_group_children:
        TaggedParent = aliased(FileRecord)
        matching_parent_ids = select(TaggedParent.id).where(_content_tag_condition(TaggedParent, content_tag))
        condition = condition | FileRecord.parent_id.in_(matching_parent_ids)

    return query.filter(FileRecord.file_type == "video", condition)


def _apply_file_type_filter(query, file_type: str | None):
    if not file_type:
        return query

    requested_types = {item.strip() for item in file_type.split(",") if item.strip()}
    if not requested_types:
        return query

    normalized_format = func.lower(func.coalesce(FileRecord.format, ""))
    normalized_name = func.lower(func.coalesce(FileRecord.name, ""))
    is_subtitle = or_(
        FileRecord.file_type == "subtitle",
        normalized_format.in_([".srt", ".vtt"]),
        normalized_name.like("%.srt"),
        normalized_name.like("%.vtt"),
    )

    conditions = []
    if "subtitle" in requested_types:
        conditions.append(is_subtitle)
    if "video" in requested_types:
        conditions.append(and_(FileRecord.file_type == "video", ~is_subtitle))
    if "other" in requested_types:
        conditions.append(and_(FileRecord.file_type == "other", ~is_subtitle))

    return query.filter(or_(*conditions)) if conditions else query.filter(False)


def _enrich_file(file: FileRecord, db: Session) -> dict:
    """Return file as dict with computed processing badge flags."""
    has_scenes = db.query(SceneRecord).filter(SceneRecord.file_id == file.id).first() is not None
    children = db.query(FileRecord).filter(FileRecord.parent_id == file.id).all()
    child_types = {c.file_type for c in children}
    raw = {col.name: getattr(file, col.name) for col in file.__table__.columns}
    for key in _DATETIME_COLS:
        if isinstance(raw.get(key), datetime):
            raw[key] = utc_isoformat(raw[key])
    return {
        **raw,
        "has_scenes": has_scenes,
        "has_split": "video" in child_types,
        "has_subtitle": "subtitle" in child_types,
    }


def _enrich_files(files: list[FileRecord], db: Session) -> list[dict]:
    """Enrich a collection with two batched queries instead of 2N queries."""
    if not files:
        return []
    file_ids = [file.id for file in files]
    scene_file_ids = {
        file_id for (file_id,) in db.query(SceneRecord.file_id)
        .filter(SceneRecord.file_id.in_(file_ids)).distinct().all()
    }
    child_types_by_parent: dict[str, set[str]] = {}
    for parent_id, file_type in db.query(FileRecord.parent_id, FileRecord.file_type).filter(
        FileRecord.parent_id.in_(file_ids)
    ).all():
        child_types_by_parent.setdefault(parent_id, set()).add(file_type)
    result = []
    for file in files:
        raw = {col.name: getattr(file, col.name) for col in file.__table__.columns}
        for key in _DATETIME_COLS:
            if isinstance(raw.get(key), datetime):
                raw[key] = utc_isoformat(raw[key])
        child_types = child_types_by_parent.get(file.id, set())
        result.append({**raw, "has_scenes": file.id in scene_file_ids,
                       "has_split": "video" in child_types,
                       "has_subtitle": "subtitle" in child_types})
    return result


router = APIRouter(prefix="/api/files")


class BulkQueueDisabledRequest(BaseModel):
    file_ids: list[str]


@router.get("/deleted-history")
async def get_deleted_history(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    file_type: str | None = Query(None),
    reason: str | None = Query(None),
    source: str | None = Query(None),
    db: Session = Depends(db_session),
):
    """Return the persistent deleted-file ledger."""
    query = db.query(DeletedFileRecord)

    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(DeletedFileRecord.name.ilike(pattern), DeletedFileRecord.path.ilike(pattern)))

    if file_type:
        file_types = [item.strip() for item in file_type.split(",") if item.strip()]
        if file_types:
            query = query.filter(DeletedFileRecord.file_type.in_(file_types))

    if reason:
        reasons = [item.strip() for item in reason.split(",") if item.strip()]
        if reasons:
            query = query.filter(DeletedFileRecord.reason.in_(reasons))

    if source:
        sources = [item.strip() for item in source.split(",") if item.strip()]
        if sources:
            query = query.filter(DeletedFileRecord.source.in_(sources))

    total = query.count()
    total_pages = (total + limit - 1) // limit
    rows = (
        query.order_by(DeletedFileRecord.deleted_at.desc(), DeletedFileRecord.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    return {
        "items": [
            {
                "id": row.id,
                "file_record_id": row.file_record_id,
                "name": row.name,
                "path": row.path,
                "size": row.size,
                "file_type": row.file_type,
                "format": row.format,
                "sha256": row.sha256,
                "directory_id": row.directory_id,
                "deleted_at": utc_isoformat(row.deleted_at) if isinstance(row.deleted_at, datetime) else row.deleted_at,
                "original_created_at": utc_isoformat(row.original_created_at) if isinstance(row.original_created_at, datetime) else row.original_created_at,
                "original_modified_at": utc_isoformat(row.original_modified_at) if isinstance(row.original_modified_at, datetime) else row.original_modified_at,
                "reason": row.reason,
                "source": row.source,
            }
            for row in rows
        ],
        "page": page,
        "limit": limit,
        "total": total,
        "totalPages": total_pages,
    }


@router.get("")
def get_files(
    params: FileQueryParams = Depends(),
    db: Session = Depends(db_session),
):
    """Server-driven files endpoint"""
    started_at = time.perf_counter()

    query = db.query(FileRecord).filter(FileRecord.is_deleted == False)  # noqa: E712

    # 🔍 Search (case-insensitive)
    if params.search:
        query = query.filter(FileRecord.name.ilike(f"%{params.search}%"))

    # 📁 Type filter
    query = _apply_file_type_filter(query, params.type)

    # 🎞 Format filter
    if params.format:
        formats = [f.strip() for f in params.format.split(",") if f.strip()]
        if formats:
            query = query.filter(FileRecord.format.in_([f".{fmt}" for fmt in formats]))

    # 📅 Date range filter — multiple ranges take the widest (earliest cutoff)
    if params.date_range:
        cutoff = _file_date_range_cutoff(params.date_range)
        if cutoff:
            query = query.filter(FileRecord.created_at >= cutoff)
    date_from = _parse_file_date_bound(params.date_from)
    if date_from:
        query = query.filter(FileRecord.created_at >= date_from)
    date_to = _parse_file_date_bound(params.date_to, end_of_day=True)
    if date_to:
        query = query.filter(FileRecord.created_at <= date_to)

    # 📁 Directory filter
    if params.directory_id:
        directory_ids = [d.strip() for d in params.directory_id.split(",") if d.strip()]
        if directory_ids:
            if params.directory_exclude:
                query = query.filter(~FileRecord.directory_id.in_(directory_ids))
            else:
                query = query.filter(FileRecord.directory_id.in_(directory_ids))

    # 🎬 Processing filters — only apply to video root files (no parent) without number suffix
    _no_suffix = func.regexp(r"-\d{3}\.[^.]+$", FileRecord.name) == 0
    if params.has_scenes:
        query = query.filter(
            FileRecord.id.in_(select(SceneRecord.file_id).distinct()),
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
        )
    if params.has_split:
        query = query.filter(
            FileRecord.id.in_(
                select(FileRecord.parent_id)
                .where(
                    FileRecord.parent_id.isnot(None),
                    FileRecord.file_type == "video",
                )
                .distinct()
            ),
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
        )
    if params.has_subtitle:
        query = query.filter(
            FileRecord.id.in_(
                select(FileRecord.parent_id)
                .where(
                    FileRecord.parent_id.isnot(None),
                    FileRecord.file_type == "subtitle",
                )
                .distinct()
            ),
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
        )

    # Negation filters — only apply to video root files (no parent) without number suffix
    if params.has_no_scenes:
        query = query.filter(
            ~FileRecord.id.in_(select(SceneRecord.file_id).distinct()),
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
        )
    if params.has_no_split:
        query = query.filter(
            ~FileRecord.id.in_(
                select(FileRecord.parent_id)
                .where(
                    FileRecord.parent_id.isnot(None),
                    FileRecord.file_type == "video",
                )
                .distinct()
            ),
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
        )
    # 🎬 Scene count filter — exact match, only for video root files (no parent)
    if params.scene_count is not None:
        scene_counts = select(SceneRecord.file_id, func.count(SceneRecord.id).label("scene_cnt")).group_by(SceneRecord.file_id).subquery()
        query = query.outerjoin(scene_counts, FileRecord.id == scene_counts.c.file_id)
        query = query.filter(
            FileRecord.file_type == "video", FileRecord.parent_id.is_(None), (scene_counts.c.scene_cnt == params.scene_count) | ((scene_counts.c.scene_cnt.is_(None)) & (params.scene_count == 0))
        )

    # 📋 Status filter
    if params.status:
        statuses = [s.strip() for s in params.status.split(",") if s.strip()]
        query = _apply_status_filter(query, statuses)

    # 🚫 Queue disabled filter — only for video root files (no parent)
    if params.queue_disabled is not None:
        query = query.filter(FileRecord.queue_disabled == params.queue_disabled, FileRecord.file_type == "video", FileRecord.parent_id.is_(None))
    if params.split_disabled is not None:
        query = query.filter(FileRecord.split_disabled == params.split_disabled, FileRecord.file_type == "video", FileRecord.parent_id.is_(None))
    if params.subtitle_disabled is not None:
        query = query.filter(FileRecord.subtitle_disabled == params.subtitle_disabled, FileRecord.file_type == "video", FileRecord.parent_id.is_(None))

    # 🔢 No number suffix filter — only for video files
    if params.no_number_suffix:
        query = query.filter(FileRecord.file_type == "video", func.regexp(r"-\d{3}\.[^.]+$", FileRecord.name) == 0)

    # 🆕 New filter — videos with one dash, or RM/SUB release variants
    if params.new_videos:
        query = _apply_new_videos_filter(query)

    if params.content_tag:
        query = _apply_content_tag_filter(query, params.content_tag)

    # 📺 Resolution filter — filter by height bucket
    if params.resolution:
        resolutions = [r.strip() for r in params.resolution.split(",") if r.strip()]
        conditions = []
        for res in resolutions:
            if res == "480p":
                conditions.append(FileRecord.height <= 480)
            elif res == "720p":
                conditions.append((FileRecord.height > 480) & (FileRecord.height <= 720))
            elif res == "1080p":
                conditions.append((FileRecord.height > 720) & (FileRecord.height <= 1080))
            elif res == "1440p":
                conditions.append((FileRecord.height > 1080) & (FileRecord.height <= 1440))
            elif res == "4k":
                conditions.append(FileRecord.height > 1440)
        if conditions:
            query = query.filter(or_(*conditions))

    query = _apply_file_size_filter(query, params.file_size_operator, params.file_size_bytes)

    # 🔀 Sorting (safe whitelist)
    sort_map = {
        "name": FileRecord.name,
        "size": FileRecord.size,
        "created_at": FileRecord.created_at,
        "modified_at": FileRecord.modified_at,
        "duration": FileRecord.duration,
    }

    if params.sort_by == "folder_name":
        folder_sort_column = func.lower(func.coalesce(DirectoryRecord.name, ""))
        query = query.outerjoin(DirectoryRecord, FileRecord.directory_id == DirectoryRecord.id)
        if params.sort_dir == "asc":
            query = query.order_by(folder_sort_column.asc(), FileRecord.name.asc())
        else:
            query = query.order_by(folder_sort_column.desc(), FileRecord.name.asc())
    else:
        sort_column = sort_map.get(params.sort_by, FileRecord.created_at)

        if params.sort_dir == "asc":
            query = query.order_by(sort_column.asc(), FileRecord.id.asc())
        else:
            query = query.order_by(sort_column.desc(), FileRecord.id.asc())

    # 🔤 has_no_subtitle: Python-level check — keep files whose sibling .srt doesn't exist in DB
    if params.has_no_subtitle:
        SrtSibling = aliased(FileRecord)
        srt_name = func.substr(FileRecord.name, 1, func.length(FileRecord.name) - func.length(FileRecord.format) - 1).concat(".srt")
        query = query.filter(or_(FileRecord.file_type != "video", ~select(SrtSibling.id).where(
            SrtSibling.directory_id == FileRecord.directory_id,
            SrtSibling.name == srt_name,
            SrtSibling.is_deleted.is_(False),
        ).correlate(FileRecord).exists()))

    count_started_at = time.perf_counter()
    # Counting an ordered SQLAlchemy query makes SQLite sort the full filtered
    # result inside the COUNT subquery. Ordering is only needed for the page.
    total = query.order_by(None).count()
    count_ms = (time.perf_counter() - count_started_at) * 1000
    total_pages = (total + params.limit - 1) // params.limit

    # 📄 Pagination
    offset = (params.page - 1) * params.limit
    fetch_started_at = time.perf_counter()
    files = query.offset(offset).limit(params.limit).all()
    fetch_ms = (time.perf_counter() - fetch_started_at) * 1000
    enrich_started_at = time.perf_counter()
    enriched_files = _enrich_files(files, db)
    enrich_ms = (time.perf_counter() - enrich_started_at) * 1000

    _log_file_query_timing(
        "files",
        started_at,
        count_ms=count_ms,
        fetch_ms=fetch_ms,
        enrich_ms=enrich_ms,
        matched=total,
        returned=len(files),
    )

    return {
        "files": enriched_files,
        "page": params.page,
        "limit": params.limit,
        "total": total,
        "totalPages": total_pages,
    }


@router.get("/grouped")
def get_grouped_files(
    params: FileQueryParams = Depends(),
    db: Session = Depends(db_session),
):
    """Return files grouped by parent_id with filtering/sorting/pagination matching get_files.

    Each group includes the parent file itself plus its children, sorted ascending by name.
    Pagination applies to the number of groups returned, not individual files.
    """
    started_at = time.perf_counter()
    query = db.query(FileRecord).filter(FileRecord.is_deleted == False)  # noqa: E712

    if params.search:
        query = query.filter(FileRecord.name.ilike(f"%{params.search}%"))

    query = _apply_file_type_filter(query, params.type)

    if params.format:
        formats = [f.strip() for f in params.format.split(",") if f.strip()]
        if formats:
            query = query.filter(FileRecord.format.in_([f".{fmt}" for fmt in formats]))

    if params.date_range:
        cutoff = _file_date_range_cutoff(params.date_range)
        if cutoff:
            query = query.filter(FileRecord.created_at >= cutoff)
    date_from = _parse_file_date_bound(params.date_from)
    if date_from:
        query = query.filter(FileRecord.created_at >= date_from)
    date_to = _parse_file_date_bound(params.date_to, end_of_day=True)
    if date_to:
        query = query.filter(FileRecord.created_at <= date_to)

    if params.directory_id:
        directory_ids = [d.strip() for d in params.directory_id.split(",") if d.strip()]
        if directory_ids:
            if params.directory_exclude:
                query = query.filter(~FileRecord.directory_id.in_(directory_ids))
            else:
                query = query.filter(FileRecord.directory_id.in_(directory_ids))

    _no_suffix = func.regexp(r"-\d{3}\.[^.]+$", FileRecord.name) == 0
    if params.has_scenes:
        query = query.filter(
            FileRecord.id.in_(select(SceneRecord.file_id).distinct()),
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
            _no_suffix,
        )
    if params.has_split:
        query = query.filter(
            FileRecord.id.in_(
                select(FileRecord.parent_id)
                .where(
                    FileRecord.parent_id.isnot(None),
                    FileRecord.file_type == "video",
                )
                .distinct()
            ),
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
            _no_suffix,
        )
    if params.has_subtitle:
        SrtSiblingPos = aliased(FileRecord)
        srt_name_pos = func.substr(
            FileRecord.name,
            1,
            func.length(FileRecord.name) - func.length(FileRecord.format) - 1,
        ).concat(".srt")
        query = query.filter(
            FileRecord.id.in_(
                select(FileRecord.id).where(
                    FileRecord.format.isnot(None),
                    select(SrtSiblingPos.id)
                    .where(
                        SrtSiblingPos.directory_id == FileRecord.directory_id,
                        SrtSiblingPos.name == srt_name_pos,
                        SrtSiblingPos.is_deleted.is_(False),
                    )
                    .correlate(FileRecord)
                    .exists(),
                )
            ),
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
            _no_suffix,
        )

    # Negation filters — only apply to video root files (no parent) without number suffix
    if params.has_no_scenes:
        query = query.filter(
            ~FileRecord.id.in_(select(SceneRecord.file_id).distinct()),
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
            _no_suffix,
        )
    if params.has_no_split:
        query = query.filter(
            ~FileRecord.id.in_(
                select(FileRecord.parent_id)
                .where(
                    FileRecord.parent_id.isnot(None),
                    FileRecord.file_type == "video",
                )
                .distinct()
            ),
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
            _no_suffix,
        )
    # 🎬 Scene count filter — exact match, only for video root files (no parent)
    if params.scene_count is not None:
        scene_counts = select(SceneRecord.file_id, func.count(SceneRecord.id).label("scene_cnt")).group_by(SceneRecord.file_id).subquery()
        query = query.outerjoin(scene_counts, FileRecord.id == scene_counts.c.file_id)
        query = query.filter(
            FileRecord.file_type == "video", FileRecord.parent_id.is_(None), (scene_counts.c.scene_cnt == params.scene_count) | ((scene_counts.c.scene_cnt.is_(None)) & (params.scene_count == 0))
        )

    # 📋 Status filter
    if params.status:
        statuses = [s.strip() for s in params.status.split(",") if s.strip()]
        query = _apply_status_filter(query, statuses)

    # 🚫 Queue disabled filter — only for video root files (no parent)
    if params.queue_disabled is not None:
        query = query.filter(FileRecord.queue_disabled == params.queue_disabled, FileRecord.file_type == "video", FileRecord.parent_id.is_(None))
    if params.split_disabled is not None:
        query = query.filter(FileRecord.split_disabled == params.split_disabled, FileRecord.file_type == "video", FileRecord.parent_id.is_(None))
    if params.subtitle_disabled is not None:
        query = query.filter(FileRecord.subtitle_disabled == params.subtitle_disabled, FileRecord.file_type == "video", FileRecord.parent_id.is_(None))

    # 🔢 No number suffix filter — only for video files
    if params.no_number_suffix:
        query = query.filter(FileRecord.file_type == "video", func.regexp(r"-\d{3}\.[^.]+$", FileRecord.name) == 0)

    # 🆕 New filter — videos with one dash, or RM/SUB release variants
    if params.new_videos:
        query = _apply_new_videos_filter(query, include_group_children=True)

    if params.content_tag:
        query = _apply_content_tag_filter(query, params.content_tag, include_group_children=True)

    # 📺 Resolution filter — filter by height bucket
    if params.resolution:
        resolutions = [r.strip() for r in params.resolution.split(",") if r.strip()]
        conditions = []
        for res in resolutions:
            if res == "480p":
                conditions.append(FileRecord.height <= 480)
            elif res == "720p":
                conditions.append((FileRecord.height > 480) & (FileRecord.height <= 720))
            elif res == "1080p":
                conditions.append((FileRecord.height > 720) & (FileRecord.height <= 1080))
            elif res == "1440p":
                conditions.append((FileRecord.height > 1080) & (FileRecord.height <= 1440))
            elif res == "4k":
                conditions.append(FileRecord.height > 1440)
        if conditions:
            query = query.filter(or_(*conditions))

    query = _apply_file_size_filter(query, params.file_size_operator, params.file_size_bytes)

    # Keep this in SQL so grouped retrieval does not issue one sibling lookup per file.
    if params.has_no_subtitle:
        SrtSibling = aliased(FileRecord)
        srt_name = func.substr(FileRecord.name, 1, func.length(FileRecord.name) - func.length(FileRecord.format) - 1).concat(".srt")
        query = query.filter(or_(FileRecord.file_type != "video", ~select(SrtSibling.id).where(
            SrtSibling.directory_id == FileRecord.directory_id,
            SrtSibling.name == srt_name,
            SrtSibling.is_deleted.is_(False),
        ).correlate(FileRecord).exists()))

    # Count and paginate group IDs in SQLite before loading or enriching members.
    group_id = func.coalesce(FileRecord.parent_id, FileRecord.id).label("group_id")
    root_sort_columns = {
        "name": func.lower(func.coalesce(FileRecord.name, "")),
        "size": func.coalesce(FileRecord.size, 0),
        "created_at": FileRecord.created_at,
        "modified_at": FileRecord.modified_at,
        "duration": func.coalesce(FileRecord.duration, ""),
    }
    if params.sort_by == "folder_name":
        query = query.outerjoin(DirectoryRecord, FileRecord.directory_id == DirectoryRecord.id)
        selected_sort_column = func.lower(func.coalesce(DirectoryRecord.name, ""))
    else:
        selected_sort_column = root_sort_columns.get(params.sort_by, root_sort_columns["name"])

    group_sort = func.max(case((FileRecord.id == group_id, selected_sort_column), else_=None)).label("group_sort")
    grouped_query = query.with_entities(group_id, group_sort).group_by(group_id)

    count_started_at = time.perf_counter()
    total = grouped_query.count()
    count_ms = (time.perf_counter() - count_started_at) * 1000
    total_pages = (total + params.limit - 1) // params.limit
    offset = (params.page - 1) * params.limit
    order = group_sort.asc() if params.sort_dir == "asc" else group_sort.desc()

    group_page_started_at = time.perf_counter()
    page_group_ids = [
        row.group_id
        for row in grouped_query.order_by(order, group_id.asc()).offset(offset).limit(params.limit).all()
    ]
    group_page_ms = (time.perf_counter() - group_page_started_at) * 1000

    fetch_started_at = time.perf_counter()
    files = query.filter(group_id.in_(page_group_ids)).all() if page_group_ids else []
    fetch_ms = (time.perf_counter() - fetch_started_at) * 1000
    files_by_id = {file.id: file for file in files}
    grouped_members = {current_group_id: [] for current_group_id in page_group_ids}
    for file in files:
        grouped_members[file.parent_id or file.id].append(file)

    enrich_started_at = time.perf_counter()
    enriched_files = {item["id"]: item for item in _enrich_files(files, db)}
    result = {}
    for current_group_id in page_group_ids:
        members = grouped_members[current_group_id]
        children = [file for file in members if file.parent_id]
        parent = files_by_id.get(current_group_id)
        ordered_members = sorted(children, key=lambda file: (file.name or "").lower())
        if parent:
            ordered_members.append(parent)
        result[current_group_id] = [enriched_files[file.id] for file in ordered_members]
    enrich_ms = (time.perf_counter() - enrich_started_at) * 1000

    _log_file_query_timing(
        "files_grouped",
        started_at,
        count_ms=count_ms,
        group_page_ms=group_page_ms,
        fetch_ms=fetch_ms,
        enrich_ms=enrich_ms,
        matched_groups=total,
        returned_groups=len(result),
        returned_files=len(files),
    )

    return {
        "groups": result,
        "page": params.page,
        "limit": params.limit,
        "total": total,
        "totalPages": total_pages,
    }


@router.get("/{file_id}/children-and-self")
async def get_file_with_children(file_id: str, db: Session = Depends(db_session)):
    """Return a file plus all its children (processed outputs like splits/subtitles)."""
    service = FileCRUD(db)

    parent_file = service.get_file_metadata(file_id=file_id)
    if not parent_file:
        raise HTTPException(status_code=404, detail="File not found")

    children = db.query(FileRecord).filter(FileRecord.parent_id == file_id).all()
    linked_ids = {c.id for c in children}

    # Discover unlinked SRT siblings (generated by subtitle tasks whose tracking failed
    # or ran before the DB-based tracking fix).  Match: {stem}.srt and {stem}-NNN.srt.
    try:
        import glob as _glob

        parent_path = Path(parent_file.path)
        stem = parent_path.stem
        parent_dir = str(parent_path.parent)
        srt_candidates: list[str] = _glob.glob(os.path.join(parent_dir, f"{stem}.srt"))
        srt_candidates += _glob.glob(os.path.join(parent_dir, f"{stem}-[0-9][0-9][0-9].srt"))
        for srt_path in srt_candidates:
            srt_record = db.query(FileRecord).filter(FileRecord.path == srt_path).first()
            if srt_record is None or srt_record.id in linked_ids:
                continue
            # Auto-link the orphaned SRT so future calls return it via parent_id query.
            srt_record.parent_id = file_id
            db.commit()
            db.refresh(srt_record)
            children.append(srt_record)
            linked_ids.add(srt_record.id)
    except Exception:
        pass  # Never break the read path over a linking side-effect

    return {
        "files": [_enrich_file(parent_file, db)] + [_enrich_file(c, db) for c in children],
    }


@router.api_route("/{file_id}/stream", methods=["GET", "HEAD"])
async def stream_file(file_id: str, request: Request, db: Session = Depends(db_session)):
    """Stream a video file with range-request support for browser seeking."""
    service = FileCRUD(db)
    file_record = service.get_file_metadata(file_id=file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")
    if file_record.file_type != "video":
        raise HTTPException(status_code=400, detail="File is not a video")
    if not os.path.exists(file_record.path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    media_type, _ = mimetypes.guess_type(file_record.path)
    content_type = media_type or "application/octet-stream"
    file_size = os.path.getsize(file_record.path)
    range_header = request.headers.get("range")

    if range_header:
        range_val = range_header.strip().replace("bytes=", "")
        start_str, _, end_str = range_val.partition("-")
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        end = min(end, file_size - 1)
        chunk_size = end - start + 1

        def iter_file():
            with open(file_record.path, "rb") as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    data = f.read(min(65536, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            iter_file(),
            status_code=206,
            media_type=content_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
            },
        )

    def iter_full():
        with open(file_record.path, "rb") as f:
            while chunk := f.read(65536):
                yield chunk

    return StreamingResponse(
        iter_full(),
        media_type=content_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        },
    )


@router.get("/{file_id}")
async def get_file(file_id: str, db: Session = Depends(db_session)):
    """Get a specific file metadata record"""
    service = FileCRUD(db)

    file_record = service.get_file_with_parent(file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")
    return _enrich_file(file_record, db)


@router.get("/{file_id}/content")
async def get_file_content(file_id: str, db: Session = Depends(db_session)):
    """Read raw text content of an SRT subtitle file."""
    service = FileCRUD(db)
    file_record = service.get_file_metadata(file_id=file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")
    if not file_record.format.lower() == ".srt":
        raise HTTPException(status_code=400, detail="File is not an SRT subtitle")
    try:
        with open(file_record.path, "r", encoding="utf-8") as f:
            content = f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found on disk")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {str(e)}")
    return {"content": content}


class SubtitleContentUpdate(BaseModel):
    content: str


@router.put("/{file_id}/content")
async def save_file_content(file_id: str, body: SubtitleContentUpdate, db: Session = Depends(db_session)):
    """Overwrite raw text content of an SRT subtitle file."""
    service = FileCRUD(db)
    file_record = service.get_file_metadata(file_id=file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")
    if not file_record.format.lower() == ".srt":
        raise HTTPException(status_code=400, detail="File is not an SRT subtitle")
    try:
        with open(file_record.path, "w", encoding="utf-8") as f:
            f.write(body.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error writing file: {str(e)}")
    return {"message": "File saved successfully"}


@router.get("/{file_id}/parent")
async def get_file_parent(file_id: str, db: Session = Depends(db_session)):
    """Get the parent file of a given file"""
    service = FileCRUD(db)

    parent_file = service.get_parent_of_file(file_id)
    if not parent_file:
        raise HTTPException(status_code=404, detail="Parent file not found")
    return parent_file


@router.get("/{file_id}/children")
async def get_file_children(file_id: str, db: Session = Depends(db_session)):
    """Get all child files of a given file"""
    service = FileCRUD(db)

    children_files = service.get_children_of_file(file_id)
    return children_files


class RenameFileRequest(BaseModel):
    new_name: str

    @field_validator("new_name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("new_name cannot be empty")
        if "/" in v or "\\" in v:
            raise ValueError("new_name cannot contain path separators")
        return v


class MoveFileRequest(BaseModel):
    destination_directory_id: str

    @field_validator("destination_directory_id")
    @classmethod
    def validate_destination_directory_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("destination_directory_id cannot be empty")
        return value


@router.patch("/{file_id}/rename")
async def rename_file(file_id: str, body: RenameFileRequest, db: Session = Depends(db_session)):
    """Rename a file on disk and in the DB."""
    service = FileCRUD(db)
    record = service.get_file_metadata(file_id=file_id)
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    old_ext = os.path.splitext(record.name)[1].lower()
    new_ext = os.path.splitext(body.new_name)[1].lower()
    if old_ext != new_ext:
        raise HTTPException(status_code=422, detail="Cannot change file extension during rename")

    old_path = record.path
    parent_dir = os.path.dirname(old_path)
    new_path = os.path.join(parent_dir, body.new_name)
    same_path = os.path.normcase(os.path.abspath(old_path)) == os.path.normcase(os.path.abspath(new_path))

    if os.path.exists(new_path) and not same_path:
        raise HTTPException(status_code=409, detail="A file with that name already exists")

    destination_record = (
        db.query(FileRecord)
        .filter(FileRecord.path == new_path, FileRecord.id != record.id)
        .first()
    )
    if destination_record:
        if not destination_record.is_deleted:
            raise HTTPException(status_code=409, detail="A file with that name already exists in the database")
        # Files removed after task completion remain as hidden metadata rows. Once
        # the path is reused, the deleted-file ledger is the historical owner and
        # the stale FileRecord must release the unique files.path value.
        try:
            db.delete(destination_record)
            db.flush()
        except Exception as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to prepare deleted file metadata for rename: {e}")

    renamed_on_disk = False
    if os.path.exists(old_path) and old_path != new_path:
        try:
            os.rename(old_path, new_path)
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Failed to rename file on disk: {e}")
        renamed_on_disk = True

    try:
        record.name = body.new_name
        record.path = new_path
        # Matching state is keyed by path, which may already have a deleted entry.
        # Reuse the destination state without changing the deletion history ledger.
        db.query(ActressWorkFileStateRecord).filter(
            ActressWorkFileStateRecord.path == old_path,
            ActressWorkFileStateRecord.path != new_path,
            ActressWorkFileStateRecord.file_record_id == record.id,
        ).delete(synchronize_session=False)
        mark_file_present(db, record)
        db.flush()
        response = _enrich_file(record, db)
        db.commit()
    except Exception as e:
        db.rollback()
        if renamed_on_disk and os.path.exists(new_path) and not os.path.exists(old_path):
            try:
                os.rename(new_path, old_path)
            except OSError:
                pass
        raise HTTPException(status_code=500, detail=f"Failed to update file metadata after rename: {e}")

    return response


@router.patch("/{file_id}/move")
async def move_file(file_id: str, body: MoveFileRequest, db: Session = Depends(db_session)):
    """Move a file on disk and in the DB."""
    service = FileCRUD(db)
    record = service.get_file_metadata(file_id=file_id)
    if not record:
        raise HTTPException(status_code=404, detail="File not found")

    destination_directory = db.query(DirectoryRecord).filter(DirectoryRecord.id == body.destination_directory_id).first()
    if destination_directory is None:
        raise HTTPException(status_code=404, detail="Destination directory not found")

    old_path = Path(record.path)
    destination_path = Path(destination_directory.path)

    if not old_path.exists():
        raise HTTPException(status_code=404, detail="File path does not exist on disk")
    if not destination_path.is_dir():
        raise HTTPException(status_code=404, detail="Destination directory path does not exist on disk")
    if record.directory_id == destination_directory.id:
        raise HTTPException(status_code=422, detail="File is already in that directory")

    new_path = destination_path / record.name
    if new_path.exists():
        raise HTTPException(status_code=409, detail="A file with that name already exists in the destination")

    try:
        shutil.move(str(old_path), str(new_path))
    except (OSError, shutil.Error) as exc:
        raise HTTPException(status_code=500, detail=f"Failed to move file on disk: {exc}")

    state_record = db.query(ActressWorkFileStateRecord).filter(ActressWorkFileStateRecord.path == record.path).first()

    record.path = str(new_path)
    record.directory_id = destination_directory.id
    if state_record is not None:
        state_record.path = record.path
        state_record.file_name = record.name

    db.commit()
    db.refresh(record)
    return _enrich_file(record, db)


@router.patch("/{file_id}/queue-disabled")
async def toggle_queue_disabled(file_id: str, db: Session = Depends(db_session)):
    """Toggle the queue_disabled flag for a file. When disabling, cancels and deletes all queued/processing tasks."""
    service = FileCRUD(db)

    # Read current state before toggling
    current = service.get_file_metadata(file_id=file_id)
    if not current:
        raise HTTPException(status_code=404, detail="File not found")

    was_enabled = not current.queue_disabled
    record = service.toggle_queue_disabled(file_id)

    if was_enabled:
        # File just became disabled — clean up active tasks
        task_ids = get_task_ids_by_file_and_statuses(file_id, ["queued", "processing"])
        await asyncio.gather(*(task_manager.cancel_task(tid, reason="file disabled from queue") for tid in task_ids))
        delete_tasks_by_ids(task_ids)

    return _enrich_file(record, db)


@router.patch("/queue-disabled/bulk-disable")
async def bulk_disable_queue_disabled(body: BulkQueueDisabledRequest, db: Session = Depends(db_session)):
    """Disable queue processing for multiple files and cancel queued/processing tasks."""
    service = FileCRUD(db)

    records = service.set_queue_disabled(body.file_ids, True)
    if not records:
        raise HTTPException(status_code=404, detail="No files found")

    task_ids: list[str] = []
    for file_id in body.file_ids:
        task_ids.extend(get_task_ids_by_file_and_statuses(file_id, ["queued", "processing"]))

    if task_ids:
        await asyncio.gather(*(task_manager.cancel_task(tid, reason="file disabled from queue") for tid in task_ids))
        delete_tasks_by_ids(task_ids)

    return [_enrich_file(record, db) for record in records]


@router.patch("/queue-disabled/bulk-enable")
async def bulk_enable_queue_disabled(body: BulkQueueDisabledRequest, db: Session = Depends(db_session)):
    """Enable queue processing for multiple files."""
    service = FileCRUD(db)

    records = service.set_queue_disabled(body.file_ids, False)
    if not records:
        raise HTTPException(status_code=404, detail="No files found")

    return [_enrich_file(record, db) for record in records]


@router.patch("/{task_type}-disabled/bulk-disable")
async def bulk_disable_task_type(task_type: str, body: BulkQueueDisabledRequest, db: Session = Depends(db_session)):
    """Disable split/subtitle processing for multiple files and cancel matching active tasks."""
    if task_type not in {"split", "subtitle"}:
        raise HTTPException(status_code=422, detail="task_type must be split or subtitle")

    service = FileCRUD(db)
    records = service.set_task_type_disabled(body.file_ids, task_type, True)
    if not records:
        raise HTTPException(status_code=404, detail="No files found")

    matching_types = [TaskType.SPLIT, TaskType.ALL] if task_type == "split" else [TaskType.SUBTITLE, TaskType.ALL]
    task_ids: list[str] = []
    for file_id in body.file_ids:
        task_ids.extend(get_task_ids_by_file_statuses_and_types(file_id, ["queued", "processing"], matching_types))

    if task_ids:
        await asyncio.gather(*(task_manager.cancel_task(tid, reason=f"file disabled from {task_type}") for tid in task_ids))
        delete_tasks_by_ids(task_ids)

    return [_enrich_file(record, db) for record in records]


@router.patch("/{task_type}-disabled/bulk-enable")
async def bulk_enable_task_type(task_type: str, body: BulkQueueDisabledRequest, db: Session = Depends(db_session)):
    """Enable split/subtitle processing for multiple files."""
    if task_type not in {"split", "subtitle"}:
        raise HTTPException(status_code=422, detail="task_type must be split or subtitle")

    service = FileCRUD(db)
    records = service.set_task_type_disabled(body.file_ids, task_type, False)
    if not records:
        raise HTTPException(status_code=404, detail="No files found")

    return [_enrich_file(record, db) for record in records]


@router.delete("/{file_id}")
async def delete_file(
    file_id: str,
    delete_from_disk: bool = Query(True),
    delete_from_database: bool = Query(True),
    db: Session = Depends(db_session),
):
    """Delete a specific file by its ID"""

    if not delete_from_disk and not delete_from_database:
        raise HTTPException(status_code=400, detail="Choose at least one delete target")

    service = FileCRUD(db)

    file_record = service.get_file_metadata(file_id=file_id)
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        if delete_from_database:
            record_deleted_file(db, file_record, reason="manual_file_delete", source="file_api")
            db.delete(file_record)

        if delete_from_disk:
            try:
                os.remove(file_record.path)
            except FileNotFoundError:
                pass

        db.commit()

        return {"message": f"Successfully deleted file {file_id}"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting file: {str(e)}")


@router.get("/{path:path}")
async def get_files_in_directory(path: str, db: Session = Depends(db_session)):
    """List all files in a specific directory by path"""

    service = Directory(db)
    files = service.get_file_metadata(path=path)
    if not files:
        raise HTTPException(status_code=404, detail="Directory not found or no files in directory")
    return files
