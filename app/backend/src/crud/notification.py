import logging
from datetime import datetime, timedelta
from uuid import uuid4

from ..models.notification import Notification, NotificationType, NotificationsResponse
from ..utils import utc_isoformat
from ..schemas.db_helper import close_db, get_db
from ..schemas.notification import NotificationRecord


def create_notification(
    type: NotificationType,
    title: str,
    message: str,
    task_id: str | None = None,
    file_id: str | None = None,
) -> Notification:
    """Create a new notification in the database."""
    db = get_db()
    try:
        notification_id = str(uuid4())
        record = NotificationRecord(
            id=notification_id,
            type=type.value,
            title=title,
            message=message,
            task_id=task_id,
            file_id=file_id,
            is_read=0,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record_to_notification(record)
    except Exception as e:
        db.rollback()
        logging.error(f"Error creating notification: {e}")
        raise
    finally:
        close_db(db)


def record_to_notification(record: NotificationRecord) -> Notification:
    """Convert database record to Notification model."""
    return Notification(
        id=record.id,
        type=NotificationType(record.type),
        title=record.title,
        message=record.message,
        task_id=record.task_id,
        file_id=record.file_id,
        is_read=bool(record.is_read),
        created_at=utc_isoformat(record.created_at) if record.created_at else "",
    )


def get_notifications(page: int = 1, limit: int = 50) -> NotificationsResponse:
    """Get paginated notifications, newest first."""
    db = get_db()
    try:
        offset = (page - 1) * limit
        total = db.query(NotificationRecord).count()
        unread_count = db.query(NotificationRecord).filter(NotificationRecord.is_read == 0).count()

        records = (
            db.query(NotificationRecord)
            .order_by(NotificationRecord.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        notifications = [record_to_notification(r) for r in records]
        return NotificationsResponse(
            notifications=notifications,
            total=total,
            unread_count=unread_count,
            page=page,
            limit=limit,
        )
    except Exception as e:
        logging.error(f"Error fetching notifications: {e}")
        raise
    finally:
        close_db(db)


def mark_notification_read(notification_id: str) -> bool:
    """Mark a notification as read. Returns True if found, False otherwise."""
    db = get_db()
    try:
        record = db.query(NotificationRecord).filter(NotificationRecord.id == notification_id).first()
        if not record:
            return False
        record.is_read = 1
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logging.error(f"Error marking notification as read: {e}")
        raise
    finally:
        close_db(db)


def mark_all_notifications_read() -> int:
    """Mark all notifications as read. Returns count of affected rows."""
    db = get_db()
    try:
        count = db.query(NotificationRecord).filter(NotificationRecord.is_read == 0).count()
        db.query(NotificationRecord).filter(NotificationRecord.is_read == 0).update({NotificationRecord.is_read: 1})
        db.commit()
        return count
    except Exception as e:
        db.rollback()
        logging.error(f"Error marking all notifications as read: {e}")
        raise
    finally:
        close_db(db)


def delete_all_notifications() -> int:
    """Delete all notifications. Returns count of deleted rows."""
    db = get_db()
    try:
        count = db.query(NotificationRecord).count()
        db.query(NotificationRecord).delete()
        db.commit()
        return count
    except Exception as e:
        db.rollback()
        logging.error(f"Error deleting all notifications: {e}")
        raise
    finally:
        close_db(db)


def cleanup_old_notifications(days: int = 30) -> int:
    """Delete notifications older than specified days. Returns count of deleted rows."""
    db = get_db()
    try:
        cutoff = datetime.utcnow() - timedelta(days=days)
        count = db.query(NotificationRecord).filter(NotificationRecord.created_at < cutoff).count()
        db.query(NotificationRecord).filter(NotificationRecord.created_at < cutoff).delete()
        db.commit()
        if count > 0:
            logging.info(f"Cleaned up {count} notifications older than {days} days")
        return count
    except Exception as e:
        db.rollback()
        logging.error(f"Error cleaning up old notifications: {e}")
        raise
    finally:
        close_db(db)
