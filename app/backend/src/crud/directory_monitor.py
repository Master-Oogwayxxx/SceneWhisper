import logging
import json
from datetime import datetime
from typing import List, Optional

from ..models.models import DirectoryMonitor, Schedule, TaskType
from ..utils import utc_isoformat
from ..schemas.db_helper import close_db, get_db
from ..schemas.directory_monitor import DirectoryMonitorRecord


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        logging.warning("Invalid datetime string for directory monitor: %s", value)
        return None


def _normalized_delete_after_completion(monitor: DirectoryMonitor) -> bool:
    return bool(monitor.deleteVideoAfterCompletion) if TaskType.SPLIT in set(monitor.taskTypes or [monitor.taskType]) else False


def _serialize_task_types(monitor: DirectoryMonitor) -> str:
    return json.dumps([task_type.value if isinstance(task_type, TaskType) else task_type for task_type in (monitor.taskTypes or [monitor.taskType])])


def _deserialize_task_types(record: DirectoryMonitorRecord) -> list[TaskType]:
    if record.task_types:
        try:
            values = json.loads(record.task_types)
            if isinstance(values, list) and values:
                return [TaskType(value) for value in values]
        except (TypeError, ValueError):
            logging.warning("Invalid task_types for directory monitor %s: %s", record.id, record.task_types)
    return [record.task_type]


def _serialize_frame_pacing_resolutions(monitor: DirectoryMonitor) -> str:
    return json.dumps([value for value in (monitor.framePacingResolutions or []) if value != "4k"])


def _deserialize_frame_pacing_resolutions(record: DirectoryMonitorRecord) -> list[str]:
    raw = getattr(record, "frame_pacing_resolution", None)
    if not raw or raw == "all":
        return []
    try:
        values = json.loads(raw)
        if isinstance(values, list):
            return [value for value in values if value in {"sd", "720p", "1080p", "1440p"}]
    except (TypeError, ValueError):
        pass
    return [raw] if raw in {"sd", "720p", "1080p", "1440p"} else []


def record_to_directory_monitor(record: DirectoryMonitorRecord) -> DirectoryMonitor:
    """Convert database record to DirectoryMonitor model."""
    return DirectoryMonitor(
        id=record.id,
        directoryId=record.directory_id,
        directoryName=record.directory_name,
        directoryPath=record.directory_path,
        taskType=record.task_type,
        taskTypes=_deserialize_task_types(record),
        subtitleLanguage=record.subtitle_language,
        schedule=Schedule(
            interval=record.schedule_interval,
            time=record.schedule_time,
            dayOfWeek=record.schedule_day_of_week,
            timeZone=record.schedule_timezone,
        ),
        isActive=record.is_active,
        deleteVideoAfterCompletion=record.delete_video_after_completion,
        fillMissingSubtitles=record.fill_missing_subtitles,
        splitScope=record.split_scope,
        framePacingScope=record.frame_pacing_scope or "all",
        framePacingResolution="all",
        framePacingResolutions=_deserialize_frame_pacing_resolutions(record),
        nvencOverwriteOriginal=record.nvenc_overwrite_original or False,
        lastRun=utc_isoformat(record.last_run) if record.last_run else None,
        nextRun=utc_isoformat(record.next_run) if record.next_run else None,
        createdAt=utc_isoformat(record.created_at) if record.created_at else "",
    )


