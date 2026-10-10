import json
import logging
from datetime import datetime

from sqlalchemy.orm import Session

from ..models.models import ActressDownloadMonitor, ActressDownloadMonitorCriteria, Schedule
from ..schemas.actress_download_monitor import ActressDownloadMonitorRecord
from ..utils import utc_isoformat


def _parse_dt(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        logging.warning("Invalid datetime string for actress download monitor: %s", value)
        return None


def _load_criteria(raw: str | None) -> ActressDownloadMonitorCriteria:
    if not raw:
        return ActressDownloadMonitorCriteria()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return ActressDownloadMonitorCriteria()
    if not isinstance(data, dict):
        return ActressDownloadMonitorCriteria()
    return ActressDownloadMonitorCriteria(**data)


def _dump_criteria(criteria: ActressDownloadMonitorCriteria) -> str:
    return criteria.model_dump_json()


def record_to_actress_download_monitor(record: ActressDownloadMonitorRecord) -> ActressDownloadMonitor:
    return ActressDownloadMonitor(
        id=record.id,
        actressId=record.actress_id,
        actressName=record.actress_name,
        schedule=Schedule(
            interval=record.schedule_interval,
            time=record.schedule_time,
            dayOfWeek=record.schedule_day_of_week,
        ),
        isActive=record.is_active,
        criteria=_load_criteria(record.criteria),
        maxItemsPerRun=record.max_items_per_run,
        savePath=record.save_path,
        lastRun=utc_isoformat(record.last_run) if record.last_run else None,
        nextRun=utc_isoformat(record.next_run) if record.next_run else None,
        lastQueued=record.last_queued,
        lastSkipped=record.last_skipped,
        lastError=record.last_error,
        createdAt=utc_isoformat(record.created_at) if record.created_at else "",
    )


def create_actress_download_monitor(db: Session, monitor: ActressDownloadMonitor) -> ActressDownloadMonitor:
    now = _parse_dt(monitor.createdAt) or datetime.utcnow()
    record = ActressDownloadMonitorRecord(
        id=monitor.id,
        actress_id=monitor.actressId,
        actress_name=monitor.actressName,
        schedule_interval=monitor.schedule.interval,
        schedule_time=monitor.schedule.time,
        schedule_day_of_week=monitor.schedule.dayOfWeek,
        is_active=monitor.isActive,
        criteria=_dump_criteria(monitor.criteria),
        max_items_per_run=monitor.maxItemsPerRun,
        save_path=monitor.savePath.strip() if monitor.savePath and monitor.savePath.strip() else None,
        last_run=_parse_dt(monitor.lastRun),
        next_run=_parse_dt(monitor.nextRun),
        last_queued=monitor.lastQueued,
        last_skipped=monitor.lastSkipped,
        last_error=monitor.lastError,
        created_at=now,
        updated_at=now,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record_to_actress_download_monitor(record)


def get_actress_download_monitor(db: Session, monitor_id: str) -> ActressDownloadMonitor | None:
    record = db.query(ActressDownloadMonitorRecord).filter(ActressDownloadMonitorRecord.id == monitor_id).first()
    return record_to_actress_download_monitor(record) if record else None


def get_all_actress_download_monitors(db: Session) -> list[ActressDownloadMonitor]:
    records = db.query(ActressDownloadMonitorRecord).order_by(ActressDownloadMonitorRecord.created_at.desc()).all()
    return [record_to_actress_download_monitor(record) for record in records]


def update_actress_download_monitor(db: Session, monitor: ActressDownloadMonitor) -> ActressDownloadMonitor | None:
    record = db.query(ActressDownloadMonitorRecord).filter(ActressDownloadMonitorRecord.id == monitor.id).first()
    if record is None:
        return None

    record.actress_id = monitor.actressId
    record.actress_name = monitor.actressName
    record.schedule_interval = monitor.schedule.interval
    record.schedule_time = monitor.schedule.time
    record.schedule_day_of_week = monitor.schedule.dayOfWeek
    record.is_active = monitor.isActive
    record.criteria = _dump_criteria(monitor.criteria)
    record.max_items_per_run = monitor.maxItemsPerRun
    record.save_path = monitor.savePath.strip() if monitor.savePath and monitor.savePath.strip() else None
    record.last_run = _parse_dt(monitor.lastRun)
    record.next_run = _parse_dt(monitor.nextRun)
    record.last_queued = monitor.lastQueued
    record.last_skipped = monitor.lastSkipped
    record.last_error = monitor.lastError
    record.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(record)
    return record_to_actress_download_monitor(record)


def update_actress_download_monitor_run(
    db: Session,
    monitor: ActressDownloadMonitor,
    *,
    queued: int,
    skipped: int,
    last_error: str | None,
    next_run: datetime,
) -> ActressDownloadMonitor | None:
    updated = monitor.model_copy(
        update={
            "lastRun": utc_isoformat(datetime.utcnow()),
            "nextRun": utc_isoformat(next_run),
            "lastQueued": queued,
            "lastSkipped": skipped,
            "lastError": last_error,
        }
    )
    return update_actress_download_monitor(db, updated)


def delete_actress_download_monitor(db: Session, monitor_id: str) -> bool:
    record = db.query(ActressDownloadMonitorRecord).filter(ActressDownloadMonitorRecord.id == monitor_id).first()
    if record is None:
        return False
    db.delete(record)
    db.commit()
    return True
