"""R18.dev reference database API routes."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from urllib.parse import quote_plus
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..crud import r18_actress
from ..crud.download_queue import clear_done as clear_done_queue
from ..crud.download_queue import delete_queue_item, enqueue_works, get_all_queue, get_failed_torrent_urls, mark_processing_by_content_id, retry_queue_item
from ..crud.torrent_tracking import (
    delete_tracking_by_content_id,
    delete_tracking_by_video_code,
    get_all_tracking,
    get_tracking_by_content_id,
    get_tracking_by_video_code,
    insert_tracking,
    is_within_missing_torrent_grace_period,
    update_hash,
    update_status,
)
from ..models.models import ActressDetail, ActressesResponse, ActressSummary, ActressWork, ActressWorksResponse, DownloadQueueStatus, R18ImportStatus, R18Status, TorrentStatus
from ..schemas import db_helper as _dbh
from ..schemas.db_helper import db_session
from ..schemas.actress_work_file_state import ActressWorkFileStateRecord
from ..schemas.download_queue import DownloadQueueRecord
from ..schemas.file import FileRecord
from ..schemas.r18_db import ensure_r18_indexes, get_import_status, r18_db_ready, read_metadata, save_uploaded_gz, schedule_import_from_url, schedule_import_r18_sql_gz
from ..utils.qbit import delete_torrent as _delete_torrent
from ..utils.qbit import find_torrent_hash_by_name as _find_torrent_hash
from ..utils.qbit import send_to_qbit as _send_to_qbit

router = APIRouter(prefix="/api/r18", tags=["r18"])

LATEST_DUMP_URL = "https://r18.dev/dumps/latest"

_translation_cache: dict[str, str] = {}
_r18_indexes_checked = False
QBIT_QUEUED_STATES = {
    "queuedDL",
    "metaDL",
    "checkingDL",
    "checkingResumeData",
    "pausedDL",
    "stoppedDL",
}


def _ensure_r18_indexes_once() -> None:
    global _r18_indexes_checked
    if _r18_indexes_checked:
        return
    ensure_r18_indexes()
    _r18_indexes_checked = True


async def _run_with_db_session(func):
    """Run synchronous app-DB work off the event loop with a worker-owned session."""
    loop = asyncio.get_running_loop()

    def _run():
        db = _dbh.SessionLocal()
        try:
            return func(db)
        finally:
            db.close()

    return await loop.run_in_executor(None, _run)


class ImportFromUrlBody(BaseModel):
    """Request body for server-side dump download."""

    url: str = Field(default=LATEST_DUMP_URL)


class NyaaResult(BaseModel):
    title: str
    torrent_url: str
    magnet_url: str | None = None
    seeders: int
    size: str
    was_tried: bool = False


class ActressMagnetExportResponse(BaseModel):
    actress_name: str
    queries: list[str]
    magnets: list[str]


class DownloadRequest(BaseModel):
    torrent_url: str
    video_code: str
    content_id: str
    category: str | None = None
    tags: list[str] | None = None
    save_path: str | None = None


class WorkOpenedRequest(BaseModel):
    content_id: str


class WorksOpenedRequest(BaseModel):
    content_ids: list[str]


def _build_qbit_labels(
    content_id: str | None,
    category: str | None = None,
    tags: list[str] | None = None,
) -> tuple[str | None, list[str] | None]:
    """Return qBittorrent category and tags, applying repo defaults when omitted."""
    resolved_category = category.strip() if category and category.strip() else "Scene Whisper"

    cleaned_tags: list[str] = []
    if tags:
        for tag in tags:
            if tag and tag.strip() and tag.strip() not in cleaned_tags:
                cleaned_tags.append(tag.strip())

    if not cleaned_tags and content_id:
        cleaned_tags.extend(r18_actress.get_actress_names_by_content_id(content_id))

    return resolved_category, cleaned_tags or None


def _actress_magnet_queries(row: dict) -> list[str]:
    queries: list[str] = []
    for value in (
        row.get("display_name"),
        row.get("name_romaji"),
        row.get("name_kanji"),
        row.get("name_kana"),
    ):
        if not value:
            continue
        query = str(value).strip()
        if query and query not in queries:
            queries.append(query)
    return queries


def _extract_video_code_from_title(title: str) -> str | None:
    match = re.search(r"\b([A-Z]{2,10})[-_\s]?(\d{2,5})\b", title.upper())
    if not match:
        return None
    return f"{match.group(1)}-{match.group(2).zfill(3)}"


def _is_uncensored_or_reduced_mosaic_title(title: str) -> bool:
    lowered = title.lower()
    return any(
        keyword in lowered
        for keyword in (
            "uncensored",
            "reduced mosaic",
            "reducing mosaic",
            "reduced-mosaic",
            "mosaic removed",
            "mosaicless",
            "no mosaic",
            "de-mosaic",
        )
    )


def _is_uncensored_or_reduced_mosaic_file_name(file_name: str) -> bool:
    stem = Path(file_name).stem.lower()
    return (
        "-rm" in stem
        or "_rm" in stem
        or _is_uncensored_or_reduced_mosaic_title(file_name)
    )


def _actress_magnet_candidate_rank(title: str, seeders: int) -> tuple[int, int, int, int, int]:
    lowered = title.lower()
    uncensored_or_rm = _is_uncensored_or_reduced_mosaic_title(title)
    return (
        int(uncensored_or_rm),
        int("4k" in lowered or "2160p" in lowered or "uhd" in lowered),
        int("fhd" in lowered or "full hd" in lowered or "1080p" in lowered),
        int("hd" in lowered or "720p" in lowered),
        seeders,
    )


def _indexed_file_names_for_code(video_code: str, db: Session) -> list[str]:
    rows = (
        db.query(FileRecord.name)
        .filter(FileRecord.is_deleted == False, FileRecord.name.ilike(f"%{video_code}%"))  # noqa: E712
        .all()
    )
    return [row[0] for row in rows if row[0]]


def _fetch_actress_magnets_for_queries(queries: list[str], db: Session) -> list[str]:
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
    magnets_without_code: list[str] = []
    candidates_by_code: dict[str, dict[str, object]] = {}
    seen_uncoded_magnets: set[str] = set()
    max_pages = 14

    for query in queries:
        for page in range(1, max_pages + 1):
            url = f"https://sukebei.nyaa.si/?page=rss&f=0&c=0_0&q={quote_plus(query)}&p={page}"
            try:
                resp = httpx.get(url, timeout=10, follow_redirects=True, headers=headers)
                resp.raise_for_status()
                root = ET.fromstring(resp.text)
            except Exception as exc:
                logging.warning("Actress magnet export fetch failed for %s page %s: %s", query, page, exc)
                break

            ns = {"nyaa": "https://sukebei.nyaa.si/xmlns/nyaa"}
            items = root.findall(".//item")
            if not items:
                break

            for item in items:
                title_el = item.find("title")
                link_el = item.find("link")
                seeders_el = item.find("nyaa:seeders", ns)
                title = title_el.text or "" if title_el is not None else ""
                torrent_url = (link_el.text or "").strip() if link_el is not None else ""
                magnet_url = _resolve_magnet_url(item, ns, torrent_url, title)
                if not magnet_url:
                    continue

                try:
                    seeders = int(seeders_el.text or 0) if seeders_el is not None else 0
                except ValueError:
                    seeders = 0

                video_code = _extract_video_code_from_title(title)
                if not video_code:
                    if magnet_url not in seen_uncoded_magnets:
                        seen_uncoded_magnets.add(magnet_url)
                        magnets_without_code.append(magnet_url)
                    continue

                candidate = {
                    "magnet": magnet_url,
                    "title": title,
                    "rank": _actress_magnet_candidate_rank(title, seeders),
                }
                current = candidates_by_code.get(video_code)
                if current is None or candidate["rank"] > current["rank"]:
                    candidates_by_code[video_code] = candidate

    magnets = list(magnets_without_code)
    seen_magnets = set(magnets)
    for video_code, candidate in candidates_by_code.items():
        title = str(candidate["title"])
        existing_file_names = _indexed_file_names_for_code(video_code, db)
        if existing_file_names:
            selected_is_uncensored_or_rm = _is_uncensored_or_reduced_mosaic_title(title)
            existing_has_uncensored_or_rm = any(_is_uncensored_or_reduced_mosaic_file_name(name) for name in existing_file_names)
            if not selected_is_uncensored_or_rm or existing_has_uncensored_or_rm:
                continue

        magnet = str(candidate["magnet"])
        if magnet not in seen_magnets:
            seen_magnets.add(magnet)
            magnets.append(magnet)

    return magnets


def _extract_magnet_url(item: ET.Element) -> str | None:
    """Best-effort magnet extraction from RSS item fields."""
    import re

    magnet_pattern = re.compile(r"magnet:\?[^\"'<>\s]+")
    for field_name in ("description", "guid", "comments"):
        field = item.find(field_name)
        if field is None or not field.text:
            continue
        match = magnet_pattern.search(field.text)
        if match:
            return match.group(0)
    return None


def _extract_info_hash(item: ET.Element, ns: dict[str, str]) -> str | None:
    """Extract an info hash if the RSS payload exposes one."""
    for field_name in ("nyaa:infoHash", "nyaa:infohash", "infoHash", "infohash"):
        field = item.find(field_name, ns) if field_name.startswith("nyaa:") else item.find(field_name)
        if field is not None and field.text:
            value = field.text.strip()
            if value:
                return value.lower()
    return None


def _parse_bencoded_info_hash(torrent_bytes: bytes) -> str | None:
    """Return the SHA1 info hash from a bencoded torrent file."""

    def _parse_int(data: bytes, idx: int) -> tuple[int, int]:
        end = data.index(b"e", idx)
        return int(data[idx:end]), end + 1

    def _parse_bytes(data: bytes, idx: int) -> tuple[bytes, int]:
        colon = data.index(b":", idx)
        length = int(data[idx:colon])
        start = colon + 1
        end = start + length
        return data[start:end], end

    def _skip_value(data: bytes, idx: int) -> int:
        token = data[idx:idx + 1]
        if token == b"i":
            _, end = _parse_int(data, idx + 1)
            return end
        if token == b"l":
            idx += 1
            while data[idx:idx + 1] != b"e":
                idx = _skip_value(data, idx)
            return idx + 1
        if token == b"d":
            idx += 1
            while data[idx:idx + 1] != b"e":
                _, idx = _parse_bytes(data, idx)
                idx = _skip_value(data, idx)
            return idx + 1
        if token.isdigit():
            _, end = _parse_bytes(data, idx)
            return end
        raise ValueError("invalid bencode")

    def _find_info_slice(data: bytes) -> tuple[int, int] | None:
        idx = 0
        if data[idx:idx + 1] != b"d":
            return None
        idx += 1
        while data[idx:idx + 1] != b"e":
            key, idx = _parse_bytes(data, idx)
            if key == b"info":
                start = idx
                end = _skip_value(data, idx)
                return start, end
            idx = _skip_value(data, idx)
        return None

    try:
        info_slice = _find_info_slice(torrent_bytes)
        if info_slice is None:
            return None
        start, end = info_slice
        return hashlib.sha1(torrent_bytes[start:end]).hexdigest()
    except Exception:
        return None


def _build_magnet_from_hash(info_hash: str, title: str | None = None) -> str:
    magnet = f"magnet:?xt=urn:btih:{info_hash}"
    if title:
        magnet += f"&dn={quote_plus(title)}"
    return magnet


def _resolve_magnet_url(item: ET.Element, ns: dict[str, str], torrent_url: str, title: str | None = None) -> str | None:
    magnet_url = _extract_magnet_url(item)
    if magnet_url:
        return magnet_url

    info_hash = _extract_info_hash(item, ns)
    if info_hash:
        return _build_magnet_from_hash(info_hash, title)

    return None


def _resolve_magnet_url_from_torrent(torrent_url: str, title: str | None = None) -> str | None:
    try:
        resp = httpx.get(torrent_url, timeout=10, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
    except Exception as exc:
        logging.warning("Nyaa torrent fetch failed for %s: %s", torrent_url, exc)
        return None

    info_hash = _parse_bencoded_info_hash(resp.content)
    if not info_hash:
        logging.warning("Nyaa torrent did not yield an info hash for %s", torrent_url)
        return None
    return _build_magnet_from_hash(info_hash, title)


def _format_work_content_id(content_id: str | None) -> str:
    """Match the frontend display form used for file searches."""
    if not content_id:
        return ""
    import re

    stripped = re.sub(r"^\d+", "", content_id)
    had_leading_digits = stripped != content_id
    m = re.match(r"^([a-zA-Z]+)(\d+)$", stripped)
    if not m:
        return stripped.upper() if had_leading_digits else content_id
    return f"{m.group(1).upper()}-{str(int(m.group(2))).zfill(3)}"


def _work_file_search_id(work: ActressWork) -> str:
    """Return the identifier used to match an R18 work to indexed files."""
    return _format_work_content_id(work.dvd_id) if work.dvd_id else _format_work_content_id(work.content_id)


def _search_ids_by_content_id(works_ids: list[tuple[str, str | None]]) -> tuple[dict[str, list[str]], list[str]]:
    search_id_to_content_ids: dict[str, list[str]] = {}
    for content_id, dvd_id in works_ids:
        sid = _format_work_content_id(dvd_id) if dvd_id else _format_work_content_id(content_id)
        if sid:
            search_id_to_content_ids.setdefault(sid, []).append(content_id)
    return search_id_to_content_ids, sorted(search_id_to_content_ids)


def _search_id_pairs(search_ids: list[str] | set[str]) -> list[tuple[str, str]]:
    return [(sid, sid.lower()) for sid in sorted(search_ids)]


def _matching_search_ids(search_pairs: list[tuple[str, str]], value: str | None) -> set[str]:
    if not value:
        return set()
    lowered = value.lower()
    return {sid for sid, lowered_sid in search_pairs if lowered_sid in lowered}


def _content_ids_for_sids(search_id_to_content_ids: dict[str, list[str]], sids: set[str]) -> frozenset[str]:
    content_ids: set[str] = set()
    for sid in sids:
        content_ids.update(search_id_to_content_ids[sid])
    return frozenset(content_ids)


def _load_current_file_match_rows(db: Session):
    """Load compact active file metadata once instead of OR-ing many wildcard LIKEs."""
    return (
        db.query(FileRecord.id, FileRecord.name, FileRecord.path, FileRecord.file_type, FileRecord.parent_id, FileRecord.height)
        .filter(FileRecord.is_deleted == False)  # noqa: E712
        .all()
    )


def _load_historical_file_match_rows(db: Session):
    return (
        db.query(ActressWorkFileStateRecord.file_name, ActressWorkFileStateRecord.path, ActressWorkFileStateRecord.status, ActressWorkFileStateRecord.file_type)
        .all()
    )


def _load_file_match_rows_for_search_ids(db: Session, search_ids: list[str]):
    """Fetch only files relevant to the current page instead of the whole library."""
    current_rows = []
    state_rows = []
    for start in range(0, len(search_ids), 100):
        chunk = search_ids[start : start + 100]
        filters = [FileRecord.name.ilike(f"%{sid}%") for sid in chunk]
        current_rows.extend(
            db.query(FileRecord.id, FileRecord.name, FileRecord.path, FileRecord.file_type, FileRecord.parent_id, FileRecord.height)
            .filter(FileRecord.is_deleted == False, or_(*filters))  # noqa: E712
            .all()
        )
        state_rows.extend(
            db.query(ActressWorkFileStateRecord.file_name, ActressWorkFileStateRecord.path, ActressWorkFileStateRecord.status, ActressWorkFileStateRecord.file_type)
            .filter(or_(*[ActressWorkFileStateRecord.file_name.ilike(f"%{sid}%") for sid in chunk]))
            .all()
        )
    return current_rows, state_rows


def _resolution_bucket(height: int | None) -> str | None:
    if height is None:
        return None
    if height <= 480:
        return "sd"
    if height <= 720:
        return "720p"
    if height <= 1080:
        return "1080p"
    if height <= 1440:
        return "1440p"
    return "4k"


def _resolve_file_exists_filter(
    file_exists: bool | None,
    actress_id: int,
    db: Session,
    local_file_state: str | None = None,
) -> tuple[frozenset[str] | None, frozenset[str] | None]:
    """Convert file_exists filter into content_id include/exclude sets using the same
    matching logic as _mark_existing_files.

    Fetches all content_ids + dvd_ids for the actress from the R18 DB, computes
    each work's file search ID (dvd_id or formatted content_id), then checks which
    appear in indexed file names via ILIKE — matching _mark_existing_files exactly.

    Args:
        file_exists: True = only works with a local file; False = only without; None = all.
        actress_id: Primary key in derived_actress.
        db: SQLAlchemy session for the app database.

    Returns:
        (content_ids_include, content_ids_exclude) — at most one is non-None.
    """
    if local_file_state == "present":
        file_exists = True
    elif local_file_state == "missing":
        file_exists = False

    if file_exists is None and local_file_state is None:
        return None, None

    works_ids = r18_actress.get_all_actress_content_ids(actress_id)  # returns list of (content_id, dvd_id)
    if not works_ids:
        include = frozenset() if file_exists or local_file_state == "deleted" else None
        exclude = None if file_exists or local_file_state == "deleted" else frozenset()
        return include, exclude

    # Build search IDs the same way _work_file_search_id does.
    search_id_to_content_ids, all_search_ids = _search_ids_by_content_id(works_ids)
    if not all_search_ids:
        return (frozenset(), None) if file_exists else (None, frozenset())

    search_pairs = _search_id_pairs(all_search_ids)
    matched_sids: set[str] = set()
    for row in _load_current_file_match_rows(db):
        matched_sids.update(_matching_search_ids(search_pairs, row.name))

    if local_file_state == "deleted":
        deleted_sids: set[str] = set()
        for file_name, _path, status, _file_type in _load_historical_file_match_rows(db):
            if status == "deleted":
                deleted_sids.update(_matching_search_ids(search_pairs, file_name))
        return _content_ids_for_sids(search_id_to_content_ids, deleted_sids - matched_sids), None

    if file_exists:
        return _content_ids_for_sids(search_id_to_content_ids, matched_sids), None
    else:
        return None, _content_ids_for_sids(search_id_to_content_ids, matched_sids)


def _merge_content_id_filters(
    left: tuple[frozenset[str] | None, frozenset[str] | None],
    right: tuple[frozenset[str] | None, frozenset[str] | None],
) -> tuple[frozenset[str] | None, frozenset[str] | None]:
    left_include, left_exclude = left
    right_include, right_exclude = right
    if left_include is None:
        include = right_include
    elif right_include is None:
        include = left_include
    else:
        include = left_include & right_include
    exclude = (left_exclude or frozenset()) | (right_exclude or frozenset())
    return include, exclude or None


def _resolve_badge_filter(
    actress_id: int,
    db: Session,
    uncensored: bool | None = None,
    censored: bool | None = None,
    subtitled: bool | None = None,
    resolution: str | None = None,
) -> tuple[frozenset[str] | None, frozenset[str] | None]:
    if uncensored is None and censored is None and subtitled is None and resolution is None:
        return None, None

    works_ids = r18_actress.get_all_actress_content_ids(actress_id)
    if not works_ids:
        return frozenset(), None

    search_id_to_content_ids, all_search_ids = _search_ids_by_content_id(works_ids)
    if not all_search_ids:
        return frozenset(), None

    search_pairs = _search_id_pairs(all_search_ids)
    current_rows = _load_current_file_match_rows(db)
    state_rows = _load_historical_file_match_rows(db)

    video_rows = [row for row in current_rows if (row.file_type or "").lower() == "video"]
    found_sids: set[str] = set()
    uncensored_sids: set[str] = set()
    subtitled_sids: set[str] = set()
    resolution_sids: set[str] = set()
    for row in current_rows:
        matching_sids = _matching_search_ids(search_pairs, row.name)
        if not matching_sids:
            continue
        found_sids.update(matching_sids)
        name = row.name or ""
        if _is_uncensored_or_reduced_mosaic_file_name(name):
            uncensored_sids.update(matching_sids)
        if "-sub" in name.lower():
            subtitled_sids.update(matching_sids)
        if (row.file_type or "").lower() == "video" and _resolution_bucket(row.height) == resolution:
            resolution_sids.update(matching_sids)

    video_ids = {row.id for row in video_rows if row.id}
    if video_ids:
        subtitle_rows = (
            db.query(FileRecord.parent_id)
            .filter(
                FileRecord.is_deleted == False,  # noqa: E712
                FileRecord.file_type == "subtitle",
                FileRecord.parent_id.in_(video_ids),
            )
            .all()
        )
        subtitled_parent_ids = {row.parent_id for row in subtitle_rows if row.parent_id}
        for video_row in video_rows:
            matching_sids = _matching_search_ids(search_pairs, video_row.name)
            if video_row.id in subtitled_parent_ids:
                subtitled_sids.update(matching_sids)
                continue
            if video_row.path:
                video_path = Path(video_row.path)
                candidate_paths = [
                    video_path.with_suffix(".srt"),
                    video_path.parent / "subtitles" / f"{video_path.stem}.srt",
                ]
                if any(path.exists() for path in candidate_paths):
                    subtitled_sids.update(matching_sids)

    for file_name, path, status, file_type in state_rows:
        if status != "present" or (file_type or "").lower() == "subtitle":
            continue
        matching_sids = _matching_search_ids(search_pairs, file_name)
        lowered_name = (file_name or "").lower()
        if _is_uncensored_or_reduced_mosaic_file_name(file_name or ""):
            uncensored_sids.update(matching_sids)
        if "-sub" in lowered_name:
            subtitled_sids.update(matching_sids)
        if path:
            video_path = Path(path)
            candidate_paths = [
                video_path.with_suffix(".srt"),
                video_path.parent / "subtitles" / f"{video_path.stem}.srt",
            ]
            if any(candidate.exists() for candidate in candidate_paths):
                subtitled_sids.update(matching_sids)

    include: frozenset[str] | None = None
    exclude: frozenset[str] | None = None
    censored_sids = found_sids - uncensored_sids
    for desired, sids in ((uncensored, uncensored_sids), (censored, censored_sids), (subtitled, subtitled_sids), (True if resolution else None, resolution_sids)):
        if desired is None:
            continue
        matching_content_ids = _content_ids_for_sids(search_id_to_content_ids, sids)
        if desired:
            include = matching_content_ids if include is None else include & matching_content_ids
        else:
            exclude = (exclude or frozenset()) | matching_content_ids

    return include, exclude


def _mark_existing_files(items: list[ActressWork], db: Session) -> list[ActressWork]:
    """Annotate works whose catalog id appears in indexed or historical file names."""
    search_ids = sorted({sid for work in items if (sid := _work_file_search_id(work))})
    if not search_ids:
        return items
    search_pairs = _search_id_pairs(search_ids)

    rows, state_rows = _load_file_match_rows_for_search_ids(db, search_ids)
    video_rows = [row for row in rows if (row.file_type or "").lower() == "video"]
    found_ids: set[str] = set()
    uncensored_ids: set[str] = set()
    subtitled_ids: set[str] = set()
    resolution_by_sid: dict[str, str] = {}
    for video_row in video_rows:
        matching_ids = _matching_search_ids(search_pairs, video_row.name)
        if not matching_ids:
            continue
        name = video_row.name or ""
        found_ids.update(matching_ids)
        if _is_uncensored_or_reduced_mosaic_file_name(name):
            uncensored_ids.update(matching_ids)
        if "-sub" in name.lower():
            subtitled_ids.update(matching_ids)
        bucket = _resolution_bucket(video_row.height)
        if not bucket:
            continue
        for sid in matching_ids:
            resolution_by_sid.setdefault(sid, bucket)

    for row in rows:
        if (row.file_type or "").lower() == "video":
            continue
        matching_ids = _matching_search_ids(search_pairs, row.name)
        if not matching_ids:
            continue
        found_ids.update(matching_ids)
        if "-sub" in (row.name or "").lower():
            subtitled_ids.update(matching_ids)

    video_ids = {row.id for row in video_rows if row.id}
    subtitle_rows = []
    if video_ids:
        subtitle_rows = (
            db.query(FileRecord.name, FileRecord.path, FileRecord.parent_id)
            .filter(
                FileRecord.is_deleted == False,  # noqa: E712
                FileRecord.file_type == "subtitle",
                FileRecord.parent_id.in_(video_ids),
            )
            .all()
        )
    subtitled_parent_ids = {row.parent_id for row in subtitle_rows if row.parent_id}
    for video_row in video_rows:
        matching_ids = _matching_search_ids(search_pairs, video_row.name)
        if video_row.id in subtitled_parent_ids:
            subtitled_ids.update(matching_ids)
            continue
        if not video_row.path:
            continue
        video_path = Path(video_row.path)
        candidate_paths = [
            video_path.with_suffix(".srt"),
            video_path.parent / "subtitles" / f"{video_path.stem}.srt",
        ]
        if any(path.exists() for path in candidate_paths):
            subtitled_ids.update(matching_ids)

    present_ids = set(found_ids)
    deleted_ids: set[str] = set()
    for file_name, path, status, file_type in state_rows:
        matching_ids = _matching_search_ids(search_pairs, file_name)
        if status == "present" and (file_type or "").lower() != "subtitle":
            if _is_uncensored_or_reduced_mosaic_file_name(file_name or ""):
                uncensored_ids.update(matching_ids)
            if "-sub" in (file_name or "").lower():
                subtitled_ids.update(matching_ids)
            if path:
                video_path = Path(path)
                candidate_paths = [
                    video_path.with_suffix(".srt"),
                    video_path.parent / "subtitles" / f"{video_path.stem}.srt",
                ]
                if any(candidate.exists() for candidate in candidate_paths):
                    subtitled_ids.update(matching_ids)
        if status == "present":
            present_ids.update(matching_ids)
        elif status == "deleted":
            deleted_ids.update(matching_ids)

    annotated: list[ActressWork] = []
    for work in items:
        sid = _work_file_search_id(work)
        file_exists = sid in found_ids
        local_file_state = "present" if sid in present_ids else "deleted" if sid in deleted_ids else None
        annotated.append(
            work.model_copy(
                update={
                    "file_exists": file_exists,
                    "is_uncensored": sid in uncensored_ids,
                    "is_subtitled": sid in subtitled_ids,
                    "resolution": resolution_by_sid.get(sid),
                    "local_file_state": local_file_state,
                }
            )
        )
    return annotated


def _build_status() -> R18Status:
    """Build current R18 database status snapshot."""
    metadata = read_metadata()
    import_status = get_import_status()
    loaded = r18_db_ready()
    actress_count = 0
    if loaded:
        from ..schemas.r18_db import count_actresses

        actress_count = count_actresses()
    return R18Status(
        loaded=loaded,
        actress_count=actress_count,
        imported_at=metadata.get("imported_at") if metadata else None,
        import_in_progress=import_status.get("state") == "running",
        import_state=import_status.get("state", "idle"),
        import_phase=import_status.get("phase"),
        download_bytes=import_status.get("download_bytes"),
        download_total=import_status.get("download_total"),
        import_error=import_status.get("error"),
    )


@router.get("/status", response_model=R18Status)
async def get_status():
    """Return whether the R18 reference database is loaded."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _build_status)


