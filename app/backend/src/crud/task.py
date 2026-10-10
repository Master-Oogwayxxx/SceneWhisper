import logging
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy import case, func, nullslast, or_, select
from sqlalchemy.orm import Session

from ..models.models import File, Task, TaskStatus, TaskType
from ..utils import utc_isoformat
from ..schemas.db_helper import close_db, get_db
from ..schemas.directory import DirectoryRecord
from ..schemas.directory_monitor import DirectoryMonitorRecord
from ..schemas.file import FileRecord
from ..schemas.scene import SceneRecord
from ..schemas.task import TaskRecord


def _duration_to_seconds(duration: str | int | float | None) -> float | None:
    if duration is None:
        return None
    if isinstance(duration, (int, float)):
        return float(duration) if duration > 0 else None
    parts = str(duration).split(":")
    if len(parts) != 3:
        return None
    try:
        hours, minutes, seconds = (float(part) for part in parts)
    except ValueError:
        return None
    total = hours * 3600 + minutes * 60 + seconds
    return total if total > 0 else None


def _apply_task_filters(
    query,
    *,
    task_types: list[TaskType] | None = None,
    date_ranges: list[str] | None = None,
    subtitle_languages: list[str] | None = None,
    scene_detectors: list[str] | None = None,
    directory_ids: list[str] | None = None,
    directory_exclude: bool = False,
):
    if task_types:
        if any(task_type in task_types for task_type in (TaskType.SCENE, TaskType.SPLIT, TaskType.SUBTITLE)):
            task_types = list(dict.fromkeys([*task_types, TaskType.ALL]))
        query = query.filter(TaskRecord.type.in_(task_types))

    if subtitle_languages:
        query = query.filter(TaskRecord.subtitle_language.in_(subtitle_languages))

    if scene_detectors:
        query = query.filter(TaskRecord.scene_detector.in_(scene_detectors))

    if directory_ids:
        if directory_exclude:
            query = query.filter(or_(FileRecord.directory_id.is_(None), ~FileRecord.directory_id.in_(directory_ids)))
        else:
            query = query.filter(FileRecord.directory_id.in_(directory_ids))

    if date_ranges:
        now = datetime.utcnow()
        start_of_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        cutoffs = []
        if "today" in date_ranges:
            cutoffs.append(start_of_today)
        if "last_7_days" in date_ranges:
            cutoffs.append(now - timedelta(days=7))
        if "last_30_days" in date_ranges:
            cutoffs.append(now - timedelta(days=30))
        if "last_year" in date_ranges:
            cutoffs.append(now - timedelta(days=365))
        if cutoffs:
            query = query.filter(TaskRecord.created_at >= min(cutoffs))

    return query


def record_to_task(record: TaskRecord, file_record: FileRecord = None) -> Task:
    """Convert database record to Task model. If file_record provided, use it; otherwise fetch separately. For merge tasks, file_record may be None."""
    file = None

    # If file_id is set, fetch the file (applies to all task types including merge tasks after completion)
    if record.file_id:
        if file_record is None:
            db = get_db()
            try:
                file_record = db.query(FileRecord).filter(FileRecord.id == record.file_id).first()
            finally:
                close_db(db)

        if file_record:
            file = File(
                id=file_record.id,
                name=file_record.name,
                path=file_record.path,
                size=file_record.size,
                duration=file_record.duration,
                format=file_record.format,
                parent_id=file_record.parent_id,
                width=file_record.width,
                height=file_record.height,
                fps=file_record.fps,
                codec=file_record.codec,
                bitrate=file_record.bitrate,
                file_type=file_record.file_type,
                last_scanned_at=utc_isoformat(file_record.last_scanned_at) if file_record.last_scanned_at else None,
                queue_disabled=file_record.queue_disabled or False,
                split_disabled=file_record.split_disabled or False,
                subtitle_disabled=file_record.subtitle_disabled or False,
                is_deleted=file_record.is_deleted or False,
            )
        else:
            logging.warning(f"File with ID {record.file_id} not found for Task {record.id}")

    return Task(
        id=record.id,
        file=file,
        type=record.type,
        status=record.status,
        currentStage=record.current_stage,
        scene_progress=record.scene_progress or 0.0,
        split_progress=record.split_progress or 0.0,
        subtitle_progress=record.subtitle_progress or 0.0,
        merge_progress=record.merge_progress or 0.0,
        subtitleLanguage=record.subtitle_language,
        scheduledFor=record.scheduled_for,
        createdAt=utc_isoformat(record.created_at) if record.created_at else None,
        startedAt=utc_isoformat(record.started_at) if record.started_at else None,
        stageStartedAt=utc_isoformat(record.stage_started_at) if record.stage_started_at else None,
        completedAt=utc_isoformat(record.completed_at) if record.completed_at else None,
        pausedAt=utc_isoformat(record.paused_at) if record.paused_at else None,
        elapsedSeconds=record.elapsed_seconds if record.elapsed_seconds is not None else (
            max(0, int((datetime.utcnow() - record.started_at).total_seconds())) if record.started_at else None
        ),
        scene_elapsed_seconds=record.scene_elapsed_seconds,
        split_elapsed_seconds=record.split_elapsed_seconds,
        subtitle_elapsed_seconds=record.subtitle_elapsed_seconds,
        scene_count=record.scene_count or 0,
        split_count=record.split_count or 0,
        error=record.error,
        scene_detector=record.scene_detector,
        overwrite_scenes=record.overwrite_scenes or False,
        overwrite_split=record.overwrite_split or False,
        bypass_split_guard=record.bypass_split_guard or False,
        overwrite_subtitles=record.overwrite_subtitles or False,
        delete_video_after_completion=record.delete_video_after_completion or False,
        nvenc_overwrite_original=record.nvenc_overwrite_original or False,
        merge_input_paths=record.merge_input_paths,
    )


