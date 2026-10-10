from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.models.models import File, Task, TaskStatus, TaskType


class _FakeTimecode:
    def __init__(self, seconds: float) -> None:
        self._seconds = seconds

    def get_frames(self) -> int:
        return int(self._seconds * 30)

    def get_seconds(self) -> float:
        return self._seconds

    def __str__(self) -> str:
        total_seconds = self._seconds
        hours = int(total_seconds // 3600)
        minutes = int((total_seconds % 3600) // 60)
        seconds = total_seconds % 60
        return f"{hours:02d}:{minutes:02d}:{seconds:05.2f}"


@pytest.mark.asyncio
async def test_manual_all_task_generates_subtitles_for_split_outputs(tmp_path):
    from src.task_manager import TaskManager

    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"video")

    task = Task(
        id="task-1",
        file=File(
            id="file-1",
            name=video_path.name,
            path=str(video_path),
            size=video_path.stat().st_size,
            duration="00:01:00",
            format=".mp4",
        ),
        type=TaskType.ALL,
        status=TaskStatus.QUEUED,
        subtitleLanguage="en",
        createdAt="2026-07-07T00:00:00Z",
    )

    tm = TaskManager()
    tm.tasks_db[task.id] = task

    fake_scenes = [
        (_FakeTimecode(0.0), _FakeTimecode(10.0)),
        (_FakeTimecode(10.0), _FakeTimecode(20.0)),
    ]
    generate_subtitles = AsyncMock(return_value="1\n00:00:00,000 --> 00:00:01,000\nhello\n")

    async def _noop_notification(*args, **kwargs):
        return None

    with (
        patch(
            "src.task_manager.get_settings",
            return_value=SimpleNamespace(
                split_concurrency=1,
                subtitle_concurrency=1,
                split_min_video_duration_seconds=0,
                scene_detector="content",
                scene_content_threshold=27.0,
                scene_adaptive_threshold=3.0,
                scene_black_threshold=12.0,
                scene_white_threshold=245.0,
                min_scene_length_frames=15,
                ffmpeg_preset="p6",
                ffmpeg_cq=23,
            ),
        ),
        patch.object(tm, "_emit_notification_tracked", side_effect=_noop_notification),
        patch.object(tm, "update_task_progress", new=AsyncMock()),
        patch("src.task_manager.update_task"),
        patch("src.task_manager.get_db", return_value=object()),
        patch("src.task_manager.close_db"),
        patch("src.task_manager.SceneCRUD") as mock_scene_crud,
        patch.object(tm, "_track_new_split_files"),
        patch.object(tm, "_track_new_subtitle_files"),
        patch("src.processor.detect_scenes", new=AsyncMock(return_value=fake_scenes)),
        patch("src.processor.split_video", new=AsyncMock()),
        patch("src.processor.generate_subtitles", generate_subtitles),
        patch("src.processor.save_subtitles"),
        patch("src.processor.reencode_video", new=AsyncMock()),
        patch("src.processor.merge_videos", new=AsyncMock()),
        patch("src.processor.merge_subtitles"),
    ):
        mock_scene_crud.return_value.get_scenes_for_file.return_value = []
        await tm.process_video(task.id)

    generated_paths = [Path(call.args[0]).name for call in generate_subtitles.await_args_list]
    assert generated_paths == ["video-001.mp4", "video-002.mp4"]


@pytest.mark.asyncio
async def test_split_task_skips_short_video_before_ffmpeg(tmp_path):
    from src.task_manager import TaskManager

    video_path = tmp_path / "short.mp4"
    video_path.write_bytes(b"video")

    task = Task(
        id="task-short",
        file=File(
            id="file-short",
            name=video_path.name,
            path=str(video_path),
            size=video_path.stat().st_size,
            duration="00:01:00",
            format=".mp4",
        ),
        type=TaskType.SPLIT,
        status=TaskStatus.QUEUED,
        subtitleLanguage="en",
        createdAt="2026-07-07T00:00:00Z",
    )

    tm = TaskManager()
    tm.tasks_db[task.id] = task

    fake_scenes = [
        (_FakeTimecode(0.0), _FakeTimecode(10.0)),
        (_FakeTimecode(10.0), _FakeTimecode(20.0)),
    ]

    async def _noop_notification(*args, **kwargs):
        return None

    split_video = AsyncMock()

    with (
        patch(
            "src.task_manager.get_settings",
            return_value=SimpleNamespace(
                split_concurrency=1,
                subtitle_concurrency=1,
                split_min_video_duration_seconds=120,
                scene_detector="content",
                scene_content_threshold=27.0,
                scene_adaptive_threshold=3.0,
                scene_black_threshold=12.0,
                scene_white_threshold=245.0,
                min_scene_length_frames=15,
            ),
        ),
        patch.object(tm, "_emit_notification_tracked", side_effect=_noop_notification),
        patch.object(tm, "update_task_progress", new=AsyncMock()),
        patch("src.task_manager.update_task"),
        patch("src.task_manager.get_db", return_value=object()),
        patch("src.task_manager.close_db"),
        patch("src.task_manager.SceneCRUD") as mock_scene_crud,
        patch("src.processor.detect_scenes", new=AsyncMock(return_value=fake_scenes)),
        patch("src.processor.split_video", split_video),
    ):
        mock_scene_crud.return_value.get_scenes_for_file.return_value = []
        await tm.process_video(task.id)

    split_video.assert_not_awaited()
    assert task.status == TaskStatus.FAILED
    assert "below the split threshold" in (task.error or "")
