from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String

from .db_helper import Base


class SceneRecord(Base):
    __tablename__ = "scenes"

    id = Column(String, primary_key=True, index=True)
    file_id = Column(String, ForeignKey("files.id", ondelete="CASCADE"), nullable=False, index=True)
    scene_number = Column(Integer, nullable=False)  # 1-based index from PySceneDetect
    start_frame = Column(Integer, nullable=False)
    end_frame = Column(Integer, nullable=False)
    start_timecode = Column(String, nullable=False)  # HH:MM:SS.mmm
    end_timecode = Column(String, nullable=False)    # HH:MM:SS.mmm
    start_seconds = Column(Float, nullable=False)
    end_seconds = Column(Float, nullable=False)
    duration_seconds = Column(Float, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
