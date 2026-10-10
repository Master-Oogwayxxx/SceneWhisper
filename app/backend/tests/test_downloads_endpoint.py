"""Tests for GET /api/r18/downloads endpoint."""

import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

import src.schemas.db_helper as dbh
from main import app
from src.schemas.db_helper import init_db
from src.crud.torrent_tracking import get_all_tracking, insert_tracking


@pytest.fixture(autouse=True)
def reset_db(tmp_path, monkeypatch):
    """Point the DB at a temp file and reinitialize for each test."""
    import src.schemas.db_helper as dbh
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(f"sqlite:///{tmp_path}/test.db", connect_args={"check_same_thread": False})
    dbh.engine = engine
    dbh.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    dbh.Base.metadata.create_all(engine)
    init_db()
    yield
    engine.dispose()


@pytest.fixture
def client():
    return TestClient(app)


def test_downloads_returns_empty_when_no_tracking(client):
    with patch("src.api.r18._fetch_qbit_torrents", return_value=[]):
        resp = client.get("/api/r18/downloads")
    assert resp.status_code == 200
    assert resp.json() == []


def test_downloads_returns_error_for_missing_tracked_row_when_qbit_reachable(client):
    db = dbh.SessionLocal()
    row = insert_tracking(db, "ABP-123", "ABP-123")
    row.added_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    db.commit()
    db.close()

    with patch("src.api.r18._fetch_qbit_torrents", return_value=[]):
        resp = client.get("/api/r18/downloads")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["video_code"] == "ABP-123"
    assert data[0]["progress"] == 0.0
    assert data[0]["status"] == "error"


def test_downloads_matches_by_hash(client):
    db = dbh.SessionLocal()
    row = insert_tracking(db, "ABP-123", "ABP-123")
    from src.crud.torrent_tracking import update_hash
    update_hash(db, row.id, "abc123")
    db.close()

    qbit_torrent = {
        "hash": "abc123",
        "name": "ABP-123 SD",
        "progress": 0.5,
        "dlspeed": 1048576,
        "eta": 120,
        "state": "downloading",
    }
    with patch("src.api.r18._fetch_qbit_torrents", return_value=[qbit_torrent]):
        resp = client.get("/api/r18/downloads")

    data = resp.json()
    assert data[0]["progress"] == 0.5
    assert data[0]["speed"] == 1048576
    assert data[0]["eta"] == 120


def test_downloads_matches_by_name_and_backfills_hash(client):
    db = dbh.SessionLocal()
    insert_tracking(db, "OFES-035", "OFES-035")
    db.close()

    qbit_torrent = {
        "hash": "deadbeef",
        "name": "[SubsPlease] OFES-035 1080p",
        "progress": 0.25,
        "dlspeed": 500000,
        "eta": 300,
        "state": "downloading",
    }
    with patch("src.api.r18._fetch_qbit_torrents", return_value=[qbit_torrent]):
        resp = client.get("/api/r18/downloads")

    data = resp.json()
    assert data[0]["torrent_hash"] == "deadbeef"
    assert data[0]["progress"] == 0.25

    # Hash back-filled in DB
    db = dbh.SessionLocal()
    from src.crud.torrent_tracking import get_all_tracking
    rows = get_all_tracking(db)
    db.close()
    assert rows[0].torrent_hash == "deadbeef"


def test_downloads_marks_completed(client):
    db = dbh.SessionLocal()
    row = insert_tracking(db, "ABP-123", "ABP-123")
    from src.crud.torrent_tracking import update_hash
    update_hash(db, row.id, "abc123")
    db.close()

    qbit_torrent = {
        "hash": "abc123",
        "name": "ABP-123",
        "progress": 1.0,
        "dlspeed": 0,
        "eta": -1,
        "state": "uploading",
    }
    with patch("src.api.r18._fetch_qbit_torrents", return_value=[qbit_torrent]):
        resp = client.get("/api/r18/downloads")

    data = resp.json()
    assert data[0]["status"] == "completed"
    assert data[0]["completed_at"] is not None


def test_downloads_returns_last_known_status_when_qbit_unreachable(client):
    db = dbh.SessionLocal()
    insert_tracking(db, "ABP-123", "ABP-123")
    db.close()

    with patch("src.api.r18._fetch_qbit_torrents", side_effect=Exception("connection refused")):
        resp = client.get("/api/r18/downloads")

    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["status"] == "downloading"
    assert data[0]["progress"] == 0.0

    db = dbh.SessionLocal()
    rows = get_all_tracking(db)
    db.close()
    assert rows[0].status == "downloading"


def test_downloads_marks_error_when_qbit_reachable_but_torrent_missing(client):
    db = dbh.SessionLocal()
    row = insert_tracking(db, "ABP-123", "ABP-123")
    row.added_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    db.commit()
    db.close()

    with patch("src.api.r18._fetch_qbit_torrents", return_value=[]):
        resp = client.get("/api/r18/downloads")

    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["status"] == "error"
    assert data[0]["progress"] == 0.0

    db = dbh.SessionLocal()
    rows = get_all_tracking(db)
    db.close()
    assert rows[0].status == "error"


def test_downloads_keeps_recent_missing_torrent_as_downloading(client):
    db = dbh.SessionLocal()
    insert_tracking(db, "ABP-123", "ABP-123")
    db.close()

    with patch("src.api.r18._fetch_qbit_torrents", return_value=[]):
        resp = client.get("/api/r18/downloads")

    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["status"] == "downloading"
    assert data[0]["progress"] == 0.0

    db = dbh.SessionLocal()
    rows = get_all_tracking(db)
    db.close()
    assert rows[0].status == "downloading"