@router.get("/import/status", response_model=R18ImportStatus)
async def import_status():
    """Poll long-running import progress."""
    status = get_import_status()
    return R18ImportStatus(
        state=status.get("state", "idle"),
        phase=status.get("phase"),
        download_bytes=status.get("download_bytes"),
        download_total=status.get("download_total"),
        error=status.get("error"),
        started_at=status.get("started_at"),
        finished_at=status.get("finished_at"),
    )


@router.get("/actresses", response_model=ActressesResponse)
async def list_actresses(
    q: str = Query("", max_length=200),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """Search actresses by name."""
    if not r18_db_ready():
        raise HTTPException(status_code=503, detail="R18 database not loaded. Import a dump first.")
    loop = asyncio.get_running_loop()
    rows, total = await loop.run_in_executor(None, lambda: r18_actress.search_actresses(q, skip, limit))
    items = [ActressSummary(**row) for row in rows]
    return ActressesResponse(items=items, total=total)


@router.get("/actresses/{actress_id}", response_model=ActressDetail)
async def get_actress_detail(actress_id: int):
    """Return one actress with recent works."""
    if not r18_db_ready():
        raise HTTPException(status_code=503, detail="R18 database not loaded. Import a dump first.")
    loop = asyncio.get_running_loop()
    row = await loop.run_in_executor(None, lambda: r18_actress.get_actress(actress_id))
    if not row:
        raise HTTPException(status_code=404, detail="Actress not found")
    works = [ActressWork(**w) for w in row.pop("recent_works", [])]
    return ActressDetail(**row, recent_works=works)


def _apply_cached_work_translations(items: list[ActressWork]) -> list[ActressWork]:
    """Apply already-cached translations without external I/O on list requests."""
    return [
        work.model_copy(update={"title_en": _translation_cache[work.title_ja]})
        if not work.title_en and work.title_ja in _translation_cache
        else work
        for work in items
    ]


def _matches_torrent_status_filter(
    filter_value: str | None,
    queue_item: DownloadQueueRecord | None,
    download_status: TorrentStatus | None,
) -> bool:
    if filter_value is None:
        return True
    if filter_value == "failed":
        return queue_item is not None and queue_item.status == "failed"
    if filter_value == "skipped":
        return queue_item is not None and queue_item.status == "skipped"
    if filter_value == "completed":
        return download_status is not None and download_status.status == "completed"
    if filter_value == "stalled":
        return download_status is not None and download_status.state == "stalledDL"
    if filter_value == "queued":
        return bool(
            (queue_item is not None and queue_item.status in {"pending", "processing"})
            or (
                download_status is not None
                and download_status.status == "downloading"
                and (
                    not download_status.torrent_hash
                    or not download_status.state
                    or download_status.state in QBIT_QUEUED_STATES
                )
            )
        )
    if filter_value == "downloading":
        return bool(
            download_status is not None
            and download_status.status == "downloading"
            and download_status.state != "stalledDL"
            and not (
                not download_status.torrent_hash
                or not download_status.state
                or download_status.state in QBIT_QUEUED_STATES
            )
        )
    return False


async def _build_download_status_map() -> dict[str, TorrentStatus]:
    downloads = await get_downloads()
    return {item.content_id: item for item in downloads}


@router.get("/actresses/{actress_id}/works", response_model=ActressWorksResponse)
async def list_actress_works(
    actress_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(48, ge=1, le=1000),
    sort_by: str = Query("date", pattern="^(date|id|title)$"),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
    search: str = Query("", max_length=100),
    has_image: bool | None = Query(None),
    release_year: int | None = Query(None, ge=1900, le=2100),
    opened: bool | None = Query(None),
    file_exists: bool | None = Query(None),
    local_file_state: str | None = Query(None, pattern="^(present|deleted|missing)$"),
    uncensored: bool | None = Query(None),
    censored: bool | None = Query(None),
    subtitled: bool | None = Query(None),
    resolution: str | None = Query(None, pattern="^(sd|720p|1080p|1440p|4k)$"),
    torrent_status: str | None = Query(None, pattern="^(queued|downloading|stalled|completed|failed|skipped)$"),
    db: Session = Depends(db_session),
):
    """Return paginated works for one actress with optional filters."""
    request_started = time.perf_counter()
    if not r18_db_ready():
        raise HTTPException(status_code=503, detail="R18 database not loaded. Import a dump first.")
    _ensure_r18_indexes_once()

    filters_started = time.perf_counter()
    content_ids_include, content_ids_exclude = _merge_content_id_filters(
        _resolve_file_exists_filter(file_exists, actress_id, db, local_file_state),
        _resolve_badge_filter(actress_id, db, uncensored, censored, subtitled, resolution),
    )
    filter_seconds = time.perf_counter() - filters_started

    loop = asyncio.get_running_loop()
    torrent_seconds = 0.0
    if torrent_status is not None:
        torrent_started = time.perf_counter()
        queue_rows = {row.content_id: row for row in get_all_queue(db) if row.content_id}
        download_status_map = await _build_download_status_map()
        candidate_ids = set(queue_rows) | set(download_status_map)
        matching_ids = frozenset(
            content_id for content_id in candidate_ids
            if _matches_torrent_status_filter(
                torrent_status,
                queue_rows.get(content_id),
                download_status_map.get(content_id),
            )
        )
        content_ids_include, content_ids_exclude = _merge_content_id_filters(
            (content_ids_include, content_ids_exclude),
            (matching_ids, None),
        )
        torrent_seconds = time.perf_counter() - torrent_started

    query_started = time.perf_counter()
    rows, total = await loop.run_in_executor(
        None,
        lambda: r18_actress.list_actress_works(
            actress_id=actress_id,
            skip=skip,
            limit=limit,
            sort_by=sort_by,
            sort_dir=sort_dir,
            search=search,
            has_image=has_image,
            release_year=release_year,
            opened=opened,
            content_ids_include=content_ids_include,
            content_ids_exclude=content_ids_exclude,
        ),
    )
    query_seconds = time.perf_counter() - query_started
    if total == 0:
        row = await loop.run_in_executor(None, lambda: r18_actress.get_actress(actress_id))
        if not row:
            raise HTTPException(status_code=404, detail="Actress not found")
    items = [ActressWork(**w) for w in rows]
    items = _apply_cached_work_translations(items)
    enrichment_started = time.perf_counter()
    items = _mark_existing_files(items, db)
    enrichment_seconds = time.perf_counter() - enrichment_started
    logging.info(
        "Actress works loaded actress_id=%s skip=%s limit=%s total=%s filters=%.3fs torrent=%.3fs query=%.3fs enrichment=%.3fs request=%.3fs",
        actress_id, skip, limit, total, filter_seconds, torrent_seconds, query_seconds,
        enrichment_seconds, time.perf_counter() - request_started,
    )
    return ActressWorksResponse(items=items, total=total)


@router.get("/actresses/{actress_id}/magnet-export", response_model=ActressMagnetExportResponse)
async def export_actress_magnets(actress_id: int):
    loop = asyncio.get_running_loop()
    row = await loop.run_in_executor(None, lambda: r18_actress.get_actress(actress_id))
    if not row:
        raise HTTPException(status_code=404, detail="Actress not found")

    queries = _actress_magnet_queries(row)
    if not queries:
        raise HTTPException(status_code=404, detail="No actress aliases found")

    magnets = await _run_with_db_session(lambda db: _fetch_actress_magnets_for_queries(queries, db))
    return ActressMagnetExportResponse(
        actress_name=str(row.get("display_name") or row.get("name_romaji") or f"actress-{actress_id}"),
        queries=queries,
        magnets=magnets,
    )


@router.patch("/works/opened")
async def mark_actress_work_opened(body: WorkOpenedRequest):
    """Persist that an actress work card has been opened."""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: r18_actress.mark_work_opened(body.content_id))
    return {"ok": True}


