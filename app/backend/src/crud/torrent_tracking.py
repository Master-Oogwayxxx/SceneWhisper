from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..schemas.torrent_tracking import TorrentTrackingRecord


MISSING_TORRENT_GRACE_SECONDS = 300


def insert_tracking(db: Session, content_id: str, torrent_name: str, video_code: str = "") -> TorrentTrackingRecord:
    row = TorrentTrackingRecord(
        content_id=content_id,
        video_code=video_code or content_id,
        torrent_name=torrent_name,
        status="downloading",
        added_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_tracking_by_content_id(db: Session, content_id: str) -> TorrentTrackingRecord | None:
    return (
        db.query(TorrentTrackingRecord)
        .filter(TorrentTrackingRecord.content_id == content_id)
        .order_by(TorrentTrackingRecord.id.desc())
        .first()
    )


def get_tracking_by_video_code(db: Session, video_code: str) -> TorrentTrackingRecord | None:
    return (
        db.query(TorrentTrackingRecord)
        .filter(TorrentTrackingRecord.video_code == video_code)
        .order_by(TorrentTrackingRecord.id.desc())
        .first()
    )


def get_all_tracking(db: Session) -> list[TorrentTrackingRecord]:
    return db.query(TorrentTrackingRecord).all()


def update_hash(db: Session, record_id: int, torrent_hash: str) -> None:
    from sqlalchemy.exc import IntegrityError
    try:
        db.query(TorrentTrackingRecord).filter(TorrentTrackingRecord.id == record_id).update(
            {"torrent_hash": torrent_hash}
        )
        db.commit()
    except IntegrityError:
        db.rollback()


def update_status(
    db: Session,
    record_id: int,
    status: str,
    completed_at: Optional[datetime] = None,
) -> None:
    values: dict = {"status": status}
    if completed_at is not None:
        values["completed_at"] = completed_at
    db.query(TorrentTrackingRecord).filter(TorrentTrackingRecord.id == record_id).update(values)
    db.commit()


def is_within_missing_torrent_grace_period(
    row: TorrentTrackingRecord,
    *,
    now: Optional[datetime] = None,
    grace_seconds: int = MISSING_TORRENT_GRACE_SECONDS,
) -> bool:
    """Return True while a recent tracking row should not be treated as missing."""
    if row.added_at is None:
        return False

    current = now or datetime.now(timezone.utc)
    added_at = row.added_at
    if added_at.tzinfo is None:
        added_at = added_at.replace(tzinfo=timezone.utc)

    return (current - added_at).total_seconds() < grace_seconds


def delete_tracking_by_content_id(db: Session, content_id: str) -> None:
    db.query(TorrentTrackingRecord).filter(
        TorrentTrackingRecord.content_id == content_id
    ).delete()
    db.commit()


def delete_tracking_by_video_code(db: Session, video_code: str) -> None:
    db.query(TorrentTrackingRecord).filter(
        TorrentTrackingRecord.video_code == video_code
    ).delete()
    db.commit()
