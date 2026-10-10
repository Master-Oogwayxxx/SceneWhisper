from datetime import datetime
from sqlalchemy import Column, DateTime, Integer, String

from .db_helper import Base


class NotificationRecord(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, index=True)
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    message = Column(String, nullable=False)
    task_id = Column(String, nullable=True, index=True)
    file_id = Column(String, nullable=True, index=True)
    is_read = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
