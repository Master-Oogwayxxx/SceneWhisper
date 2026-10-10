"""Tests that run_monitor skips already-processed video files."""
import asyncio
import uuid
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.models import DirectoryMonitor, Schedule, ScheduleInterval, TaskType
from src.workers.monitor_scheduler import run_monitor


def _make_monitor(task_type: TaskType) -> DirectoryMonitor:
    """Create a test DirectoryMonitor with given taskType."""
    return DirectoryMonitor(
        id=str(uuid.uuid4()),
        directoryId=str(uuid.uuid4()),
        directoryName="Test Dir",
        directoryPath="/fake/dir",
        taskType=task_type,
        subtitleLanguage="en",
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="00:00"),
        isActive=True,
        deleteVideoAfterCompletion=False,
        fillMissingSubtitles=False,
        lastRun=None,
        nextRun=None,
        createdAt="2026-01-01T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_run_monitor_skips_file_with_completed_split():
    """Files already split (DB record) must not get a new task."""
    monitor = _make_monitor(TaskType.SPLIT)
    task_manager = AsyncMock()
    loop = asyncio.get_running_loop()

    with (
        patch("src.workers.monitor_scheduler._load_video_candidates",
              return_value=([], ["/fake/dir/video.mp4"], ["already split (DB record)"])),
        patch("src.workers.monitor_scheduler.update_directory_monitor") as mock_update,
        patch("src.workers.monitor_scheduler.calculate_next_run", return_value=datetime.utcnow()),
    ):
        await run_monitor(task_manager, monitor, loop)

    task_manager.add_task.assert_not_called()
    mock_update.assert_called_once()


@pytest.mark.asyncio
async def test_run_monitor_skips_file_with_split_files_on_disk(tmp_path):
    """Files with split .mp4s on disk (no DB record) must not get a new task."""
    monitor = _make_monitor(TaskType.SPLIT)
    monitor = monitor.model_copy(update={"directoryPath": str(tmp_path)})
    task_manager = AsyncMock()
    loop = asyncio.get_running_loop()

    # Create a fake split file on disk so find_pyscenedetect_splits returns it
    (tmp_path / "video-001.mp4").touch()
    (tmp_path / "video.mp4").touch()

    # Mock the DB session so no DB is needed; all bulk queries return empty sets
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = []

    with (
        patch("src.workers.monitor_scheduler.get_db", return_value=mock_db),
        patch("src.workers.monitor_scheduler.close_db"),
        patch("src.workers.monitor_scheduler.get_settings",
              return_value=MagicMock(ignore_patterns=None)),
        patch("src.workers.monitor_scheduler.update_directory_monitor") as mock_update,
        patch("src.workers.monitor_scheduler.calculate_next_run", return_value=datetime.utcnow()),
    ):
        await run_monitor(task_manager, monitor, loop)

    task_manager.add_task.assert_not_called()
    mock_update.assert_called_once()


@pytest.mark.asyncio
async def test_run_monitor_skips_file_with_completed_subtitles():
    """Files already subtitled (DB record) must not get a new task."""
    monitor = _make_monitor(TaskType.SUBTITLE)
    task_manager = AsyncMock()
    loop = asyncio.get_running_loop()

    with (
        patch("src.workers.monitor_scheduler._load_video_candidates",
              return_value=([], ["/fake/dir/video.mp4"], ["already has subtitles (DB record)"])),
        patch("src.workers.monitor_scheduler.update_directory_monitor") as mock_update,
        patch("src.workers.monitor_scheduler.calculate_next_run", return_value=datetime.utcnow()),
    ):
        await run_monitor(task_manager, monitor, loop)

    task_manager.add_task.assert_not_called()
    mock_update.assert_called_once()


@pytest.mark.asyncio
async def test_run_monitor_skips_file_with_srt_on_disk(tmp_path):
    """Files with existing .srt on disk (no DB record) must not get a new task."""
    monitor = _make_monitor(TaskType.SUBTITLE)
    monitor = monitor.model_copy(update={"directoryPath": str(tmp_path)})
    task_manager = AsyncMock()
    loop = asyncio.get_running_loop()

    (tmp_path / "video.mp4").touch()
    (tmp_path / "video-en.srt").touch()

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = []

    with (
        patch("src.workers.monitor_scheduler.get_db", return_value=mock_db),
        patch("src.workers.monitor_scheduler.close_db"),
        patch("src.workers.monitor_scheduler.get_settings",
              return_value=MagicMock(ignore_patterns=None)),
        patch("src.workers.monitor_scheduler.update_directory_monitor") as mock_update,
        patch("src.workers.monitor_scheduler.calculate_next_run", return_value=datetime.utcnow()),
    ):
        await run_monitor(task_manager, monitor, loop)

    task_manager.add_task.assert_not_called()
    mock_update.assert_called_once()