@router.patch("/works/opened/bulk")
async def mark_actress_works_opened(body: WorksOpenedRequest):
    """Persist that multiple actress work cards have been opened."""
    loop = asyncio.get_running_loop()
    updated = await loop.run_in_executor(None, lambda: r18_actress.mark_works_opened(body.content_ids))
    return {"ok": True, "updated": updated}


def _status_from_dict(status: dict) -> R18ImportStatus:
    """Convert a raw import status dict into an API model."""
    return R18ImportStatus(
        state=status.get("state", "idle"),
        phase=status.get("phase"),
        download_bytes=status.get("download_bytes"),
        download_total=status.get("download_total"),
        error=status.get("error"),
        started_at=status.get("started_at"),
        finished_at=status.get("finished_at"),
    )


@router.post("/import", response_model=R18ImportStatus, status_code=202)
async def import_dump(file: UploadFile = File(...)):
    """Upload a `.sql.gz` dump and start a background R18 database reload."""
    if not file.filename or not file.filename.endswith(".gz"):
        raise HTTPException(status_code=400, detail="File must be a .sql.gz archive")

    content = await file.read()
    loop = asyncio.get_running_loop()
    upload_name = file.filename or "upload.sql.gz"

    def _start_upload() -> dict:
        path = save_uploaded_gz(content, upload_name)
        return schedule_import_r18_sql_gz(path, filename=upload_name)

    try:
        status = await loop.run_in_executor(None, _start_upload)
        return _status_from_dict(status)
    except RuntimeError as exc:
        if "already in progress" in str(exc):
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        logging.exception("R18 import failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logging.exception("R18 import failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/translate")
async def translate_text(text: str = Query(..., max_length=500)):
    """Translate text to English using Google Translate (via deep-translator). Results are cached."""
    if not text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")

    if text in _translation_cache:
        return {"translated": _translation_cache[text]}

    def _translate() -> str:
        from deep_translator import GoogleTranslator

        return GoogleTranslator(source="auto", target="en").translate(text)

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, _translate)
    except Exception as exc:
        logging.warning("Translation failed: %s", exc)
        raise HTTPException(status_code=502, detail="Translation service unavailable") from exc

    _translation_cache[text] = result
    return {"translated": result}


