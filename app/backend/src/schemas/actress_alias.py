from sqlalchemy import Column, Integer, String

from .db_helper import Base


class ActressAliasRecord(Base):
    __tablename__ = "actress_aliases"

    actress_id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
