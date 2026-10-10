from datetime import datetime

from sqlalchemy.orm import Session

from ..schemas.actress_work_file_state import ActressWorkFileStateRecord
from ..schemas.file import FileRecord


def mark_file_present(db: Session, file_record: FileRecord) -> None:
    now = datetime.utcnow()
    state = db.query(ActressWorkFileStateRecord).filter(ActressWorkFileStateRecord.path == file_record.path).first()
    if state is None:
        db.add(
            ActressWorkFileStateRecord(
                path=file_record.path,
                status="present",
                file_record_id=file_record.id,
                file_name=file_record.name,
                file_type=file_record.file_type,
                first_seen_at=now,
                last_seen_at=now,
                deleted_at=None,
            )
        )
        return

    state.status = "present"
    state.file_record_id = file_record.id
    state.file_name = file_record.name
    state.file_type = file_record.file_type
    state.last_seen_at = now
    state.deleted_at = None


def mark_file_deleted(db: Session, file_record: FileRecord) -> None:
    now = datetime.utcnow()
    state = db.query(ActressWorkFileStateRecord).filter(ActressWorkFileStateRecord.path == file_record.path).first()
    if state is None:
        db.add(
            ActressWorkFileStateRecord(
                path=file_record.path,
                status="deleted",
                file_record_id=file_record.id,
                file_name=file_record.name,
                file_type=file_record.file_type,
                first_seen_at=file_record.created_at or now,
                last_seen_at=file_record.last_scanned_at or now,
                deleted_at=now,
            )
        )
        return

    state.status = "deleted"
    state.file_record_id = file_record.id
    state.file_name = file_record.name
    state.file_type = file_record.file_type
    state.deleted_at = now
