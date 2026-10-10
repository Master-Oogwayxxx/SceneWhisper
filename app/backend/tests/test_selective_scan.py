import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import src.schemas.db_helper as dbh
from src.schemas.db_helper import Base

# Import all schema classes to register them with Base
from src.schemas.setting import SettingRecord  # noqa: F401
from src.schemas.task import TaskRecord  # noqa: F401
from src.schemas.file import FileRecord  # noqa: F401
from src.schemas.directory import DirectoryRecord  # noqa: F401
from src.schemas.scene import SceneRecord  # noqa: F401
from src.schemas.directory_monitor import DirectoryMonitorRecord  # noqa: F401
from src.schemas.log import LogRecord  # noqa: F401
from src.schemas.notification import NotificationRecord  # noqa: F401


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Each test gets its own in-memory DB."""
    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    # Patch engine before creating tables
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    # Create all tables
    Base.metadata.create_all(bind=engine)
    # Run migrations with the new engine (tables exist now)
    dbh._ensure_ignore_patterns_column()
    dbh._ensure_merge_input_paths_column()
    dbh._ensure_selected_scan_directories_column()
    yield


@pytest.fixture()
def client(isolated_db):
    from main import app
    return TestClient(app)


def test_top_level_returns_subdirs(client):
    with tempfile.TemporaryDirectory() as root:
        Path(root, "alpha").mkdir()
        Path(root, "beta").mkdir()
        Path(root, "scenes").mkdir()  # should be excluded

        with patch.dict(os.environ, {"VIDEO_STORAGE_PATH": root}):
            resp = client.get("/api/directory/top_level")

    assert resp.status_code == 200
    names = [d["name"] for d in resp.json()]
    assert "alpha" in names
    assert "beta" in names
    assert "scenes" not in names  # excluded


def test_top_level_sorted(client):
    with tempfile.TemporaryDirectory() as root:
        Path(root, "zebra").mkdir()
        Path(root, "apple").mkdir()

        with patch.dict(os.environ, {"VIDEO_STORAGE_PATH": root}):
            resp = client.get("/api/directory/top_level")

    names = [d["name"] for d in resp.json()]
    assert names == sorted(names, key=str.lower)


def test_top_level_empty(client):
    with tempfile.TemporaryDirectory() as root:
        with patch.dict(os.environ, {"VIDEO_STORAGE_PATH": root}):
            resp = client.get("/api/directory/top_level")

    assert resp.status_code == 200
    assert resp.json() == []


def test_scan_all_stream_directories_param_accepted(client):
    """Verify scan_all/stream accepts ?directories= without error (smoke test)."""
    with tempfile.TemporaryDirectory() as root:
        Path(root, "alpha").mkdir()

        with patch.dict(os.environ, {"VIDEO_STORAGE_PATH": root}):
            resp = client.get("/api/directory/scan_all/stream?directories=alpha")

    # EventSourceResponse returns 200 with text/event-stream content type
    assert resp.status_code == 200
