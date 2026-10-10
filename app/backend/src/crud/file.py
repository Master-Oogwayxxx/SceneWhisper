import hashlib
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import update
from sqlalchemy.orm import Session

from .actress_work_file_state import mark_file_present
from .deleted_file import record_deleted_file
from ..schemas.file import FileRecord
from ..utils import generate_filename_id


class File:
    def __init__(self, db: Session):
        self.db = db

    def create_file_metadata(
        self,
        name: str,
        path: str,
        size: int,
        file_type: str,
        duration: Optional[str] = None,
        format: Optional[str] = None,
        directory_id: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        fps: Optional[float] = None,
        codec: Optional[str] = None,
        bitrate: Optional[int] = None,
        status: Optional[str] = "unprocessed",
    ) -> FileRecord:
        """Create a file metadata record in the database"""
        existing_path = self.db.query(FileRecord).filter(FileRecord.path == path).first()
        if existing_path:
            return existing_path

        file_id = generate_filename_id(name, path)
        existing_id = self.db.query(FileRecord).filter(FileRecord.id == file_id).first()
        counter = 1
        while existing_id and existing_id.path != path:
            file_id = hashlib.sha256(f"{name}{path}:{counter}".encode("utf-8")).hexdigest()[:16]
            existing_id = self.db.query(FileRecord).filter(FileRecord.id == file_id).first()
            counter += 1
        if existing_id:
            return existing_id

        file_metadata = FileRecord(
            id=file_id,
            name=name,
            path=path,
            size=size,
            format=format,
            duration=duration,
            file_type=file_type,
            directory_id=directory_id,
            sha256=None,  # computed lazily by sha256_worker
            width=width,
            height=height,
            fps=fps,
            codec=codec,
            bitrate=bitrate,
            status=status,
            last_scanned_at=datetime.utcnow(),
        )
        self.db.add(file_metadata)
        mark_file_present(self.db, file_metadata)
        self.db.commit()
        self.db.refresh(file_metadata)
        return file_metadata

    def get_file_metadata(self, file_id: Optional[str] = None, path: Optional[str] = None) -> Optional[FileRecord]:
        """Get file metadata by ID or path"""
        if file_id:
            return self.db.query(FileRecord).filter(FileRecord.id == file_id).first()
        elif path:
            return self.db.query(FileRecord).filter(FileRecord.path == path).first()
        else:
            return None

    def get_or_create_file_metadata(
        self,
        name: str,
        path: str,
        size: int,
        file_type: str,
        duration: Optional[str] = None,
        format: Optional[str] = None,
        directory_id: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        fps: Optional[float] = None,
        codec: Optional[str] = None,
        bitrate: Optional[int] = None,
        status: Optional[str] = "unprocessed",
    ) -> FileRecord:
        """Get existing file metadata or create new one"""
        existing = self.db.query(FileRecord).filter(FileRecord.path == path).first()
        if existing:
            return existing

        return self.create_file_metadata(name, path, size, file_type, duration, format, directory_id, width, height, fps, codec, bitrate, status)

    def sync_file_metadata(
        self,
        name: str,
        path: str,
        size: int,
        file_type: str,
        duration: Optional[str] = None,
        format: Optional[str] = None,
        directory_id: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        fps: Optional[float] = None,
        codec: Optional[str] = None,
        bitrate: Optional[int] = None,
        status: Optional[str] = None,
    ) -> tuple[FileRecord, bool]:
        """Return (record, skipped). Creates if new; skips if unchanged; updates if changed.

        Change detection order:
          1. size mismatch  → changed
          2. mtime mismatch → changed
          3. sha256 mismatch → changed (expensive, last resort)
          unchanged → skip
        """
        existing = self.db.query(FileRecord).filter(FileRecord.path == path).first()
        if not existing:
            return self.create_file_metadata(name, path, size, file_type, duration, format, directory_id, width, height, fps, codec, bitrate, status or "unprocessed"), False

        try:
            stat = os.stat(path)
        except OSError:
            return existing, True

        # 1. Size
        if existing.size != stat.st_size:
            return self._update_file_metadata(existing, name, path, stat, file_type, duration, format, directory_id, width=width, height=height, fps=fps, codec=codec, bitrate=bitrate), False

        # 2. mtime (truncate to second to avoid float precision noise)
        disk_mtime = datetime.utcfromtimestamp(int(stat.st_mtime))
        if existing.modified_at and abs((existing.modified_at - disk_mtime).total_seconds()) > 1:
            return self._update_file_metadata(existing, name, path, stat, file_type, duration, format, directory_id, width=width, height=height, fps=fps, codec=codec, bitrate=bitrate), False

        # size + mtime match — update last_scanned_at and return as skipped
        existing.last_scanned_at = datetime.utcnow()
        mark_file_present(self.db, existing)
        self.db.commit()
        return existing, True

    def batch_update_scanned_at(self, paths: list[str]) -> None:
        """Bulk-update last_scanned_at for unchanged files in a single query+commit."""
        if not paths:
            return
        self.db.execute(update(FileRecord).where(FileRecord.path.in_(paths)).values(last_scanned_at=datetime.utcnow()))
        self.db.commit()

    def _update_file_metadata(
        self,
        record: FileRecord,
        name: str,
        path: str,
        stat: os.stat_result,
        file_type: str,
        duration: Optional[str],
        format: Optional[str],
        directory_id: Optional[str],
        sha256: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
        fps: Optional[float] = None,
        codec: Optional[str] = None,
        bitrate: Optional[int] = None,
    ) -> FileRecord:
        record.name = name
        record.size = stat.st_size
        record.modified_at = datetime.utcfromtimestamp(int(stat.st_mtime))
        record.file_type = file_type
        record.duration = duration
        record.format = format
        record.directory_id = directory_id
        record.sha256 = sha256  # sha256_worker recomputes lazily after file changes
        record.width = width
        record.height = height
        record.fps = fps
        record.codec = codec
        record.bitrate = bitrate
        record.last_scanned_at = datetime.utcnow()
        mark_file_present(self.db, record)
        self.db.commit()
        self.db.refresh(record)
        return record

    def set_parent_for_file(self, child_file_id: str, parent_file_id: str) -> FileRecord:
        """Set parent relationship for a file"""
        file_record = self.db.query(FileRecord).filter(FileRecord.id == child_file_id).first()
        if file_record:
            # Update the child's parent_id
            file_record.parent_id = parent_file_id
            # Add to parent's child_ids if not already there
            if file_record.child_ids:
                child_ids = file_record.child_ids.split(",")
                if child_file_id not in child_ids:
                    file_record.child_ids = f"{file_record.child_ids},{child_file_id}"
            else:
                file_record.child_ids = child_file_id

            self.db.commit()
            self.db.refresh(file_record)
        return file_record

    def get_all_files(self) -> list[FileRecord]:
        """Get all file records in the database"""
        return self.db.query(FileRecord).all()

    def get_file_with_parent(self, file_id: str) -> FileRecord:
        """Get file with parent information"""
        return self.db.query(FileRecord).filter(FileRecord.id == file_id).first()

    def get_children_of_file(self, parent_file_id: str) -> list[FileRecord]:
        """Get all child files of a parent file"""
        if not parent_file_id:
            return []

        # Query for all files that have this parent_id
        return self.db.query(FileRecord).filter(FileRecord.parent_id == parent_file_id).all()

    def get_parent_of_file(self, file_id: str) -> FileRecord:
        """Get the parent file of a given file"""
        file_record = self.db.query(FileRecord).filter(FileRecord.id == file_id).first()
        if file_record and file_record.parent_id:
            return self.db.query(FileRecord).filter(FileRecord.id == file_record.parent_id).first()
        return None

    def delete_by_id(self, file_id: str) -> bool:
        """Delete a file record by ID."""
        record = self.db.query(FileRecord).filter(FileRecord.id == file_id).first()
        if record:
            if not Path(record.path).exists():
                record_deleted_file(self.db, record, reason="missing_on_delete_by_id", source="file_crud")
            self.db.delete(record)
            self.db.commit()
            return True
        logging.warning("File record not found for deletion: %s", file_id)
        return False

    def delete_by_path(self, path: str) -> bool:
        """Delete a file record by path."""
        record = self.db.query(FileRecord).filter(FileRecord.path == path).first()
        if record:
            if not Path(record.path).exists():
                record_deleted_file(self.db, record, reason="missing_on_delete_by_path", source="file_crud")
            self.db.delete(record)
            self.db.commit()
            return True
        return False

    def toggle_queue_disabled(self, file_id: str) -> Optional[FileRecord]:
        """Flip queue_disabled for a file. Returns updated record or None if not found."""
        record = self.db.query(FileRecord).filter(FileRecord.id == file_id).first()
        if not record:
            return None
        record.queue_disabled = not record.queue_disabled
        self.db.commit()
        self.db.refresh(record)
        return record

    def set_queue_disabled(self, file_ids: list[str], disabled: bool) -> list[FileRecord]:
        """Set queue_disabled for the provided files and return the updated records."""
        if not file_ids:
            return []

        records = self.db.query(FileRecord).filter(FileRecord.id.in_(file_ids)).all()
        for record in records:
            record.queue_disabled = disabled
        self.db.commit()
        for record in records:
            self.db.refresh(record)
        return records

    def set_task_type_disabled(self, file_ids: list[str], task_type: str, disabled: bool) -> list[FileRecord]:
        """Set split/subtitle disabled flags for the provided files."""
        if not file_ids:
            return []
        field = {
            "split": "split_disabled",
            "subtitle": "subtitle_disabled",
        }.get(task_type)
        if field is None:
            raise ValueError(f"Unsupported disabled task type: {task_type}")

        records = self.db.query(FileRecord).filter(FileRecord.id.in_(file_ids)).all()
        for record in records:
            setattr(record, field, disabled)
        self.db.commit()
        for record in records:
            self.db.refresh(record)
        return records

    def is_task_type_disabled(self, file_id: str, task_type: str) -> bool:
        """Return True when the file is disabled for the requested queue task type."""
        record = self.db.query(FileRecord).filter(FileRecord.id == file_id).first()
        if not record:
            return False
        if task_type == "split":
            return bool(record.split_disabled or record.queue_disabled)
        if task_type == "subtitle":
            return bool(record.subtitle_disabled or record.queue_disabled)
        return bool(record.queue_disabled)

    def is_queue_disabled(self, file_id: str) -> bool:
        """Return True if the file has queue_disabled=True."""
        record = self.db.query(FileRecord).filter(FileRecord.id == file_id).first()
        if not record:
            return False
        return bool(record.queue_disabled)
