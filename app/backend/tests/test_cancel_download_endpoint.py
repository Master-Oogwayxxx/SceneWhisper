"""Tests for DELETE /api/r18/downloads/{content_id} endpoint."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

import src.schemas.db_helper as dbh
from main import app
from src.schemas.db_helper import init_db
from src.crud.torrent_tracking import insert_tracking, get_all_tracking, update_hash


@pytest.fixture(autouse=True)
def reset_db(tmp_path, monkeypatch):
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


def test_cancel_download_404_when_no_tracking(client):
    resp = client.delete("/api/r18/downloads/UNKNOWN-001")
    assert resp.status_code == 404


def test_cancel_download_calls_delete_torrent_when_hash_known(client):
    db = dbh.SessionLocal()
    row = insert_tracking(db, "ABP-123", "ABP-123-torrent", "ABP-123")
    update_hash(db, row.id, "deadbeef")
    db.close()

    with patch("src.api.r18._delete_torrent") as mock_del:
        resp = client.delete("/api/r18/downloads/ABP-123")

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    mock_del.assert_called_once_with("deadbeef")


def test_cancel_download_removes_tracking_record(client):
    db = dbh.SessionLocal()
    insert_tracking(db, "ABP-123", "ABP-123-torrent", "ABP-123")
    db.close()

    with patch("src.api.r18._delete_torrent"):
        with patch("src.api.r18._find_torrent_hash", return_value="abc"):
            client.delete("/api/r18/downloads/ABP-123")

    db = dbh.SessionLocal()
    rows = get_all_tracking(db)
    db.close()
    assert rows == []


def test_cancel_download_resolves_hash_by_name_when_missing(client):
    db = dbh.SessionLocal()
    insert_tracking(db, "ABP-123", "ABP-123-torrent", "ABP-123")
    db.close()

    with patch("src.api.r18._find_torrent_hash", return_value="resolved_hash") as mock_find:
        with patch("src.api.r18._delete_torrent") as mock_del:
            resp = client.delete("/api/r18/downloads/ABP-123")

    assert resp.status_code == 200
    mock_find.assert_called_once_with("ABP-123-torrent", retries=1, delay=0)
    mock_del.assert_called_once_with("resolved_hash")


def test_cancel_download_succeeds_even_if_qbit_delete_fails(client):
    db = dbh.SessionLocal()
    row = insert_tracking(db, "ABP-123", "ABP-123-torrent", "ABP-123")
    update_hash(db, row.id, "deadbeef")
    db.close()

    with patch("src.api.r18._delete_torrent", side_effect=RuntimeError("qbit down")):
        resp = client.delete("/api/r18/downloads/ABP-123")

    assert resp.status_code == 200
    assert resp.json() == {"ok": True}

    db = dbh.SessionLocal()
    rows = get_all_tracking(db)
    db.close()
    assert rows == []
