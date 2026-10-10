from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, desc
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import relationship

from ..models.models import ProcessingStage, TaskStatus, TaskType
from .db_helper import Base


class TaskRecord(Base):
    __tablename__ = "tasks"

    # Task fields
    id = Column(String, primary_key=True, index=True)
    file_id = Column(String, ForeignKey("files.id", ondelete="CASCADE"), nullable=True)
    type = Column(SQLEnum(TaskType), nullable=False)
    status = Column(SQLEnum(TaskStatus), nullable=False, index=True)
    current_stage = Column(SQLEnum(ProcessingStage), nullable=True)
    # Kept for backward-compat with rows written before per-stage progress was added; never written by application code
    progress = Column(Float, default=0.0)
    scene_progress = Column(Float, default=0.0)
    split_progress = Column(Float, default=0.0)
    subtitle_progress = Column(Float, default=0.0)
    merge_progress = Column(Float, default=0.0)
    subtitle_language = Column(String, nullable=True)
    scene_detector = Column(String, nullable=True)
    scheduled_for = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    stage_started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    paused_at = Column(DateTime, nullable=True)
    # Wall-clock processing duration (started_at → completion), in whole seconds
    elapsed_seconds = Column(Integer, nullable=True)
    scene_elapsed_seconds = Column(Integer, nullable=True)
    split_elapsed_seconds = Column(Integer, nullable=True)
    subtitle_elapsed_seconds = Column(Integer, nullable=True)
    scene_count = Column(Integer, default=0)
    split_count = Column(Integer, default=0)
    error = Column(String, nullable=True)
    overwrite_scenes = Column(Boolean, default=False, nullable=False)
    overwrite_split = Column(Boolean, default=False, nullable=False)
    bypass_split_guard = Column(Boolean, default=False, nullable=False)
    overwrite_subtitles = Column(Boolean, default=False, nullable=False)
    delete_video_after_completion = Column(Boolean, default=False, nullable=False)
    nvenc_overwrite_original = Column(Boolean, default=False, nullable=False)
    merge_input_paths = Column(String, nullable=True)
    queue_position = Column(Integer, nullable=True)

    file = relationship("FileRecord", back_populates="tasks")

    __table_args__ = (Index("ix_tasks_created_at", desc("created_at")),)
