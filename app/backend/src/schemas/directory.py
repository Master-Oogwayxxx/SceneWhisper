from datetime import datetime

from sqlalchemy import Column, DateTime, String

from .db_helper import Base


class DirectoryRecord(Base):
    __tablename__ = "directories"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    path = Column(String, nullable=False, unique=True)
    parent_id = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