def create_task(task: Task) -> Task:
    """Create a new task in database"""
    db = get_db()
    try:
        # Check if a similar task already exists for the same file and type (skip for merge tasks)
        if task.file:
            existing_task = db.query(TaskRecord).filter(
                TaskRecord.file_id == task.file.id,
                TaskRecord.type == task.type,
                TaskRecord.status.notin_([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED])
            ).first()

            if existing_task:
                logging.info(f"Task already exists for file {task.file.name} with type {task.type.value}, returning existing task")
                return record_to_task(existing_task)

        record = TaskRecord(
            id=task.id,
            file_id=task.file.id if task.file else None,
            type=task.type,
            status=task.status,
            current_stage=task.currentStage,
            scene_progress=task.scene_progress,
            split_progress=task.split_progress,
            subtitle_progress=task.subtitle_progress,
            merge_progress=task.merge_progress,
            subtitle_language=task.subtitleLanguage,
            scheduled_for=task.scheduledFor,
            created_at=datetime.fromisoformat(task.createdAt) if task.createdAt else datetime.utcnow(),
            started_at=datetime.fromisoformat(task.startedAt) if task.startedAt else None,
            stage_started_at=datetime.fromisoformat(task.stageStartedAt) if task.stageStartedAt else None,
            completed_at=datetime.fromisoformat(task.completedAt) if task.completedAt else None,
            paused_at=datetime.fromisoformat(task.pausedAt) if task.pausedAt else None,
            elapsed_seconds=task.elapsedSeconds,
            scene_count=task.scene_count,
            split_count=task.split_count,
            error=task.error,
            scene_detector=task.scene_detector,
            overwrite_scenes=task.overwrite_scenes or False,
            overwrite_split=task.overwrite_split or False,
            bypass_split_guard=task.bypass_split_guard or False,
            overwrite_subtitles=task.overwrite_subtitles or False,
            delete_video_after_completion=task.delete_video_after_completion or False,
            nvenc_overwrite_original=task.nvenc_overwrite_original or False,
            merge_input_paths=task.merge_input_paths,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record_to_task(record)
    finally:
        close_db(db)


def get_task(task_id: str) -> Optional[Task]:
    """Get a task by ID"""
    db = get_db()

    try:
        record = db.query(TaskRecord).filter(TaskRecord.id == task_id).first()
        if record:
            return record_to_task(record)

        return None

    except Exception as e:
        logging.error(f"Error fetching task {task_id}: {e}")
        return None

    finally:
        close_db(db)


def get_all_tasks() -> List[Task]:
    """Get all tasks with their files in a single query"""
    db = get_db()

    try:
        # Join tasks with files to avoid N+1 queries
        results = db.query(TaskRecord, FileRecord).outerjoin(
            FileRecord, TaskRecord.file_id == FileRecord.id
        ).order_by(TaskRecord.created_at.desc()).all()

        return [t for t in (record_to_task(task_rec, file_rec) for task_rec, file_rec in results) if t is not None]

    except Exception as e:
        logging.error(f"Error fetching all tasks: {e}")
        return []

    finally:
        close_db(db)


def get_tasks_paginated(
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    file_id: str | None = None,
    task_types: list[TaskType] | None = None,
    date_ranges: list[str] | None = None,
    subtitle_languages: list[str] | None = None,
    scene_detectors: list[str] | None = None,
    directory_ids: list[str] | None = None,
    directory_exclude: bool = False,
) -> tuple[List[Task], int]:
    """Get paginated tasks with total count. Pagination happens at DB level."""
    db = get_db()

    try:
        query = db.query(TaskRecord, FileRecord).outerjoin(
            FileRecord, TaskRecord.file_id == FileRecord.id
        )

        if file_id:
            query = query.filter(TaskRecord.file_id == file_id)

        if search:
            query = query.filter(or_(
                FileRecord.name.ilike(f"%{search}%"),
                TaskRecord.merge_input_paths.ilike(f"%{search}%"),
            ))

        query = _apply_task_filters(
            query,
            task_types=task_types,
            date_ranges=date_ranges,
            subtitle_languages=subtitle_languages,
            scene_detectors=scene_detectors,
            directory_ids=directory_ids,
            directory_exclude=directory_exclude,
        )

        query = query.order_by(
            nullslast(case(
                (TaskRecord.status == TaskStatus.QUEUED, TaskRecord.queue_position),
                else_=None
            )),
            TaskRecord.created_at.desc()
        )

        total_query = db.query(func.count(TaskRecord.id)).outerjoin(
            FileRecord, TaskRecord.file_id == FileRecord.id
        )
        if file_id:
            total_query = total_query.filter(TaskRecord.file_id == file_id)
        if search:
            total_query = total_query.filter(or_(
                FileRecord.name.ilike(f"%{search}%"),
                TaskRecord.merge_input_paths.ilike(f"%{search}%"),
            ))
        total_query = _apply_task_filters(
            total_query,
            task_types=task_types,
            date_ranges=date_ranges,
            subtitle_languages=subtitle_languages,
            scene_detectors=scene_detectors,
            directory_ids=directory_ids,
            directory_exclude=directory_exclude,
        )

        total = total_query.scalar()
        results = query.offset(skip).limit(limit).all()

        tasks = [t for t in (record_to_task(task_rec, file_rec) for task_rec, file_rec in results) if t is not None]
        return tasks, total

    except Exception as e:
        logging.error(f"Error fetching paginated tasks: {e}")
        return [], 0

    finally:
        close_db(db)


def update_task(task: Task) -> Task:
    """Update an existing task"""
    db = get_db()

    try:
        record = db.query(TaskRecord).filter(TaskRecord.id == task.id).first()

        if record:
            record.status = task.status
            record.scene_progress = task.scene_progress
            record.split_progress = task.split_progress
            record.subtitle_progress = task.subtitle_progress
            record.merge_progress = task.merge_progress
            record.current_stage = task.currentStage
            record.error = task.error
            record.started_at = datetime.fromisoformat(task.startedAt) if task.startedAt else None
            record.stage_started_at = datetime.fromisoformat(task.stageStartedAt) if task.stageStartedAt else None
            record.completed_at = datetime.fromisoformat(task.completedAt) if task.completedAt else None
            record.paused_at = datetime.fromisoformat(task.pausedAt) if task.pausedAt else None
            # Persist server-measured duration when the API sends it (e.g. task finished)
            record.elapsed_seconds = task.elapsedSeconds
            record.scene_elapsed_seconds = task.scene_elapsed_seconds
            record.split_elapsed_seconds = task.split_elapsed_seconds
            record.subtitle_elapsed_seconds = task.subtitle_elapsed_seconds
            record.scene_count = task.scene_count
            record.split_count = task.split_count
            record.delete_video_after_completion = task.delete_video_after_completion or False
            record.nvenc_overwrite_original = task.nvenc_overwrite_original or False
            record.file_id = task.file.id if task.file else None

            db.commit()
            db.refresh(record)

            # Fetch the file record in the same session to avoid opening a second
            # DB connection inside record_to_task (called on every progress write).
            file_rec = db.query(FileRecord).filter(FileRecord.id == record.file_id).first() if record.file_id else None
            return record_to_task(record, file_rec)
        return task

    except Exception as e:
        logging.error(f"Error updating task {task.id}: {e}")
        return task

    finally:
        close_db(db)


def delete_task(task_id: str) -> bool:
    """Delete a task"""
    db = get_db()

    try:
        record = db.query(TaskRecord).filter(TaskRecord.id == task_id).first()
        if record:
            db.delete(record)
            db.commit()
            return True

        return False

    except Exception as e:
        logging.error(f"Error deleting task {task_id}: {e}")
        return False

    finally:
        close_db(db)


def delete_tasks_by_status(status: TaskStatus) -> int:
    """
    Delete all tasks with the given status.

    Args:
        status: Task status (TaskStatus enum)

    Returns:
        Number of tasks deleted
    """
    db = get_db()
    try:
        result = db.query(TaskRecord).filter(TaskRecord.status == status).delete()
        db.commit()
        logging.debug(f"Deleted {result} tasks with status {status}")
        return result
    except Exception as e:
        logging.error(f"Error deleting tasks with status {status}: {e}")
        return 0
    finally:
        close_db(db)


def delete_tasks_by_ids(task_ids: list[str]) -> int:
    """Delete tasks by a list of IDs. Returns count deleted."""
    if not task_ids:
        return 0
    db = get_db()
    try:
        result = db.query(TaskRecord).filter(TaskRecord.id.in_(task_ids)).delete(synchronize_session=False)
        db.commit()
        logging.debug(f"Deleted {result} tasks by IDs")
        return result
    except Exception as e:
        logging.error(f"Error deleting tasks by IDs: {e}")
        return 0
    finally:
        close_db(db)


def get_task_ids_by_file_and_statuses(file_id: str, statuses: list[str]) -> list[str]:
    """Return IDs of tasks for a file whose status is in the given list."""
    db = get_db()
    try:
        records = (
            db.query(TaskRecord.id)
            .filter(TaskRecord.file_id == file_id, TaskRecord.status.in_(statuses))
            .all()
        )
        return [r.id for r in records]
    except Exception as e:
        logging.error(f"Error fetching task IDs for file {file_id}: {e}")
        return []
    finally:
        close_db(db)


def get_file_badge_tasks() -> List[Task]:
    """Return active tasks and only the newest terminal task for each file."""
    db = get_db()
    try:
        terminal_statuses = [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]
        ranked_terminal = (
            db.query(
                TaskRecord.id.label("task_id"),
                func.row_number().over(
                    partition_by=TaskRecord.file_id,
                    order_by=(
                        func.coalesce(TaskRecord.completed_at, TaskRecord.created_at).desc(),
                        TaskRecord.created_at.desc(),
                    ),
                ).label("terminal_rank"),
            )
            .filter(
                TaskRecord.file_id.isnot(None),
                TaskRecord.status.in_(terminal_statuses),
            )
            .subquery()
        )
        latest_terminal_ids = select(ranked_terminal.c.task_id).where(ranked_terminal.c.terminal_rank == 1)
        results = (
            db.query(TaskRecord, FileRecord)
            .outerjoin(FileRecord, TaskRecord.file_id == FileRecord.id)
            .filter(
                TaskRecord.file_id.isnot(None),
                or_(
                    TaskRecord.status.in_([TaskStatus.QUEUED, TaskStatus.PROCESSING]),
                    TaskRecord.id.in_(latest_terminal_ids),
                ),
            )
            .order_by(TaskRecord.created_at.desc())
            .all()
        )
        return [record_to_task(task_record, file_record) for task_record, file_record in results]
    except Exception as exc:
        logging.error("Error fetching file badge tasks: %s", exc)
        return []
    finally:
        close_db(db)


def get_task_ids_by_file_statuses_and_types(file_id: str, statuses: list[str], task_types: list[TaskType]) -> list[str]:
    """Return IDs of tasks for a file whose status and task type match."""
    db = get_db()
    try:
        records = (
            db.query(TaskRecord.id)
            .filter(
                TaskRecord.file_id == file_id,
                TaskRecord.status.in_(statuses),
                TaskRecord.type.in_(task_types),
            )
            .all()
        )
        return [r.id for r in records]
    except Exception as e:
        logging.error(f"Error fetching task IDs for file {file_id}: {e}")
        return []
    finally:
        close_db(db)


def get_tasks_by_status(status: TaskStatus) -> List[Task]:
    """Get tasks by status"""
    db = get_db()

    try:
        query = db.query(TaskRecord, FileRecord).outerjoin(
            FileRecord, TaskRecord.file_id == FileRecord.id
        ).filter(TaskRecord.status == status)

        if status == TaskStatus.QUEUED:
            query = query.order_by(nullslast(TaskRecord.queue_position.asc()), TaskRecord.created_at.asc())
        elif status == TaskStatus.PAUSED:
            query = query.order_by(nullslast(TaskRecord.paused_at.desc()), TaskRecord.created_at.desc())
        elif status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
            query = query.order_by(nullslast(TaskRecord.completed_at.desc()), TaskRecord.created_at.desc())
        else:
            query = query.order_by(TaskRecord.created_at.desc())

        results = query.all()
        return [t for t in (record_to_task(task_rec, file_rec) for task_rec, file_rec in results) if t is not None]

    except Exception as e:
        logging.error(f"Error fetching tasks with status {status}: {e}")
        return []

    finally:
        close_db(db)


def get_tasks_by_status_paginated(
    status: TaskStatus,
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    file_id: str | None = None,
    task_types: list[TaskType] | None = None,
    date_ranges: list[str] | None = None,
    subtitle_languages: list[str] | None = None,
    scene_detectors: list[str] | None = None,
    directory_ids: list[str] | None = None,
    directory_exclude: bool = False,
) -> tuple[List[Task], int]:
    """Get paginated tasks by status with total count."""
    db = get_db()

    try:
        query = db.query(TaskRecord, FileRecord).outerjoin(
            FileRecord, TaskRecord.file_id == FileRecord.id
        ).filter(TaskRecord.status == status)

        if file_id:
            query = query.filter(TaskRecord.file_id == file_id)

        if search:
            query = query.filter(or_(
                FileRecord.name.ilike(f"%{search}%"),
                TaskRecord.merge_input_paths.ilike(f"%{search}%"),
            ))

        query = _apply_task_filters(
            query,
            task_types=task_types,
            date_ranges=date_ranges,
            subtitle_languages=subtitle_languages,
            scene_detectors=scene_detectors,
            directory_ids=directory_ids,
            directory_exclude=directory_exclude,
        )

        if status == TaskStatus.QUEUED:
            query = query.order_by(nullslast(TaskRecord.queue_position.asc()), TaskRecord.created_at.asc())
        elif status == TaskStatus.PAUSED:
            query = query.order_by(nullslast(TaskRecord.paused_at.desc()), TaskRecord.created_at.desc())
        elif status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
            query = query.order_by(nullslast(TaskRecord.completed_at.desc()), TaskRecord.created_at.desc())
        else:
            query = query.order_by(TaskRecord.created_at.desc())

        total = query.count()
        results = query.offset(skip).limit(limit).all()

        tasks = [t for t in (record_to_task(task_rec, file_rec) for task_rec, file_rec in results) if t is not None]
        return tasks, total

    except Exception as e:
        logging.error(f"Error fetching paginated tasks with status {status}: {e}")
        return [], 0

    finally:
        close_db(db)


def bulk_update_queue_positions(ordered_task_ids: list[str]) -> None:
    """Persist queue_position for each task ID based on its index in ordered_task_ids."""
    db = get_db()
    try:
        for i, task_id in enumerate(ordered_task_ids):
            db.query(TaskRecord).filter(TaskRecord.id == task_id).update({"queue_position": i + 1})
        db.commit()
    except Exception as e:
        logging.error(f"Error updating queue positions: {e}")
        db.rollback()
    finally:
        close_db(db)


def get_task_stats() -> dict:
    """Get task statistics in a single query"""
    db = get_db()

    try:
        result = db.query(
            func.count(TaskRecord.id).label("total"),
            func.sum(case((TaskRecord.status == TaskStatus.QUEUED, 1), else_=0)).label("queued"),
            func.sum(case((TaskRecord.status == TaskStatus.PROCESSING, 1), else_=0)).label("processing"),
            func.sum(case((TaskRecord.status == TaskStatus.COMPLETED, 1), else_=0)).label("completed"),
            func.sum(case((TaskRecord.status == TaskStatus.FAILED, 1), else_=0)).label("failed"),
            func.sum(case((TaskRecord.status == TaskStatus.CANCELLED, 1), else_=0)).label("cancelled"),
            func.sum(case((TaskRecord.status == TaskStatus.PAUSED, 1), else_=0)).label("paused"),
        ).first()

        return {
            "total": result.total or 0,
            "queued": result.queued or 0,
            "processing": result.processing or 0,
            "completed": result.completed or 0,
            "failed": result.failed or 0,
            "cancelled": result.cancelled or 0,
            "paused": result.paused or 0,
        }

    except Exception as e:
        logging.error(f"Error fetching task statistics: {e}")
        return {}

    finally:
        close_db(db)


def has_completed_split(file_id: str) -> bool:
    """Check if a file has already been successfully split"""
    db = get_db()
    try:
        record = db.query(TaskRecord).filter(
            TaskRecord.file_id == file_id,
            TaskRecord.type.in_([TaskType.SPLIT, TaskType.ALL]),
            TaskRecord.status == TaskStatus.COMPLETED,
            TaskRecord.split_count > 0,
        ).first()
        return record is not None
    except Exception as e:
        logging.error(f"Error checking split status for file {file_id}: {e}")
        return False
    finally:
        close_db(db)


def has_completed_subtitles(file_id: str) -> bool:
    """Check if a file has already had subtitles generated"""
    db = get_db()
    try:
        record = db.query(TaskRecord).filter(
            TaskRecord.file_id == file_id,
            TaskRecord.type.in_([TaskType.SUBTITLE, TaskType.ALL]),
            TaskRecord.status == TaskStatus.COMPLETED,
            TaskRecord.subtitle_progress >= 100.0,
        ).first()
        return record is not None
    except Exception as e:
        logging.error(f"Error checking subtitle status for file {file_id}: {e}")
        return False
    finally:
        close_db(db)


def has_active_task(file_id: str, task_type: TaskType) -> bool:
    """Return True if a QUEUED or PROCESSING task already exists for this file+type."""
    db = get_db()
    try:
        record = db.query(TaskRecord).filter(
            TaskRecord.file_id == file_id,
            TaskRecord.type == task_type,
            TaskRecord.status.notin_([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]),
        ).first()
        return record is not None
    except Exception as e:
        logging.error(f"Error checking active task for file {file_id}: {e}")
        return False
    finally:
        close_db(db)


def has_cancelled_or_failed_task(file_id: str, task_type: TaskType) -> bool:
    """Check if a task already exists with CANCELLED or FAILED status for the given file and type"""
    db = get_db()
    try:
        record = db.query(TaskRecord).filter(
            TaskRecord.file_id == file_id,
            TaskRecord.type == task_type,
            TaskRecord.status.in_([TaskStatus.CANCELLED, TaskStatus.FAILED]),
        ).first()
        return record is not None
    except Exception as e:
        logging.error(f"Error checking cancelled/failed task for file {file_id}: {e}")
        return False
    finally:
        close_db(db)


def has_active_split_task(file_id: str) -> bool:
    """Check if a QUEUED or PROCESSING split task already exists for this file."""
    db = get_db()
    try:
        record = db.query(TaskRecord).filter(
            TaskRecord.file_id == file_id,
            TaskRecord.type.in_([TaskType.SPLIT, TaskType.ALL]),
            TaskRecord.status.in_([TaskStatus.QUEUED, TaskStatus.PROCESSING]),
        ).first()
        return record is not None
    except Exception as e:
        logging.error(f"Error checking active split task for file {file_id}: {e}")
        return False
    finally:
        close_db(db)


def get_overview_stats() -> dict:
    """Get comprehensive overview statistics across all domains"""
    db = get_db()
    try:
        # ===== PROCESSING STATS =====
        total = db.query(TaskRecord).count()
        queued = db.query(TaskRecord).filter(TaskRecord.status == TaskStatus.QUEUED).count()
        processing = db.query(TaskRecord).filter(TaskRecord.status == TaskStatus.PROCESSING).count()
        completed = db.query(TaskRecord).filter(TaskRecord.status == TaskStatus.COMPLETED).count()
        failed = db.query(TaskRecord).filter(TaskRecord.status == TaskStatus.FAILED).count()
        cancelled = db.query(TaskRecord).filter(TaskRecord.status == TaskStatus.CANCELLED).count()

        # By task type
        scene_count = db.query(TaskRecord).filter(TaskRecord.type == TaskType.SCENE).count()
        split_count = db.query(TaskRecord).filter(TaskRecord.type == TaskType.SPLIT).count()
        subtitle_count = db.query(TaskRecord).filter(TaskRecord.type == TaskType.SUBTITLE).count()
        all_count = db.query(TaskRecord).filter(TaskRecord.type == TaskType.ALL).count()
        merge_count = db.query(TaskRecord).filter(TaskRecord.type == TaskType.MERGE).count()
        analyze_frame_pacing_count = db.query(TaskRecord).filter(TaskRecord.type == TaskType.ANALYZE_FRAME_PACING).count()
        nvenc_frame_pacing_count = db.query(TaskRecord).filter(TaskRecord.type == TaskType.NVENC_FRAME_PACING).count()
        remux_count = db.query(TaskRecord).filter(TaskRecord.type == TaskType.REMUX).count()

        # Rates
        success_rate = (completed / (completed + failed) * 100) if (completed + failed) > 0 else 0.0
        error_rate = (failed / total * 100) if total > 0 else 0.0

        # Timing stats (only for completed tasks)
        timing_stats = db.query(
            func.avg(TaskRecord.elapsed_seconds).label("avg"),
            func.min(TaskRecord.elapsed_seconds).label("min"),
            func.max(TaskRecord.elapsed_seconds).label("max"),
        ).filter(TaskRecord.status == TaskStatus.COMPLETED).first()

        avg_elapsed = float(timing_stats.avg) if timing_stats.avg else None
        min_elapsed = int(timing_stats.min) if timing_stats.min else None
        max_elapsed = int(timing_stats.max) if timing_stats.max else None

        # Output totals
        total_scenes = db.query(func.sum(TaskRecord.scene_count)).filter(
            TaskRecord.status == TaskStatus.COMPLETED,
            TaskRecord.type.in_([TaskType.SCENE, TaskType.ALL])
        ).scalar() or 0
        total_splits = db.query(func.sum(TaskRecord.split_count)).filter(
            TaskRecord.status == TaskStatus.COMPLETED,
            TaskRecord.type.in_([TaskType.SPLIT, TaskType.ALL])
        ).scalar() or 0

        # ===== FILE COVERAGE STATS =====
        total_files = db.query(FileRecord).count()

        # Files with scenes: count distinct files from completed scene/all tasks
        with_scenes = db.query(func.count(func.distinct(TaskRecord.file_id))).filter(
            TaskRecord.type.in_([TaskType.SCENE, TaskType.ALL]),
            TaskRecord.status == TaskStatus.COMPLETED,
            TaskRecord.scene_count > 0
        ).scalar() or 0

        # Files with split
        with_split = db.query(func.count(func.distinct(TaskRecord.file_id))).filter(
            TaskRecord.type.in_([TaskType.SPLIT, TaskType.ALL]),
            TaskRecord.status == TaskStatus.COMPLETED,
            TaskRecord.split_count > 0
        ).scalar() or 0

        # Files with subtitle
        with_subtitle = db.query(func.count(func.distinct(TaskRecord.file_id))).filter(
            TaskRecord.type.in_([TaskType.SUBTITLE, TaskType.ALL]),
            TaskRecord.status == TaskStatus.COMPLETED,
            TaskRecord.subtitle_progress >= 100.0
        ).scalar() or 0

        pct_with_scenes = (with_scenes / total_files * 100) if total_files > 0 else 0.0
        pct_with_split = (with_split / total_files * 100) if total_files > 0 else 0.0
        pct_with_subtitle = (with_subtitle / total_files * 100) if total_files > 0 else 0.0

        # ===== STORAGE STATS =====
        storage_stats = db.query(
            func.sum(FileRecord.size).label("total"),
            func.avg(FileRecord.size).label("avg"),
            func.max(FileRecord.size).label("max"),
        ).first()

        total_bytes = int(storage_stats.total) if storage_stats.total else 0
        avg_bytes = int(storage_stats.avg) if storage_stats.avg else 0
        max_bytes = int(storage_stats.max) if storage_stats.max else 0
        zero_byte_files = db.query(FileRecord).filter(FileRecord.size <= 0).count()
        video_rows = db.query(FileRecord.size, FileRecord.duration).filter(
            FileRecord.file_type == "video"
        ).all()
        video_files = len(video_rows)
        duration_values = [
            (seconds, int(size or 0))
            for size, duration in video_rows
            if (seconds := _duration_to_seconds(duration)) is not None
        ]
        known_duration_files = len(duration_values)
        missing_duration_files = max(video_files - known_duration_files, 0)
        total_duration_seconds = float(sum(seconds for seconds, _ in duration_values))
        known_duration_bytes = sum(size for _, size in duration_values)
        avg_duration_seconds = (
            total_duration_seconds / known_duration_files if known_duration_files > 0 else None
        )
        min_duration_seconds = min((seconds for seconds, _ in duration_values), default=None)
        max_duration_seconds = max((seconds for seconds, _ in duration_values), default=None)
        avg_bitrate_mbps = (
            (known_duration_bytes * 8 / total_duration_seconds) / 1_000_000
            if total_duration_seconds > 0
            else None
        )

        # Format distribution
        format_dist = db.query(
            FileRecord.format,
            func.count(FileRecord.id).label("count")
        ).filter(FileRecord.format.isnot(None)).group_by(FileRecord.format).all()
        by_format = {row[0] or "unknown": row[1] for row in format_dist}

        # Codec distribution
        codec_dist = db.query(
            FileRecord.codec,
            func.count(FileRecord.id).label("count")
        ).filter(FileRecord.codec.isnot(None)).group_by(FileRecord.codec).all()
        by_codec = {row[0] or "unknown": row[1] for row in codec_dist}

        # Resolution buckets
        res_4k = db.query(FileRecord).filter(FileRecord.width >= 3840).count()
        res_1080p = db.query(FileRecord).filter(FileRecord.width >= 1920, FileRecord.width < 3840).count()
        res_720p = db.query(FileRecord).filter(FileRecord.width >= 1280, FileRecord.width < 1920).count()
        res_sd = db.query(FileRecord).filter(
            (FileRecord.width < 1280) | (FileRecord.width.is_(None))
        ).count()

        # ===== SCENE STATS =====
        total_scene_records = db.query(SceneRecord).count()

        files_with_scene_records = db.query(func.count(func.distinct(SceneRecord.file_id))).filter(
            SceneRecord.id.isnot(None)
        ).scalar() or 1  # Prevent division by zero

        avg_scenes_per_file = float(total_scene_records) / float(files_with_scene_records) if files_with_scene_records > 0 else 0.0

        scene_duration_stats = db.query(
            func.avg(SceneRecord.duration_seconds).label("avg"),
            func.min(SceneRecord.duration_seconds).label("min"),
            func.max(SceneRecord.duration_seconds).label("max"),
        ).first()

        avg_scene_duration = float(scene_duration_stats.avg) if scene_duration_stats.avg else 0.0
        min_scene_duration = float(scene_duration_stats.min) if scene_duration_stats.min else None
        max_scene_duration = float(scene_duration_stats.max) if scene_duration_stats.max else None

        # ===== DIRECTORY STATS =====
        total_directories = db.query(DirectoryRecord).count()

        # Top 5 directories by file count
        top_dirs_query = db.query(
            DirectoryRecord.name,
            DirectoryRecord.path,
            func.count(FileRecord.id).label("file_count")
        ).outerjoin(FileRecord, DirectoryRecord.id == FileRecord.directory_id).group_by(DirectoryRecord.id).order_by(
            func.count(FileRecord.id).desc()
        ).limit(5).all()

        top_directories = [
            {"name": row[0], "path": row[1], "file_count": row[2]}
            for row in top_dirs_query
        ]

        # Monitor stats
        total_monitors = db.query(DirectoryMonitorRecord).count()
        active_monitors = db.query(DirectoryMonitorRecord).filter(DirectoryMonitorRecord.is_active).count()

        # Schedule distribution
        schedule_dist = db.query(
            DirectoryMonitorRecord.schedule_interval,
            func.count(DirectoryMonitorRecord.id).label("count")
        ).group_by(DirectoryMonitorRecord.schedule_interval).all()
        monitors_by_schedule = {row[0] or "unknown": row[1] for row in schedule_dist}

        return {
            "processing": {
                "total": total,
                "queued": queued,
                "processing": processing,
                "completed": completed,
                "failed": failed,
                "cancelled": cancelled,
                "by_type": {
                "scene": scene_count,
                "split": split_count,
                "subtitle": subtitle_count,
                "all": all_count,
                "merge": merge_count,
                "analyze_frame_pacing": analyze_frame_pacing_count,
                "nvenc_frame_pacing": nvenc_frame_pacing_count,
                "remux": remux_count,
            },
                "success_rate": success_rate,
                "error_rate": error_rate,
                "avg_elapsed_seconds": avg_elapsed,
                "min_elapsed_seconds": min_elapsed,
                "max_elapsed_seconds": max_elapsed,
                "total_scenes_generated": total_scenes,
                "total_splits_generated": total_splits,
            },
            "coverage": {
                "total_files": total_files,
                "with_scenes": with_scenes,
                "with_split": with_split,
                "with_subtitle": with_subtitle,
                "pct_with_scenes": pct_with_scenes,
                "pct_with_split": pct_with_split,
                "pct_with_subtitle": pct_with_subtitle,
            },
            "storage": {
                "total_bytes": total_bytes,
                "avg_bytes": avg_bytes,
                "max_bytes": max_bytes,
                "zero_byte_files": zero_byte_files,
                "video_files": video_files,
                "by_format": by_format,
                "by_codec": by_codec,
                "res_4k": res_4k,
                "res_1080p": res_1080p,
                "res_720p": res_720p,
                "res_sd": res_sd,
                "known_duration_files": known_duration_files,
                "missing_duration_files": missing_duration_files,
                "total_duration_seconds": total_duration_seconds,
                "avg_duration_seconds": avg_duration_seconds,
                "min_duration_seconds": min_duration_seconds,
                "max_duration_seconds": max_duration_seconds,
                "avg_bitrate_mbps": avg_bitrate_mbps,
            },
            "scenes": {
                "total_scenes": total_scene_records,
                "avg_scenes_per_file": avg_scenes_per_file,
                "avg_scene_duration_seconds": avg_scene_duration,
                "min_scene_duration_seconds": min_scene_duration,
                "max_scene_duration_seconds": max_scene_duration,
            },
            "directories": {
                "total_directories": total_directories,
                "top_directories": top_directories,
                "total_monitors": total_monitors,
                "active_monitors": active_monitors,
                "monitors_by_schedule": monitors_by_schedule,
            },
        }

    except Exception as e:
        logging.error(f"Error fetching overview statistics: {e}")
        return {
            "processing": {
                "total": 0, "queued": 0, "processing": 0, "completed": 0, "failed": 0, "cancelled": 0,
                "by_type": {"scene": 0, "split": 0, "subtitle": 0, "all": 0, "merge": 0, "analyze_frame_pacing": 0, "nvenc_frame_pacing": 0, "remux": 0},
                "success_rate": 0.0, "error_rate": 0.0,
                "avg_elapsed_seconds": None, "min_elapsed_seconds": None, "max_elapsed_seconds": None,
                "total_scenes_generated": 0, "total_splits_generated": 0,
            },
            "coverage": {
                "total_files": 0, "with_scenes": 0, "with_split": 0, "with_subtitle": 0,
                "pct_with_scenes": 0.0, "pct_with_split": 0.0, "pct_with_subtitle": 0.0,
            },
            "storage": {
                "total_bytes": 0, "avg_bytes": 0, "max_bytes": 0, "zero_byte_files": 0, "video_files": 0,
                "by_format": {}, "by_codec": {},
                "res_4k": 0, "res_1080p": 0, "res_720p": 0, "res_sd": 0,
                "known_duration_files": 0, "missing_duration_files": 0,
                "total_duration_seconds": 0.0,
                "avg_duration_seconds": None,
                "min_duration_seconds": None,
                "max_duration_seconds": None,
                "avg_bitrate_mbps": None,
            },
            "scenes": {
                "total_scenes": 0, "avg_scenes_per_file": 0.0,
                "avg_scene_duration_seconds": 0.0,
                "min_scene_duration_seconds": None, "max_scene_duration_seconds": None,
            },
            "directories": {
                "total_directories": 0, "top_directories": [],
                "total_monitors": 0, "active_monitors": 0,
                "monitors_by_schedule": {},
            },
        }

    finally:
        close_db(db)
