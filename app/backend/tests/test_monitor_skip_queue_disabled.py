"""Tests that run_monitor skips files with queue_disabled=True."""
import asyncio
import uuid
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.models import DirectoryMonitor, Schedule, ScheduleInterval, TaskType


def _make_monitor() -> DirectoryMonitor:
    return DirectoryMonitor(
        id=str(uuid.uuid4()),
        directoryId=str(uuid.uuid4()),
        directoryName="Test Dir",
        directoryPath="/fake/dir",
        taskType=TaskType.SCENE,
        subtitleLanguage=None,
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="00:00"),
        isActive=True,
        deleteVideoAfterCompletion=False,
        lastRun=None,
        nextRun=None,
        createdAt="2026-01-01T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_run_monitor_skips_queue_disabled_file():
    """Files with queue_disabled=True must not get a new task."""
    from src.workers.monitor_scheduler import run_monitor

    monitor = _make_monitor()
    task_manager = AsyncMock()
    loop = asyncio.get_running_loop()

    with (
        patch("src.workers.monitor_scheduler._load_video_candidates",
              return_value=([], ["/fake/dir/video.mp4"], ["queue_disabled=True"])),
        patch("src.workers.monitor_scheduler.update_directory_monitor"),
        patch("src.workers.monitor_scheduler.calculate_next_run", return_value=datetime.utcnow()),
    ):
        queued, skipped = await run_monitor(task_manager, monitor, loop)

    task_manager.add_task.assert_not_called()
    assert skipped == 1
    assert queued == 0


@pytest.mark.asyncio
async def test_run_monitor_queues_non_disabled_file():
    """Files with queue_disabled=False must get a task."""
    from src.workers.monitor_scheduler import run_monitor

    monitor = _make_monitor()
    task_manager = AsyncMock()
    loop = asyncio.get_running_loop()

    with (
        patch("src.workers.monitor_scheduler._load_video_candidates",
              return_value=(["/fake/dir/video.mp4"], [], [])),
        patch("src.workers.monitor_scheduler._is_monitor_task_disabled", return_value=None),
        patch("src.workers.monitor_scheduler.update_directory_monitor"),
        patch("src.workers.monitor_scheduler.calculate_next_run", return_value=datetime.utcnow()),
    ):
        queued, skipped = await run_monitor(task_manager, monitor, loop)

    task_manager.add_task.assert_called_once()
    assert queued == 1
    assert skipped == 0
