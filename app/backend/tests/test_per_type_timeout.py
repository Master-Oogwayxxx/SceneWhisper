"""Tests for per-type task timeout: schema columns, migration, and watchdog logic."""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from src.schemas.setting import Base, SettingRecord
from src.schemas.db_helper import _ensure_per_type_timeout_columns


# ---------------------------------------------------------------------------
# Schema column tests
# ---------------------------------------------------------------------------

def test_setting_record_has_per_type_timeout_columns():
    cols = {c.key for c in SettingRecord.__table__.columns}
    assert "scene_timeout_minutes" in cols
    assert "split_timeout_minutes" in cols
    assert "subtitle_timeout_minutes" in cols


def test_per_type_timeout_columns_nullable_and_default_none():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    record = SettingRecord()
    session.add(record)
    session.commit()

    assert record.scene_timeout_minutes is None
    assert record.split_timeout_minutes is None
    assert record.subtitle_timeout_minutes is None


# ---------------------------------------------------------------------------
# Migration tests
# ---------------------------------------------------------------------------

def _make_settings_engine_without_per_type_columns():
    """In-memory SQLite with settings table missing the three new columns."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE settings (
                id INTEGER PRIMARY KEY,
                default_task_type TEXT NOT NULL DEFAULT 'all',
                task_timeout_minutes INTEGER NOT NULL DEFAULT 60,
                task_stall_minutes INTEGER NOT NULL DEFAULT 10
            )
        """))
        conn.execute(text("INSERT INTO settings (id) VALUES (1)"))
    return engine


def test_per_type_timeout_columns_added_by_migration():
    engine = _make_settings_engine_without_per_type_columns()
    import src.schemas.db_helper as dbh
    original = dbh.engine
    dbh.engine = engine
    try:
        _ensure_per_type_timeout_columns()
        with engine.connect() as conn:
            rows = conn.execute(text("PRAGMA table_info(settings)")).fetchall()
            col_names = {row[1] for row in rows}
        assert "scene_timeout_minutes" in col_names
        assert "split_timeout_minutes" in col_names
        assert "subtitle_timeout_minutes" in col_names
    finally:
        dbh.engine = original


def test_per_type_timeout_migration_idempotent():
    """Running migration twice must not raise."""
    engine = _make_settings_engine_without_per_type_columns()
    import src.schemas.db_helper as dbh
    original = dbh.engine
    dbh.engine = engine
    try:
        _ensure_per_type_timeout_columns()
        _ensure_per_type_timeout_columns()  # second call must be a no-op
    finally:
        dbh.engine = original


# ---------------------------------------------------------------------------
# Watchdog per-type timeout logic tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_watchdog_uses_scene_timeout_for_scene_task():
    """SCENE task with per-type scene_timeout_minutes uses it instead of global."""
    from unittest.mock import patch
    from src.task_manager import TaskManager
    from src.models.models import File, Task, TaskStatus, TaskType

    tm = TaskManager()

    dummy_file = File(
        id="f1", name="a.mp4", path="/tmp/a.mp4",
        size=1000, duration="00:01:00", format="mp4", status="unprocessed",
    )
    # Elapsed = 400s; scene_timeout_minutes=5 (300s) should trigger cancel
    task = Task(
        id="t-scene", file=dummy_file, type=TaskType.SCENE,
        status=TaskStatus.PROCESSING, elapsedSeconds=400,
        createdAt="2026-01-01T00:00:00Z",
    )
    tm.tasks_db[task.id] = task

    real_sleep = asyncio.sleep

    async def fast_sleep(_):
        await real_sleep(0)

    cancelled_ids = []
    original_cancel = tm.cancel_task

    async def recording_cancel(task_id, reason=""):
        cancelled_ids.append(task_id)
        await original_cancel(task_id, reason)

    tm.cancel_task = recording_cancel

    with patch('src.task_manager.asyncio.sleep', side_effect=fast_sleep), \
         patch('src.task_manager.get_settings') as mock_get:
        mock_settings = type('Settings', (), {
            'task_timeout_minutes': 60,
            'task_stall_minutes': 10,
            'scene_timeout_minutes': 5,    # 300s < 400s elapsed → cancel
            'split_timeout_minutes': None,
            'subtitle_timeout_minutes': None,
        })()
        mock_get.return_value = mock_settings

        try:
            await asyncio.wait_for(tm._watchdog_loop(), timeout=0.5)
        except asyncio.TimeoutError:
            pass

    assert "t-scene" in cancelled_ids


