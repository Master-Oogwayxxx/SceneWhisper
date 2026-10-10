import inspect
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.task_manager import TaskManager

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.schemas.setting import Base, SettingRecord


def test_setting_record_has_timeout_columns():
    cols = {c.key for c in SettingRecord.__table__.columns}
    assert "task_timeout_minutes" in cols
    assert "task_stall_minutes" in cols


def test_setting_record_timeout_defaults():
    # Use in-memory SQLite, create schema
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Insert with no explicit values — should use defaults
    record = SettingRecord()
    session.add(record)
    session.commit()

    # Verify defaults were applied in DB
    assert record.task_timeout_minutes == 60
    assert record.task_stall_minutes == 10


def test_task_manager_has_progress_snapshots():
    tm = TaskManager()
    assert hasattr(tm, '_progress_snapshots')
    assert isinstance(tm._progress_snapshots, dict)


def test_task_manager_has_watchdog_loop():
    tm = TaskManager()
    assert hasattr(tm, '_watchdog_loop')
    assert inspect.iscoroutinefunction(tm._watchdog_loop)


@pytest.mark.asyncio
async def test_watchdog_loop_basic_cycle():
    """Test watchdog completes a basic iteration without errors."""
    import asyncio
    from unittest.mock import patch

    from src.models.models import File, Task, TaskStatus, TaskType

    tm = TaskManager()

    # Add a processing task
    dummy_file = File(
        id="test-file",
        name="test.mp4",
        path="/tmp/test.mp4",
        size=1000,
        duration="00:01:00",
        format="mp4",
        status="unprocessed",
    )
    task = Task(
        id="test-task",
        file=dummy_file,
        type=TaskType.ALL,
        status=TaskStatus.PROCESSING,
        elapsedSeconds=5,
        createdAt="2026-01-01T00:00:00Z",
    )
    tm.tasks_db[task.id] = task

    real_sleep = asyncio.sleep

    async def fast_sleep(_):
        """Replace 60s sleep with instant yield."""
        await real_sleep(0)

    # Mock sleep to skip the 60s delay, and mock settings
    with patch('src.task_manager.asyncio.sleep', side_effect=fast_sleep), \
         patch('src.task_manager.get_settings') as mock_get:
        mock_settings = type('Settings', (), {
            'task_timeout_minutes': 60,
            'task_stall_minutes': 10,
            'scene_timeout_minutes': None,
            'split_timeout_minutes': None,
            'subtitle_timeout_minutes': None,
        })()
        mock_get.return_value = mock_settings

        # Run watchdog for one iteration; it's infinite so we use a timeout
        try:
            await asyncio.wait_for(tm._watchdog_loop(), timeout=0.5)
        except asyncio.TimeoutError:
            pass  # Expected — watchdog runs forever

        # Verify snapshot was created for the task
        assert "test-task" in tm._progress_snapshots


import inspect

def test_cancel_task_accepts_reason_param():
    tm = TaskManager()
    sig = inspect.signature(tm.cancel_task)
    assert "reason" in sig.parameters
    assert sig.parameters["reason"].default == ""