@pytest.mark.asyncio
async def test_run_monitor_all_queues_file_with_subtitle_but_no_splits(tmp_path):
    """ALL monitor must queue a file that has subtitles but no split videos yet."""
    monitor = _make_monitor(TaskType.ALL)
    monitor = monitor.model_copy(update={"directoryPath": str(tmp_path)})
    task_manager = AsyncMock()
    task_manager.add_task = AsyncMock(return_value=(True, None))
    loop = asyncio.get_running_loop()

    (tmp_path / "CAWD-362-RM.mp4").touch()
    # Subtitle exists but no split files
    (tmp_path / "CAWD-362-RM-en.srt").touch()

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = []

    with (
        patch("src.workers.monitor_scheduler.get_db", return_value=mock_db),
        patch("src.workers.monitor_scheduler.close_db"),
        patch("src.workers.monitor_scheduler.get_settings",
              return_value=MagicMock(ignore_patterns=None)),
        patch("src.workers.monitor_scheduler.update_directory_monitor"),
        patch("src.workers.monitor_scheduler.calculate_next_run", return_value=datetime.utcnow()),
    ):
        queued, skipped = await run_monitor(task_manager, monitor, loop)

    assert queued == 1
    assert skipped == 0
    task_manager.add_task.assert_called_once()
    task = task_manager.add_task.call_args[0][0]
    assert task.file.name == "CAWD-362-RM.mp4"


@pytest.mark.asyncio
async def test_run_monitor_all_queues_file_with_splits_but_no_subtitle(tmp_path):
    """ALL monitor must queue a file that has split videos but no subtitles yet."""
    monitor = _make_monitor(TaskType.ALL)
    monitor = monitor.model_copy(update={"directoryPath": str(tmp_path)})
    task_manager = AsyncMock()
    task_manager.add_task = AsyncMock(return_value=(True, None))
    loop = asyncio.get_running_loop()

    (tmp_path / "CAWD-362-RM.mp4").touch()
    (tmp_path / "CAWD-362-RM-001.mp4").touch()

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = []

    with (
        patch("src.workers.monitor_scheduler._load_video_candidates",
              return_value=([str(tmp_path / "CAWD-362-RM.mp4")], [str(tmp_path / "CAWD-362-RM-001.mp4")], ["split files exist on disk"])),
        patch("src.workers.monitor_scheduler.get_db", return_value=mock_db),
        patch("src.workers.monitor_scheduler.close_db"),
        patch("src.workers.monitor_scheduler.get_settings",
              return_value=MagicMock(ignore_patterns=None)),
        patch("src.workers.monitor_scheduler.update_directory_monitor"),
        patch("src.workers.monitor_scheduler.calculate_next_run", return_value=datetime.utcnow()),
    ):
        queued, skipped = await run_monitor(task_manager, monitor, loop)

    assert queued == 1
    assert skipped == 1
    task_manager.add_task.assert_called_once()
    task = task_manager.add_task.call_args[0][0]
    assert task.file.name == "CAWD-362-RM.mp4"


@pytest.mark.asyncio
async def test_run_monitor_all_skips_file_with_subtitle_and_splits(tmp_path):
    """ALL monitor must skip a file that has both subtitles and split videos."""
    monitor = _make_monitor(TaskType.ALL)
    monitor = monitor.model_copy(update={"directoryPath": str(tmp_path)})
    task_manager = AsyncMock()
    loop = asyncio.get_running_loop()

    (tmp_path / "CAWD-362-RM.mp4").touch()
    (tmp_path / "CAWD-362-RM-001.mp4").touch()
    (tmp_path / "CAWD-362-RM-en.srt").touch()

    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.all.return_value = []

    with (
        patch("src.workers.monitor_scheduler.get_db", return_value=mock_db),
        patch("src.workers.monitor_scheduler.close_db"),
        patch("src.workers.monitor_scheduler.get_settings",
              return_value=MagicMock(ignore_patterns=None)),
        patch("src.workers.monitor_scheduler.update_directory_monitor"),
        patch("src.workers.monitor_scheduler.calculate_next_run", return_value=datetime.utcnow()),
    ):
        queued, skipped = await run_monitor(task_manager, monitor, loop)

    assert queued == 0
    task_manager.add_task.assert_not_called()


@pytest.mark.asyncio
async def test_run_monitor_queues_unprocessed_file():
    """Files with no existing outputs must be queued normally."""
    monitor = _make_monitor(TaskType.ALL)
    task_manager = AsyncMock()
    task_manager.add_task = AsyncMock(return_value=(True, None))
    loop = asyncio.get_running_loop()

    with (
        patch("src.workers.monitor_scheduler._load_video_candidates",
              return_value=(["/fake/dir/video.mp4"], [], [])),
        patch("src.workers.monitor_scheduler.update_directory_monitor") as mock_update,
        patch("src.workers.monitor_scheduler.calculate_next_run", return_value=datetime.utcnow()),
    ):
        await run_monitor(task_manager, monitor, loop)

    task_manager.add_task.assert_called_once()
    task = task_manager.add_task.call_args[0][0]
    assert task.type == TaskType.ALL
    assert task.file.name == "video.mp4"
    mock_update.assert_called_once()