def create_directory_monitor(monitor: DirectoryMonitor) -> DirectoryMonitor:
    """Create a new directory monitor row."""
    db = get_db()
    try:
        now = _parse_dt(monitor.createdAt) or datetime.utcnow()
        record = DirectoryMonitorRecord(
            id=monitor.id,
            directory_id=monitor.directoryId,
            directory_name=monitor.directoryName,
            directory_path=monitor.directoryPath,
            task_type=monitor.taskType,
            task_types=_serialize_task_types(monitor),
            subtitle_language=monitor.subtitleLanguage,
            schedule_interval=monitor.schedule.interval,
            schedule_time=monitor.schedule.time,
            schedule_day_of_week=monitor.schedule.dayOfWeek,
            schedule_timezone=monitor.schedule.timeZone,
            is_active=monitor.isActive,
            delete_video_after_completion=_normalized_delete_after_completion(monitor),
            fill_missing_subtitles=monitor.fillMissingSubtitles,
            split_scope=monitor.splitScope,
            frame_pacing_scope=monitor.framePacingScope,
            frame_pacing_resolution=_serialize_frame_pacing_resolutions(monitor),
            nvenc_overwrite_original=monitor.nvencOverwriteOriginal,
            last_run=_parse_dt(monitor.lastRun),
            next_run=_parse_dt(monitor.nextRun),
            created_at=now,
            updated_at=now,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record_to_directory_monitor(record)
    finally:
        close_db(db)


def get_directory_monitor(monitor_id: str) -> Optional[DirectoryMonitor]:
    """Get a directory monitor by id."""
    db = get_db()
    try:
        record = db.query(DirectoryMonitorRecord).filter(DirectoryMonitorRecord.id == monitor_id).first()
        if record:
            return record_to_directory_monitor(record)
        return None
    except Exception as e:
        logging.error("Error fetching directory monitor %s: %s", monitor_id, e)
        return None
    finally:
        close_db(db)


def get_all_directory_monitors() -> List[DirectoryMonitor]:
    """List all directory monitors (newest first)."""
    db = get_db()
    try:
        records = db.query(DirectoryMonitorRecord).order_by(DirectoryMonitorRecord.created_at.desc()).all()
        return [record_to_directory_monitor(r) for r in records]
    except Exception as e:
        logging.error("Error fetching directory monitors: %s", e)
        return []
    finally:
        close_db(db)


def update_directory_monitor(monitor: DirectoryMonitor) -> DirectoryMonitor:
    """Update an existing directory monitor."""
    db = get_db()
    try:
        record = db.query(DirectoryMonitorRecord).filter(DirectoryMonitorRecord.id == monitor.id).first()
        if not record:
            return monitor

        record.directory_id = monitor.directoryId
        record.directory_name = monitor.directoryName
        record.directory_path = monitor.directoryPath
        record.task_type = monitor.taskType
        record.task_types = _serialize_task_types(monitor)
        record.subtitle_language = monitor.subtitleLanguage
        record.schedule_interval = monitor.schedule.interval
        record.schedule_time = monitor.schedule.time
        record.schedule_day_of_week = monitor.schedule.dayOfWeek
        record.schedule_timezone = monitor.schedule.timeZone
        record.is_active = monitor.isActive
        record.delete_video_after_completion = _normalized_delete_after_completion(monitor)
        record.fill_missing_subtitles = monitor.fillMissingSubtitles
        record.split_scope = monitor.splitScope
        record.frame_pacing_scope = monitor.framePacingScope
        record.frame_pacing_resolution = _serialize_frame_pacing_resolutions(monitor)
        record.nvenc_overwrite_original = monitor.nvencOverwriteOriginal
        record.last_run = _parse_dt(monitor.lastRun)
        record.next_run = _parse_dt(monitor.nextRun)
        record.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(record)
        return record_to_directory_monitor(record)
    except Exception as e:
        logging.error("Error updating directory monitor %s: %s", monitor.id, e)
        return monitor
    finally:
        close_db(db)


def delete_directory_monitor(monitor_id: str) -> bool:
    """Delete a directory monitor by id."""
    db = get_db()
    try:
        record = db.query(DirectoryMonitorRecord).filter(DirectoryMonitorRecord.id == monitor_id).first()
        if record:
            db.delete(record)
            db.commit()
            return True
        return False
    except Exception as e:
        logging.error("Error deleting directory monitor %s: %s", monitor_id, e)
        return False
    finally:
        close_db(db)
