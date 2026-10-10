from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String

from .db_helper import Base


class DeletedFileRecord(Base):
    __tablename__ = "deleted_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_record_id = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False)
    path = Column(String, nullable=False, index=True)
    size = Column(Integer, nullable=True)
    file_type = Column(String, nullable=True)
    format = Column(String, nullable=True)
    sha256 = Column(String, nullable=True)
    directory_id = Column(String, nullable=True, index=True)
    deleted_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    original_created_at = Column(DateTime, nullable=True)
    original_modified_at = Column(DateTime, nullable=True)
    reason = Column(String, nullable=False, default="unknown")
    source = Column(String, nullable=False, default="app")
