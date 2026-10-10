from datetime import datetime

from sqlalchemy import Column, DateTime, String

from .db_helper import Base


class ActressWorkFileStateRecord(Base):
    __tablename__ = "actress_work_file_state"

    path = Column(String, primary_key=True)
    status = Column(String, nullable=False, default="present")
    file_record_id = Column(String, nullable=True, index=True)
    file_name = Column(String, nullable=False, index=True)
    file_type = Column(String, nullable=True)
    first_seen_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_seen_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)
