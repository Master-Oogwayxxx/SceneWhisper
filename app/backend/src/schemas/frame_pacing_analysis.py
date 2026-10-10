from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from .db_helper import Base


class FramePacingAnalysisRunRecord(Base):
    __tablename__ = "frame_pacing_analysis_runs"

    id = Column(String, primary_key=True, index=True)
    status = Column(String, nullable=False, default="queued")
    file_ids_json = Column(Text, nullable=False, default="[]")
    results_json = Column(Text, nullable=False, default="[]")
    progress_json = Column(Text, nullable=False, default="{}")
    total = Column(Integer, nullable=False, default=0)
    done = Column(Integer, nullable=False, default=0)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