@pytest.mark.asyncio
async def test_watchdog_falls_back_to_global_for_all_task():
    """ALL task is not in per-type dict, so uses global task_timeout_minutes."""
    from unittest.mock import patch
    from src.task_manager import TaskManager
    from src.models.models import File, Task, TaskStatus, TaskType

    tm = TaskManager()

    dummy_file = File(
        id="f2", name="b.mp4", path="/tmp/b.mp4",
        size=1000, duration="00:01:00", format="mp4", status="unprocessed",
    )
    # Elapsed = 400s; scene_timeout=5min but task is ALL → global 60min (3600s) not hit
    task = Task(
        id="t-all", file=dummy_file, type=TaskType.ALL,
        status=TaskStatus.PROCESSING, elapsedSeconds=400,
        createdAt="2026-01-01T00:00:00Z",
    )
    tm.tasks_db[task.id] = task

    real_sleep = asyncio.sleep

    async def fast_sleep(_):
        await real_sleep(0)

    cancelled_ids = []
    original_cancel = tm.cancel_task

    async def recording_cancel(task_id, reason=""):
        cancelled_ids.append(task_id)
        await original_cancel(task_id, reason)

    tm.cancel_task = recording_cancel

    with patch('src.task_manager.asyncio.sleep', side_effect=fast_sleep), \
         patch('src.task_manager.get_settings') as mock_get:
        mock_settings = type('Settings', (), {
            'task_timeout_minutes': 60,    # 3600s > 400s → no cancel
            'task_stall_minutes': 10,
            'scene_timeout_minutes': 5,    # irrelevant for ALL
            'split_timeout_minutes': None,
            'subtitle_timeout_minutes': None,
        })()
        mock_get.return_value = mock_settings

        try:
            await asyncio.wait_for(tm._watchdog_loop(), timeout=0.5)
        except asyncio.TimeoutError:
            pass

    assert "t-all" not in cancelled_ids


@pytest.mark.asyncio
async def test_watchdog_falls_back_to_global_when_per_type_is_none():
    """SPLIT task with split_timeout_minutes=None falls back to global timeout."""
    from unittest.mock import patch
    from src.task_manager import TaskManager
    from src.models.models import File, Task, TaskStatus, TaskType

    tm = TaskManager()

    dummy_file = File(
        id="f3", name="c.mp4", path="/tmp/c.mp4",
        size=1000, duration="00:01:00", format="mp4", status="unprocessed",
    )
    # Elapsed = 400s; split_timeout=None → global 60min (3600s) not exceeded → no cancel
    task = Task(
        id="t-split", file=dummy_file, type=TaskType.SPLIT,
        status=TaskStatus.PROCESSING, elapsedSeconds=400,
        createdAt="2026-01-01T00:00:00Z",
    )
    tm.tasks_db[task.id] = task

    real_sleep = asyncio.sleep

    async def fast_sleep(_):
        await real_sleep(0)

    cancelled_ids = []
    original_cancel = tm.cancel_task

    async def recording_cancel(task_id, reason=""):
        cancelled_ids.append(task_id)
        await original_cancel(task_id, reason)

    tm.cancel_task = recording_cancel

    with patch('src.task_manager.asyncio.sleep', side_effect=fast_sleep), \
         patch('src.task_manager.get_settings') as mock_get:
        mock_settings = type('Settings', (), {
            'task_timeout_minutes': 60,
            'task_stall_minutes': 10,
            'scene_timeout_minutes': None,
            'split_timeout_minutes': None,   # no override → fall back to global
            'subtitle_timeout_minutes': None,
        })()
        mock_get.return_value = mock_settings

        try:
            await asyncio.wait_for(tm._watchdog_loop(), timeout=0.5)
        except asyncio.TimeoutError:
            pass

    assert "t-split" not in cancelled_ids