@router.post("/import-from-url", response_model=R18ImportStatus, status_code=202)
async def import_from_url(body: ImportFromUrlBody | None = None):
    """Download a dump from URL (default r18.dev latest) and import in the background."""
    url = (body.url if body else LATEST_DUMP_URL).strip()
    loop = asyncio.get_running_loop()

    try:
        status = await loop.run_in_executor(None, lambda: schedule_import_from_url(url))
        return _status_from_dict(status)
    except RuntimeError as exc:
        if "already in progress" in str(exc):
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        logging.exception("R18 import-from-url failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        logging.exception("R18 import-from-url failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/nyaa/{formatted_id}", response_model=list[NyaaResult])
async def search_nyaa(formatted_id: str, content_id: str | None = Query(None), db: Session = Depends(db_session)):
    """Fetch sukebei.nyaa.si RSS for a formatted_id and return torrent results."""
    url = f"https://sukebei.nyaa.si/?page=rss&q={formatted_id}&c=0_0&f=0"

    tried_urls: set[str] = set()
    if content_id:
        row = db.query(DownloadQueueRecord).filter(DownloadQueueRecord.content_id == content_id).order_by(DownloadQueueRecord.id.desc()).first()
        if row is not None:
            tried_urls.update(get_failed_torrent_urls(row))
            if row.torrent_url:
                tried_urls.add(row.torrent_url)

    def _fetch() -> list[NyaaResult]:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"}
        try:
            resp = httpx.get(url, timeout=10, follow_redirects=True, headers=headers)
            resp.raise_for_status()
        except Exception as exc:
            logging.warning("Nyaa RSS fetch failed for %s: %s", formatted_id, exc)
            return []

        ns = {"nyaa": "https://sukebei.nyaa.si/xmlns/nyaa"}
        try:
            root = ET.fromstring(resp.text)
        except ET.ParseError as exc:
            logging.warning("Nyaa RSS parse error for %s: %s", formatted_id, exc)
            return []

        results: list[NyaaResult] = []
        for item in root.findall(".//item")[:10]:
            title_el = item.find("title")
            link_el = item.find("link")
            seeders_el = item.find("nyaa:seeders", ns)
            size_el = item.find("nyaa:size", ns)

            if title_el is None or link_el is None:
                continue
            torrent_url = (link_el.text or "").strip()
            if not torrent_url:
                continue

            try:
                seeders = int(seeders_el.text or 0) if seeders_el is not None else 0
            except ValueError:
                seeders = 0

            results.append(
                NyaaResult(
                    title=title_el.text or "",
                    torrent_url=torrent_url,
                    magnet_url=_resolve_magnet_url(item, ns, torrent_url, title_el.text or ""),
                    seeders=seeders,
                    size=size_el.text or "" if size_el is not None else "",
                    was_tried=torrent_url in tried_urls,
                )
            )
        return results

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _fetch)


