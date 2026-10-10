import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..schemas.download_queue import DownloadQueueRecord
from ..schemas.file import FileRecord


def _load_failed_torrent_urls(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return [item for item in value if isinstance(item, str)]


def _dump_failed_torrent_urls(urls: list[str]) -> str:
    return json.dumps(urls)


def _clean_save_path(save_path: str | None) -> str | None:
    if not save_path:
        return None
    cleaned = save_path.strip()
    return cleaned or None


def _video_codes_on_disk_or_db(db: Session, video_codes: list[str]) -> set[str]:
    """Return subset of video_codes that exist in the FileRecord DB or on local disk.

    A code matches if any non-deleted FileRecord name contains it (DB match), or if
    a deleted FileRecord still has its file present on disk.
    """
    if not video_codes:
        return set()

    filters = [FileRecord.name.ilike(f"%{vc}%") for vc in video_codes]
    rows = db.query(FileRecord.name, FileRecord.path, FileRecord.is_deleted).filter(or_(*filters)).all()

    found: set[str] = set()
    for name, path, is_deleted in rows:
        for vc in video_codes:
            if vc.lower() in (name or "").lower():
                if not is_deleted or Path(path).exists():
                    found.add(vc)
    return found


def enqueue_works(db: Session, items: list[tuple[str, str]], save_path: str | None = None) -> int:
    """Insert pending queue items. Skips duplicates already in queue, DB, or on disk.

    Skips if:
    - content_id or video_code is already pending/processing in the queue
    - video_code appears in an indexed FileRecord (non-deleted, or deleted but file still on disk)

    Args:
        items: List of (content_id, video_code) pairs.
        save_path: Optional qBittorrent save path to attach to each queued item.

    Returns the count of rows actually inserted.
    """
    existing_content_ids = {
        r.content_id
        for r in db.query(DownloadQueueRecord.content_id)
        .filter(DownloadQueueRecord.status.in_(["pending", "processing", "done"]))
        .all()
        if r.content_id
    }
    existing_video_codes = {
        r.video_code
        for r in db.query(DownloadQueueRecord.video_code)
        .filter(DownloadQueueRecord.status.in_(["pending", "processing", "done"]))
        .all()
        if r.video_code
    }

    all_video_codes = [vc for _, vc in items if vc]
    already_have = _video_codes_on_disk_or_db(db, all_video_codes)

    max_pos = db.query(func.max(DownloadQueueRecord.position)).scalar() or -1
    next_position = max_pos + 1
    inserted = 0
    cleaned_save_path = _clean_save_path(save_path)
    for content_id, video_code in items:
        if content_id in existing_content_ids:
            continue
        if video_code and video_code in existing_video_codes:
            continue
        if video_code and video_code in already_have:
            continue
        db.add(DownloadQueueRecord(
            content_id=content_id,
            video_code=video_code,
            status="pending",
            added_at=datetime.now(timezone.utc),
            save_path=cleaned_save_path,
            position=next_position + inserted,
        ))
        existing_content_ids.add(content_id)
        if video_code:
            existing_video_codes.add(video_code)
        inserted += 1
    if inserted:
        db.commit()
    return inserted


def get_next_pending(db: Session) -> DownloadQueueRecord | None:
    return (
        db.query(DownloadQueueRecord)
        .filter(DownloadQueueRecord.status == "pending")
        .order_by(DownloadQueueRecord.position)
        .first()
    )


def mark_processing(db: Session, record_id: int) -> None:
    db.query(DownloadQueueRecord).filter(DownloadQueueRecord.id == record_id).update(
        {"status": "processing"}
    )
    db.commit()


def set_torrent_url(db: Session, record_id: int, torrent_url: str) -> None:
    db.query(DownloadQueueRecord).filter(DownloadQueueRecord.id == record_id).update(
        {"torrent_url": torrent_url}
    )
    db.commit()


def mark_done(db: Session, record_id: int, torrent_url: str) -> None:
    db.query(DownloadQueueRecord).filter(DownloadQueueRecord.id == record_id).update(
        {"status": "done", "torrent_url": torrent_url, "processed_at": datetime.now(timezone.utc)}
    )
    db.commit()


def mark_failed(db: Session, record_id: int, error: str) -> None:
    db.query(DownloadQueueRecord).filter(DownloadQueueRecord.id == record_id).update(
        {"status": "failed", "error": error, "processed_at": datetime.now(timezone.utc)}
    )
    db.commit()


def mark_failed_with_candidate(db: Session, record_id: int, error: str, torrent_url: str) -> None:
    row = db.query(DownloadQueueRecord).filter(DownloadQueueRecord.id == record_id).first()
    if row is None:
        return
    failed_urls = _load_failed_torrent_urls(row.failed_torrent_urls)
    if torrent_url not in failed_urls:
        failed_urls.append(torrent_url)
    row.status = "failed"
    row.error = error
    row.torrent_url = torrent_url
    row.failed_torrent_urls = _dump_failed_torrent_urls(failed_urls)
    row.processed_at = datetime.now(timezone.utc)
    db.commit()


def mark_skipped(db: Session, record_id: int) -> None:
    db.query(DownloadQueueRecord).filter(DownloadQueueRecord.id == record_id).update(
        {"status": "skipped", "processed_at": datetime.now(timezone.utc)}
    )
    db.commit()


def mark_processing_by_content_id(db: Session, content_id: str, torrent_url: str | None = None) -> bool:
    values = {
        "status": "processing",
        "error": None,
        "processed_at": None,
    }
    if torrent_url is not None:
        values["torrent_url"] = torrent_url
    updated = (
        db.query(DownloadQueueRecord)
        .filter(
            DownloadQueueRecord.content_id == content_id,
            DownloadQueueRecord.status.in_(["pending", "failed", "skipped"]),
        )
        .update(values)
    )
    db.commit()
    return updated > 0


def retry_queue_item(db: Session, record_id: int) -> bool:
    max_pos = db.query(func.max(DownloadQueueRecord.position)).scalar() or -1
    updated = (
        db.query(DownloadQueueRecord)
        .filter(
            DownloadQueueRecord.id == record_id,
            DownloadQueueRecord.status.in_(["failed", "skipped", "done"]),
        )
        .update(
            {
                "status": "pending",
                "error": None,
                "processed_at": None,
                "position": max_pos + 1,
            }
        )
    )
    db.commit()
    return updated > 0


def get_failed_torrent_urls(record: DownloadQueueRecord) -> list[str]:
    return _load_failed_torrent_urls(record.failed_torrent_urls)


def get_processing_items(db: Session) -> list[DownloadQueueRecord]:
    return (
        db.query(DownloadQueueRecord)
        .filter(DownloadQueueRecord.status == "processing")
        .all()
    )


def get_all_queue(db: Session) -> list[DownloadQueueRecord]:
    return db.query(DownloadQueueRecord).order_by(DownloadQueueRecord.position).all()


def clear_done(db: Session, statuses: list[str] | None = None) -> int:
    statuses = statuses or ["done", "skipped"]
    rows = (
        db.query(DownloadQueueRecord)
        .filter(DownloadQueueRecord.status.in_(statuses))
        .all()
    )
    count = len(rows)
    for row in rows:
        db.delete(row)
    db.commit()
    return count


def delete_queue_item(db: Session, item_id: int) -> None:
    db.query(DownloadQueueRecord).filter(DownloadQueueRecord.id == item_id).delete()
    db.commit()
