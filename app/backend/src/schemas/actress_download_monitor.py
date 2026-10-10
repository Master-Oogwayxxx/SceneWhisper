from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy import Enum as SQLEnum

from ..models.models import ScheduleInterval
from .db_helper import Base


class ActressDownloadMonitorRecord(Base):
    __tablename__ = "actress_download_monitors"

    id = Column(String, primary_key=True, index=True)
    actress_id = Column(Integer, nullable=False, index=True)
    actress_name = Column(String, nullable=False)
    schedule_interval = Column(SQLEnum(ScheduleInterval), nullable=False)
    schedule_time = Column(String, nullable=True)
    schedule_day_of_week = Column(Integer, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    criteria = Column(Text, nullable=False, default="{}")
    max_items_per_run = Column(Integer, nullable=False, default=25)
    save_path = Column(Text, nullable=True)
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)
    last_queued = Column(Integer, nullable=False, default=0)
    last_skipped = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