@router.get("/nyaa/magnet")
async def resolve_nyaa_magnet(torrent_url: str = Query(...), title: str | None = Query(None)):
    magnet_url = _resolve_magnet_url_from_torrent(torrent_url, title)
    if not magnet_url:
        raise HTTPException(status_code=404, detail="Failed to resolve magnet link")
    return {"magnet_url": magnet_url}


@router.post("/download")
async def send_to_qbittorrent(body: DownloadRequest):
    """Send a torrent URL to the configured qBittorrent instance and record tracking."""
    torrent_name = Path(body.torrent_url).stem
    category, tags = _build_qbit_labels(body.content_id, body.category, body.tags)
    save_path = body.save_path.strip() if body.save_path and body.save_path.strip() else None

    loop = asyncio.get_running_loop()
    try:
        if save_path:
            await loop.run_in_executor(None, lambda: _send_to_qbit(body.torrent_url, category, tags, save_path))
        else:
            await loop.run_in_executor(None, lambda: _send_to_qbit(body.torrent_url, category, tags))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        logging.exception("qBittorrent send failed")
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    def _record_tracking(db: Session) -> None:
        insert_tracking(db, body.content_id, torrent_name, body.video_code)
        mark_processing_by_content_id(db, body.content_id, body.torrent_url)

    await _run_with_db_session(_record_tracking)

    return {"ok": True}


