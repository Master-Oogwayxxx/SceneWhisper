from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, Text

from .db_helper import Base


class DownloadQueueRecord(Base):
    __tablename__ = "download_queue"

    id = Column(Integer, primary_key=True, autoincrement=True)
    content_id = Column(Text, nullable=True)
    video_code = Column(Text, nullable=False)
    status = Column(Text, nullable=False, default="pending")
    error = Column(Text, nullable=True)
    added_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    processed_at = Column(DateTime, nullable=True)
    torrent_url = Column(Text, nullable=True)
    save_path = Column(Text, nullable=True)
    failed_torrent_urls = Column(Text, nullable=False, default="[]")
    position = Column(Integer, nullable=False, default=0)
