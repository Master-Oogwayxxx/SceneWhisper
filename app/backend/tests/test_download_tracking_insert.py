"""Test that POST /api/r18/download inserts a torrent_tracking row."""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

import src.schemas.db_helper as dbh
from main import app
from src.crud.torrent_tracking import get_all_tracking
from src.schemas.db_helper import init_db


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


def _mock_send(
    torrent_url: str,
    category: str | None = None,
    tags: list[str] | None = None,
    save_path: str | None = None,
) -> None:
    pass


def test_download_inserts_tracking_row(client):
    with patch("src.api.r18._send_to_qbit", side_effect=_mock_send):
        resp = client.post(
            "/api/r18/download",
            json={"torrent_url": "https://sukebei.nyaa.si/download/1234567.torrent", "video_code": "ABP-123", "content_id": "abp123"},
        )

    assert resp.status_code == 200

    db = dbh.SessionLocal()
    rows = get_all_tracking(db)
    db.close()
    assert len(rows) == 1
    assert rows[0].content_id == "abp123"
    assert rows[0].video_code == "ABP-123"
    assert rows[0].torrent_name == "1234567"
    assert rows[0].status == "downloading"


def test_download_passes_category_and_tags_to_qbit(client):
    sent: dict[str, object] = {}

    def _capture_send(
        torrent_url: str,
        category: str | None = None,
        tags: list[str] | None = None,
        save_path: str | None = None,
    ) -> None:
        sent["torrent_url"] = torrent_url
        sent["category"] = category
        sent["tags"] = tags
        sent["save_path"] = save_path

    with patch("src.api.r18._send_to_qbit", side_effect=_capture_send):
        resp = client.post(
            "/api/r18/download",
            json={
                "torrent_url": "https://sukebei.nyaa.si/download/1234567.torrent",
                "video_code": "ABP-123",
                "content_id": "abp123",
                "category": "Scene Whisper",
                "tags": ["Jane Doe"],
            },
        )

    assert resp.status_code == 200
    assert sent == {
        "torrent_url": "https://sukebei.nyaa.si/download/1234567.torrent",
        "category": "Scene Whisper",
        "tags": ["Jane Doe"],
        "save_path": None,
    }


def test_download_defaults_category_and_derived_tags(client):
    sent: dict[str, object] = {}

    def _capture_send(
        torrent_url: str,
        category: str | None = None,
        tags: list[str] | None = None,
        save_path: str | None = None,
    ) -> None:
        sent["torrent_url"] = torrent_url
        sent["category"] = category
        sent["tags"] = tags
        sent["save_path"] = save_path

    with patch("src.api.r18.r18_actress.get_actress_names_by_content_id", return_value=["Jane Doe"]):
        with patch("src.api.r18._send_to_qbit", side_effect=_capture_send):
            resp = client.post(
                "/api/r18/download",
                json={
                    "torrent_url": "https://sukebei.nyaa.si/download/1234567.torrent",
                    "video_code": "ABP-123",
                    "content_id": "abp123",
                },
            )

    assert resp.status_code == 200
    assert sent == {
        "torrent_url": "https://sukebei.nyaa.si/download/1234567.torrent",
        "category": "Scene Whisper",
        "tags": ["Jane Doe"],
        "save_path": None,
    }


def test_download_passes_save_path_to_qbit(client):
    sent: dict[str, object] = {}

    def _capture_send(
        torrent_url: str,
        category: str | None = None,
        tags: list[str] | None = None,
        save_path: str | None = None,
    ) -> None:
        sent["torrent_url"] = torrent_url
        sent["category"] = category
        sent["tags"] = tags
        sent["save_path"] = save_path

    with patch("src.api.r18._send_to_qbit", side_effect=_capture_send):
        resp = client.post(
            "/api/r18/download",
            json={
                "torrent_url": "https://sukebei.nyaa.si/download/1234567.torrent",
                "video_code": "ABP-123",
                "content_id": "abp123",
                "category": "Scene Whisper",
                "tags": ["Jane Doe"],
                "save_path": "D:/Media/Actresses/Jane Doe",
            },
        )

    assert resp.status_code == 200
    assert sent == {
        "torrent_url": "https://sukebei.nyaa.si/download/1234567.torrent",
        "category": "Scene Whisper",
        "tags": ["Jane Doe"],
        "save_path": "D:/Media/Actresses/Jane Doe",
    }