def _fetch_qbit_torrents(qbit_url: str, username: str, password: str) -> list[dict]:
    """Return all torrents from qBittorrent as a list of dicts. Raises on failure."""
    with httpx.Client(timeout=15) as client:
        login = client.post(
            f"{qbit_url}/api/v2/auth/login",
            data={"username": username, "password": password},
        )
        if login.status_code != 200 or login.text == "Fails.":
            raise RuntimeError(f"qBittorrent login failed: {login.text}")
        info = client.get(
            f"{qbit_url}/api/v2/torrents/info",
            cookies=login.cookies,
        )
        info.raise_for_status()
        return info.json()


@router.get("/downloads", response_model=list[TorrentStatus])
async def get_downloads():
    """Return tracked torrent statuses, enriched with live qBittorrent data."""
    from ..crud.setting import get_settings

    db = _dbh.SessionLocal()
    try:
        tracked = get_all_tracking(db)
        if not tracked:
            return []

        settings = get_settings()
        qbit_url = (settings.qbittorrent_url or "").rstrip("/")
        username = settings.qbittorrent_username or ""
        password = settings.qbittorrent_password or ""

        qbit_torrents: list[dict] = []
        loop = asyncio.get_running_loop()
        try:
            qbit_torrents = await loop.run_in_executor(None, lambda: _fetch_qbit_torrents(qbit_url, username, password))
            qbit_reachable = True
        except Exception:
            logging.warning("Could not reach qBittorrent; returning cached tracking status")
            qbit_reachable = False

        # Build a hash→torrent and name→torrent index from qBit
        by_hash: dict[str, dict] = {t["hash"]: t for t in qbit_torrents}
        by_name: list[dict] = qbit_torrents  # searched linearly by name substring

        results: list[TorrentStatus] = []
        for row in tracked:
            qbit: dict | None = None

            if row.torrent_hash and row.torrent_hash in by_hash:
                qbit = by_hash[row.torrent_hash]
            else:
                # Fallback: find first qBit torrent whose name contains video_code
                code_lower = row.video_code.lower()
                for t in by_name:
                    if code_lower in t.get("name", "").lower():
                        qbit = t
                        break

            # Back-fill hash if resolved via name match (don't assign to ORM obj to avoid dirty flush)
            resolved_hash = row.torrent_hash
            if qbit and not resolved_hash:
                update_hash(db, row.id, qbit["hash"])
                resolved_hash = qbit["hash"]

            # Derive status from qBit state
            if qbit:
                qbit_state = qbit.get("state", "")
                is_done = qbit.get("progress", 0.0) >= 1.0 or qbit_state in (
                    "uploading",
                    "stalledUP",
                    "queuedUP",
                    "checkingUP",
                    "forcedUP",
                )
                effective_status = row.status
                effective_completed_at = row.completed_at
                if is_done and row.status != "completed":
                    now = datetime.now(timezone.utc)
                    update_status(db, row.id, "completed", completed_at=now)
                    effective_status = "completed"
                    effective_completed_at = now

                results.append(
                    TorrentStatus(
                        content_id=row.content_id or row.video_code,
                        video_code=row.video_code,
                        torrent_hash=resolved_hash,
                        torrent_name=row.torrent_name,
                        status=effective_status,
                        progress=round(qbit.get("progress", 0.0), 4),
                        speed=qbit.get("dlspeed", 0),
                        eta=qbit.get("eta", -1),
                        added_at=row.added_at,
                        completed_at=effective_completed_at,
                        seeders=qbit.get("num_seeds"),
                        created_at=qbit.get("added_on"),
                        size=qbit.get("size"),
                        total_size=qbit.get("total_size"),
                        save_path=qbit.get("save_path"),
                        state=qbit_state,
                    )
                )
            else:
                effective_status = row.status
                if qbit_reachable and row.status == "downloading":
                    if not is_within_missing_torrent_grace_period(row):
                        update_status(db, row.id, "error")
                        effective_status = "error"

                # No qBit match — return last-known DB state
                results.append(
                    TorrentStatus(
                        content_id=row.content_id or row.video_code,
                        video_code=row.video_code,
                        torrent_hash=row.torrent_hash,
                        torrent_name=row.torrent_name,
                        status=effective_status,
                        progress=1.0 if effective_status == "completed" else 0.0,
                        speed=0,
                        eta=-1,
                        added_at=row.added_at,
                        completed_at=row.completed_at,
                        seeders=None,
                        created_at=None,
                        size=None,
                        total_size=None,
                        save_path=None,
                        state=None,
                    )
                )

        return results
    finally:
        db.close()


