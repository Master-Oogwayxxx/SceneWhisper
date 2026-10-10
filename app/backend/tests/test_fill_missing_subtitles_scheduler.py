import asyncio
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.models import DirectoryMonitor, File, Schedule, ScheduleInterval, TaskStatus, TaskType
from src.workers.monitor_scheduler import _fill_missing_subtitles


def _make_monitor(directory_id: str = "dir-1", subtitle_language: str = "en") -> DirectoryMonitor:
    return DirectoryMonitor(
        id=str(uuid.uuid4()),
        directoryId=directory_id,
        directoryName="Test",
        directoryPath="/test",
        taskType=TaskType.ALL,
        subtitleLanguage=subtitle_language,
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        deleteVideoAfterCompletion=False,
        fillMissingSubtitles=True,
        createdAt="2026-01-01T00:00:00",
    )


def _make_file_record(file_id: str, path: str, directory_id: str = "dir-1"):
    record = MagicMock()
    record.id = file_id
    record.path = path
    record.name = Path(path).name
    record.directory_id = directory_id
    return record


@pytest.mark.asyncio
async def test_queues_task_for_file_missing_subtitle(tmp_path):
    video_path = str(tmp_path / "video.mp4")
    file_id = "file-1"
    monitor = _make_monitor()
    task_manager = AsyncMock()

    with (
        patch("src.workers.monitor_scheduler._get_video_file_records", return_value=[_make_file_record(file_id, video_path)]),
        patch("src.workers.monitor_scheduler._has_subtitle_child_in_db", return_value=False),
        patch("src.workers.monitor_scheduler._has_srt_on_disk", return_value=False),
        patch("src.workers.monitor_scheduler.has_active_task", return_value=False),
    ):
        queued, skipped = await _fill_missing_subtitles(task_manager, monitor)

    assert queued == 1
    assert skipped == 0
    task_manager.add_task.assert_called_once()
    call_args = task_manager.add_task.call_args[0][0]
    assert call_args.type == TaskType.SUBTITLE
    assert call_args.subtitleLanguage == "en"


@pytest.mark.asyncio
async def test_skips_file_with_subtitle_in_db(tmp_path):
    video_path = str(tmp_path / "video.mp4")
    monitor = _make_monitor()
    task_manager = AsyncMock()

    with (
        patch("src.workers.monitor_scheduler._get_video_file_records", return_value=[_make_file_record("file-1", video_path)]),
        patch("src.workers.monitor_scheduler._has_subtitle_child_in_db", return_value=True),
        patch("src.workers.monitor_scheduler._has_srt_on_disk", return_value=False),
        patch("src.workers.monitor_scheduler.has_active_task", return_value=False),
    ):
        queued, skipped = await _fill_missing_subtitles(task_manager, monitor)

    assert queued == 0
    assert skipped == 1
    task_manager.add_task.assert_not_called()


@pytest.mark.asyncio
async def test_skips_file_with_srt_on_disk(tmp_path):
    video_path = str(tmp_path / "video.mp4")
    monitor = _make_monitor()
    task_manager = AsyncMock()

    with (
        patch("src.workers.monitor_scheduler._get_video_file_records", return_value=[_make_file_record("file-1", video_path)]),
        patch("src.workers.monitor_scheduler._has_subtitle_child_in_db", return_value=False),
        patch("src.workers.monitor_scheduler._has_srt_on_disk", return_value=True),
        patch("src.workers.monitor_scheduler.has_active_task", return_value=False),
    ):
        queued, skipped = await _fill_missing_subtitles(task_manager, monitor)

    assert queued == 0
    assert skipped == 1
    task_manager.add_task.assert_not_called()


@pytest.mark.asyncio
async def test_skips_file_with_active_task(tmp_path):
    video_path = str(tmp_path / "video.mp4")
    monitor = _make_monitor()
    task_manager = AsyncMock()

    with (
        patch("src.workers.monitor_scheduler._get_video_file_records", return_value=[_make_file_record("file-1", video_path)]),
        patch("src.workers.monitor_scheduler._has_subtitle_child_in_db", return_value=False),
        patch("src.workers.monitor_scheduler._has_srt_on_disk", return_value=False),
        patch("src.workers.monitor_scheduler.has_active_task", return_value=True),
    ):
        queued, skipped = await _fill_missing_subtitles(task_manager, monitor)

    assert queued == 0
    assert skipped == 1
    task_manager.add_task.assert_not_called()
