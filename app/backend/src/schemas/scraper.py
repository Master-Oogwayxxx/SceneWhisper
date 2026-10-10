from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy import Enum as SQLEnum

from ..models.models import ScheduleInterval
from .db_helper import Base


class ScraperSourceRecord(Base):
    __tablename__ = "scraper_sources"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, nullable=False)
    url = Column(Text, nullable=False)
    urls = Column(Text, nullable=True)
    url_actress_name_reversed = Column(Text, nullable=True)
    schedule_interval = Column(SQLEnum(ScheduleInterval), nullable=False)
    schedule_time = Column(String, nullable=True)
    schedule_day_of_week = Column(Integer, nullable=True)
    schedule_timezone = Column(String, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    last_run = Column(DateTime, nullable=True)
    next_run = Column(DateTime, nullable=True)
    last_found = Column(Integer, nullable=False, default=0)
    last_new = Column(Integer, nullable=False, default=0)
    last_pages_scraped = Column(Integer, nullable=False, default=0)
    last_website_stats = Column(Text, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class ScrapedVideoRecord(Base):
    __tablename__ = "scraped_videos"

    id = Column(String, primary_key=True, index=True)
    source_id = Column(String, nullable=False, index=True)
    source_url = Column(Text, nullable=True, index=True)
    video_code = Column(String, nullable=False, index=True)
    title = Column(Text, nullable=True)
    url = Column(Text, nullable=True)
    uncensored = Column(Boolean, nullable=True)
    censored = Column(Boolean, nullable=True)
    subtitled = Column(Boolean, nullable=True)
    opened = Column(Boolean, nullable=False, default=False)
    opened_at = Column(DateTime, nullable=True)
    scraped_at = Column(DateTime, nullable=False)
    first_seen_at = Column(DateTime, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
