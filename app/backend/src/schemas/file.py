from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Index, Integer, String
from sqlalchemy.orm import relationship

from .db_helper import Base


class FileRecord(Base):
    __tablename__ = "files"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    path = Column(String, nullable=False, unique=True)
    size = Column(Integer, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    modified_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_scanned_at = Column(DateTime, nullable=True)
    format = Column(String, nullable=True)
    duration = Column(String, nullable=True)  # For video files
    file_type = Column(String, nullable=True)  # video, audio, image, etc.
    status = Column(String, nullable=True)  # unprocessed, processing, done, error
    directory_id = Column(String, nullable=False)  # Foreign key to DirectoryRecord
    sha256 = Column(String, nullable=True)  # SHA-256 hash of file contents
    parent_id = Column(String, nullable=True)  # For tracking parent-child relationships
    child_ids = Column(String, nullable=True)  # Comma-separated IDs of child files
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    fps = Column(Float, nullable=True)
    codec = Column(String, nullable=True)
    bitrate = Column(Integer, nullable=True)
    queue_disabled = Column(Boolean, nullable=False, default=False)
    split_disabled = Column(Boolean, nullable=False, default=False)
    subtitle_disabled = Column(Boolean, nullable=False, default=False)
    is_deleted = Column(Boolean, nullable=False, default=False)

    # Links back to tasks (One File can have many Tasks)
    tasks = relationship("TaskRecord", back_populates="file", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_files_active_created_at", "is_deleted", "created_at"),
        Index("ix_files_active_directory", "is_deleted", "directory_id"),
        Index("ix_files_parent_type_active", "parent_id", "file_type", "is_deleted"),
        Index("ix_files_active_type_status", "is_deleted", "file_type", "status"),
        Index("ix_files_directory_name_active", "directory_id", "name", "is_deleted"),
    )