class EnqueueItem(BaseModel):
    content_id: str
    video_code: str


class EnqueueRequest(BaseModel):
    items: list[EnqueueItem]
    save_path: str | None = None


@router.post("/queue")
async def enqueue_download_queue(body: EnqueueRequest):
    """Add works to the bulk download queue by content_id + video_code."""
    def _enqueue(db: Session) -> dict[str, int]:
        pairs = [(item.content_id, item.video_code) for item in body.items]
        queued = enqueue_works(db, pairs, body.save_path)
        skipped = len(body.items) - queued
        return {"queued": queued, "skipped": skipped}

    return await _run_with_db_session(_enqueue)


@router.get("/queue", response_model=list[DownloadQueueStatus])
async def get_download_queue():
    """Return all download queue items ordered by position."""
    def _get_queue(db: Session) -> list[DownloadQueueStatus]:
        rows = get_all_queue(db)
        return [
            DownloadQueueStatus(
                id=r.id,
                content_id=r.content_id or r.video_code,
                video_code=r.video_code,
                status=r.status,
                error=r.error,
                torrent_url=r.torrent_url,
                save_path=r.save_path,
                added_at=r.added_at,
                processed_at=r.processed_at,
                position=r.position,
            )
            for r in rows
        ]

    return await _run_with_db_session(_get_queue)


