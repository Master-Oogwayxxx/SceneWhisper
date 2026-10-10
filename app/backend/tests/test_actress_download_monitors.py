"""Tests for recurring R18 actress download monitors."""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from main import app
from src.crud.download_queue import get_all_queue
from src.models.models import ActressDownloadMonitor, ActressDownloadMonitorCriteria, Schedule, ScheduleInterval
from src.schemas.db_helper import Base
from src.schemas.download_queue import DownloadQueueRecord  # noqa: F401


@pytest.fixture
def db():
    from src.schemas.actress_download_monitor import ActressDownloadMonitorRecord  # noqa: F401

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def _monitor(**overrides) -> ActressDownloadMonitor:
    base = {
        "id": "monitor-1",
        "actressId": 123,
        "actressName": "Jane Doe",
        "schedule": Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        "isActive": True,
        "criteria": ActressDownloadMonitorCriteria(
            search="ABC",
            sortBy="date",
            sortDir="desc",
            hasImage=True,
            fileExists=False,
            releaseYear=2024,
        ),
        "maxItemsPerRun": 25,
        "savePath": "D:/Media/Actresses/Jane Doe",
        "lastRun": None,
        "nextRun": "2026-07-08T09:00:00Z",
        "lastQueued": 0,
        "lastSkipped": 0,
        "lastError": None,
        "createdAt": "2026-07-07T00:00:00Z",
    }
    base.update(overrides)
    return ActressDownloadMonitor(**base)


def test_crud_round_trips_monitor_with_saved_criteria(db):
    from src.crud.actress_download_monitor import create_actress_download_monitor, get_all_actress_download_monitors

    created = create_actress_download_monitor(db, _monitor())
    rows = get_all_actress_download_monitors(db)

    assert created.actressId == 123
    assert rows[0].criteria.search == "ABC"
    assert rows[0].criteria.hasImage is True
    assert rows[0].criteria.fileExists is False
    assert rows[0].maxItemsPerRun == 25
    assert rows[0].savePath == "D:/Media/Actresses/Jane Doe"


def test_run_monitor_enqueues_up_to_max_and_forwards_saved_filters(db):
    from src.workers.actress_download_monitor_scheduler import run_actress_download_monitor

    monitor = _monitor(maxItemsPerRun=2)
    captured = {}

    def fake_list(actress_id, skip, limit, sort_by, sort_dir, search, has_image, release_year, include, exclude):
        captured.update(
            {
                "actress_id": actress_id,
                "skip": skip,
                "limit": limit,
                "sort_by": sort_by,
                "sort_dir": sort_dir,
                "search": search,
                "has_image": has_image,
                "release_year": release_year,
                "include": include,
                "exclude": exclude,
            }
        )
        return (
            [
                {"content_id": "abc001", "video_code": "ABC-001", "dvd_id": None},
                {"content_id": "abc002", "video_code": "ABC-002", "dvd_id": None},
                {"content_id": "abc003", "video_code": "ABC-003", "dvd_id": None},
            ],
            3,
        )

    with patch("src.workers.actress_download_monitor_scheduler.r18_db_ready", return_value=True), \
         patch("src.workers.actress_download_monitor_scheduler.r18_actress.list_actress_works", side_effect=fake_list), \
         patch("src.workers.actress_download_monitor_scheduler._resolve_file_exists_filter", return_value=(None, frozenset({"abc009"}))), \
         patch("src.workers.actress_download_monitor_scheduler.calculate_next_run", return_value=datetime(2026, 7, 9, 9, tzinfo=timezone.utc)):
        queued, skipped = run_actress_download_monitor(db, monitor)

    assert queued == 2
    assert skipped == 1
    assert captured == {
        "actress_id": 123,
        "skip": 0,
        "limit": 2,
        "sort_by": "date",
        "sort_dir": "desc",
        "search": "ABC",
        "has_image": True,
        "release_year": 2024,
        "include": None,
        "exclude": frozenset({"abc009"}),
    }
    assert [row.video_code for row in get_all_queue(db)] == ["ABC-001", "ABC-002"]


def test_run_monitor_counts_duplicate_skips_from_existing_queue(db):
    from src.crud.download_queue import enqueue_works
    from src.workers.actress_download_monitor_scheduler import run_actress_download_monitor

    enqueue_works(db, [("abc001", "ABC-001")])
    monitor = _monitor(maxItemsPerRun=2, criteria=ActressDownloadMonitorCriteria())

    with patch("src.workers.actress_download_monitor_scheduler.r18_db_ready", return_value=True), \
         patch("src.workers.actress_download_monitor_scheduler.r18_actress.list_actress_works", return_value=([
             {"content_id": "abc001", "video_code": "ABC-001", "dvd_id": None},
             {"content_id": "abc002", "video_code": "ABC-002", "dvd_id": None},
         ], 2)), \
         patch("src.workers.actress_download_monitor_scheduler.calculate_next_run", return_value=datetime(2026, 7, 9, 9, tzinfo=timezone.utc)):
        queued, skipped = run_actress_download_monitor(db, monitor)

    assert queued == 1
    assert skipped == 1


def test_api_create_monitor_computes_next_run_server_side():
    client = TestClient(app)
    expected_next = datetime.now(timezone.utc) + timedelta(hours=1)
    payload = _monitor(nextRun="2000-01-01T00:00:00Z").model_dump(mode="json")

    with patch("src.api.r18_actress_download_monitors.create_actress_download_monitor") as mock_create, \
         patch("src.api.r18_actress_download_monitors.calculate_next_run", return_value=expected_next):
        mock_create.side_effect = lambda _db, monitor: monitor
        resp = client.post("/api/r18/actress-download-monitors", json=payload)

    assert resp.status_code == 200
    assert resp.json()["nextRun"] == expected_next.replace(tzinfo=None).isoformat() + "Z"


@pytest.mark.asyncio
async def test_scheduler_runs_overdue_active_monitor():
    from src.workers.actress_download_monitor_scheduler import run_due_actress_download_monitors

    overdue = _monitor(nextRun="2026-07-07T00:00:00Z")
    future = _monitor(id="future", nextRun="2099-01-01T00:00:00Z")
    inactive = _monitor(id="inactive", isActive=False, nextRun="2026-07-07T00:00:00Z")

    with patch("src.workers.actress_download_monitor_scheduler.get_all_actress_download_monitors", return_value=[overdue, future, inactive]), \
         patch("src.workers.actress_download_monitor_scheduler.run_actress_download_monitor", return_value=(1, 0)) as mock_run:
        ran = await run_due_actress_download_monitors()

    assert ran == 1
    assert mock_run.call_count == 1
    assert mock_run.call_args.args[1].id == "monitor-1"


def test_migration_creates_actress_download_monitors_table():
    from src.schemas import db_helper

    with db_helper.engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS actress_download_monitors"))
        conn.commit()

    db_helper._ensure_actress_download_monitors_table()

    with db_helper.engine.connect() as conn:
        tables = {row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}

    assert "actress_download_monitors" in tables
