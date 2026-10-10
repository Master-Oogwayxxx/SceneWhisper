from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from .db_helper import Base


class TorrentTrackingRecord(Base):
    __tablename__ = "torrent_tracking"

    id = Column(Integer, primary_key=True, autoincrement=True)
    content_id = Column(Text, nullable=True)
    video_code = Column(Text, nullable=False, default="")
    torrent_hash = Column(String(40), unique=True, nullable=True)
    torrent_name = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="downloading")
    added_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
