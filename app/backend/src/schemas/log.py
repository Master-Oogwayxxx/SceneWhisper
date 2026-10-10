from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, Text

from .db_helper import Base


class LogRecord(Base):
    __tablename__ = "logs"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    level = Column(String, nullable=False, index=True)
    logger_name = Column(String, nullable=False)
    module = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    task_id = Column(String, nullable=True, index=True)
    exc_text = Column(Text, nullable=True)
