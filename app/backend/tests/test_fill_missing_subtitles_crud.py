import uuid
from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.crud.directory_monitor import (
    create_directory_monitor,
    get_directory_monitor,
    update_directory_monitor,
)
from src.models.models import DirectoryMonitor, Schedule, ScheduleInterval, TaskType
from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    yield


def _make_monitor(fill_missing: bool) -> DirectoryMonitor:
    return DirectoryMonitor(
        id=str(uuid.uuid4()),
        directoryId="dir-1",
        directoryName="Test Dir",
        directoryPath="/tmp/test",
        taskType=TaskType.SUBTITLE,
        subtitleLanguage="en",
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        deleteVideoAfterCompletion=False,
        fillMissingSubtitles=fill_missing,
        createdAt=datetime.utcnow().isoformat(),
    )


def test_create_with_fill_missing_subtitles_true(isolated_db):
    monitor = _make_monitor(fill_missing=True)
    created = create_directory_monitor(monitor)
    assert created.fillMissingSubtitles is True


def test_create_with_fill_missing_subtitles_false(isolated_db):
    monitor = _make_monitor(fill_missing=False)
    created = create_directory_monitor(monitor)
    assert created.fillMissingSubtitles is False


def test_update_fill_missing_subtitles(isolated_db):
    monitor = _make_monitor(fill_missing=False)
    created = create_directory_monitor(monitor)

    updated = created.model_copy(update={"fillMissingSubtitles": True})
    result = update_directory_monitor(updated)
    assert result.fillMissingSubtitles is True

    fetched = get_directory_monitor(created.id)
    assert fetched.fillMissingSubtitles is True