@router.delete("/queue/done")
async def clear_download_queue_done(include_failed: bool = Query(False)):
    """Remove inactive items from the queue."""
    def _clear(db: Session) -> int:
        statuses = ["done", "skipped", "failed"] if include_failed else ["done", "skipped"]
        return clear_done_queue(db, statuses)

    removed = await _run_with_db_session(_clear)
    return {"removed": removed}


@router.delete("/queue/failed")
async def clear_download_queue_failed():
    """Remove failed items from the queue."""
    db = _dbh.SessionLocal()
    try:
        removed = clear_done_queue(db, ["failed"])
        return {"removed": removed}
    finally:
        db.close()


@router.post("/queue/{item_id}/retry")
async def retry_download_queue_item(item_id: int):
    """Reset an inactive queue item so the worker tries it again."""
    did_retry = await _run_with_db_session(lambda db: retry_queue_item(db, item_id))
    if not did_retry:
        raise HTTPException(status_code=409, detail="Only completed, failed, or skipped queue items can be retried")
    return {"ok": True}


@router.delete("/queue/{item_id}")
async def delete_download_queue_item(item_id: int):
    """Delete a single queue item. If processing, also removes torrent+files from qBittorrent."""
    from ..schemas.download_queue import DownloadQueueRecord

    db = _dbh.SessionLocal()
    try:
        record = db.query(DownloadQueueRecord).filter(DownloadQueueRecord.id == item_id).first()
        if record is None:
            raise HTTPException(status_code=404, detail="Queue item not found")

        if record.status == "processing":
            lookup_id = record.content_id or record.video_code
            tracking = get_tracking_by_content_id(db, lookup_id) if record.content_id else get_tracking_by_video_code(db, record.video_code)
            if tracking:
                torrent_hash = tracking.torrent_hash
                if not torrent_hash and tracking.torrent_name:
                    loop = asyncio.get_running_loop()
                    torrent_hash = await loop.run_in_executor(None, lambda: _find_torrent_hash(tracking.torrent_name, retries=1, delay=0))
                if torrent_hash:
                    loop = asyncio.get_running_loop()
                    try:
                        await loop.run_in_executor(None, lambda: _delete_torrent(torrent_hash))
                    except Exception as exc:
                        logging.warning(
                            "delete_download_queue_item: qbit delete failed for %s: %s",
                            record.video_code,
                            exc,
                        )
            if record.content_id:
                delete_tracking_by_content_id(db, record.content_id)
            else:
                delete_tracking_by_video_code(db, record.video_code)

        delete_queue_item(db, item_id)
        return {"ok": True}
    finally:
        db.close()


@router.delete("/downloads/{content_id}")
async def cancel_download(content_id: str):
    """Delete a tracked torrent from qBittorrent (including files) and remove the tracking record."""
    db = _dbh.SessionLocal()
    try:
        tracking = get_tracking_by_content_id(db, content_id)
        if tracking is None:
            raise HTTPException(status_code=404, detail="No tracking record found for this content_id")

        torrent_hash = tracking.torrent_hash
        if not torrent_hash and tracking.torrent_name:
            loop = asyncio.get_running_loop()
            torrent_hash = await loop.run_in_executor(None, lambda: _find_torrent_hash(tracking.torrent_name, retries=1, delay=0))

        if torrent_hash:
            loop = asyncio.get_running_loop()
            try:
                await loop.run_in_executor(None, lambda: _delete_torrent(torrent_hash))
            except Exception as exc:
                logging.warning("cancel_download: qbit delete failed for %s: %s", content_id, exc)

        delete_tracking_by_content_id(db, content_id)
        return {"ok": True}
    finally:
        db.close()
