from sqlalchemy import Boolean, Column, Integer, String

from .db_helper import Base


class ActressWorkStateRecord(Base):
    __tablename__ = "actress_work_state"

    id = Column(Integer, primary_key=True, autoincrement=True)
    content_id = Column(String, unique=True, nullable=False, index=True)
    is_opened = Column(Boolean, nullable=False, default=False)
