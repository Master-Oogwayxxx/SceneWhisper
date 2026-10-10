from datetime import datetime

from sqlalchemy.orm import Session

from ..schemas.deleted_file import DeletedFileRecord
from ..schemas.file import FileRecord
from .actress_work_file_state import mark_file_deleted


def record_deleted_file(
    db: Session,
    file_record: FileRecord,
    *,
    reason: str,
    source: str = "app",
) -> DeletedFileRecord:
    """Persist a deleted-file ledger entry and update local matching state."""
    now = datetime.utcnow()
    mark_file_deleted(db, file_record)
    deleted_record = DeletedFileRecord(
        file_record_id=file_record.id,
        name=file_record.name,
        path=file_record.path,
        size=file_record.size,
        file_type=file_record.file_type,
        format=file_record.format,
        sha256=file_record.sha256,
        directory_id=file_record.directory_id,
        deleted_at=now,
        original_created_at=file_record.created_at,
        original_modified_at=file_record.modified_at,
        reason=reason,
        source=source,
    )
    db.add(deleted_record)
    return deleted_record
