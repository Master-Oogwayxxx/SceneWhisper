"""Tests for torrent_tracking CRUD operations."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.schemas.db_helper import Base
from src.schemas.torrent_tracking import TorrentTrackingRecord
from src.crud.torrent_tracking import (
    insert_tracking,
    get_all_tracking,
    update_hash,
    update_status,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_insert_tracking_creates_row(db):
    row = insert_tracking(db, "ABP-123", "ABP-123.torrent")
    assert row.id is not None
    assert row.video_code == "ABP-123"
    assert row.torrent_name == "ABP-123.torrent"
    assert row.status == "downloading"
    assert row.torrent_hash is None
    assert row.added_at is not None
    assert row.completed_at is None


def test_get_all_tracking_returns_all(db):
    insert_tracking(db, "ABP-123", "ABP-123.torrent")
    insert_tracking(db, "OFES-035", "OFES-035.torrent")
    rows = get_all_tracking(db)
    assert len(rows) == 2


def test_update_hash(db):
    row = insert_tracking(db, "ABP-123", "ABP-123.torrent")
    update_hash(db, row.id, "abc123def456")
    db.expire(row)
    assert row.torrent_hash == "abc123def456"


def test_update_status_to_completed(db):
    from datetime import datetime, timezone
    row = insert_tracking(db, "ABP-123", "ABP-123.torrent")
    now = datetime.now(timezone.utc)
    update_status(db, row.id, "completed", completed_at=now)
    db.expire(row)
    assert row.status == "completed"
    assert row.completed_at is not None


def test_update_status_to_error(db):
    row = insert_tracking(db, "ABP-123", "ABP-123.torrent")
    update_status(db, row.id, "error")
    db.expire(row)
    assert row.status == "error"
    assert row.completed_at is None
