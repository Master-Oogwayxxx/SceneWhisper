from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String
from sqlalchemy import Enum as SQLEnum

from ..models.models import ScheduleInterval, TaskType
from .db_helper import Base


class DirectoryMonitorRecord(Base):
    __tablename__ = "directory_monitors"

    id = Column(String, primary_key=True, index=True)
    directory_id = Column(String, nullable=False, index=True)
    directory_name = Column(String, nullable=False)
    directory_path = Column(String, nullable=False)
    task_type = Column(SQLEnum(TaskType), nullable=False)
    task_types = Column(String, nullable=True)
    subtitle_language = Column(String, nullable=True)
    schedule_interval = Column(SQLEnum(ScheduleInterval), nullable=False)
    schedule_time = Column(String, nullable=True)
    schedule_day_of_week = Column(Integer, nullable=True)
    schedule_timezone = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    delete_video_after_completion = Column(Boolean, nullable=False, default=False)
    fill_missing_subtitles = Column(Boolean, nullable=False, default=False)
    split_scope = Column(String, nullable=False, default="both")
    frame_pacing_scope = Column(String, nullable=False, default="all")
    frame_pacing_resolution = Column(String, nullable=False, default="all")
    nvenc_overwrite_original = Column(Boolean, nullable=False, default=False)
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
