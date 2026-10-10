import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from ..schemas.db_helper import close_db, get_db
from ..schemas.log import LogRecord


def get_logs(
    level: Optional[str] = None,
    task_id: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
) -> list[LogRecord]:
    """Return log rows newest-first, with optional filters."""
    db = get_db()
    try:
        q = db.query(LogRecord)
        if level:
            q = q.filter(LogRecord.level == level.upper())
        if task_id is not None:
            q = q.filter(LogRecord.task_id == task_id)
        if search:
            q = q.filter(LogRecord.message.contains(search))
        return q.order_by(LogRecord.id.desc()).offset(skip).limit(limit).all()
    except Exception as e:
        logging.error(f"Error fetching logs: {e}")
        raise
    finally:
        close_db(db)


def get_log_count(
    level: Optional[str] = None,
    task_id: Optional[str] = None,
    search: Optional[str] = None,
) -> int:
    """Return total matching log row count."""
    db = get_db()
    try:
        q = db.query(LogRecord)
        if level:
            q = q.filter(LogRecord.level == level.upper())
        if task_id is not None:
            q = q.filter(LogRecord.task_id == task_id)
        if search:
            q = q.filter(LogRecord.message.contains(search))
        return q.count()
    except Exception as e:
        logging.error(f"Error counting logs: {e}")
        raise
    finally:
        close_db(db)


def get_logs_since(since_id: int, db: Session) -> list[LogRecord]:
    """Return all log rows with id > since_id, oldest-first. Caller owns the db session."""
    return (
        db.query(LogRecord)
        .filter(LogRecord.id > since_id)
        .order_by(LogRecord.id.asc())
        .all()
    )
