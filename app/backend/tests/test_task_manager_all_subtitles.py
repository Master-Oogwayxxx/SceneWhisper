from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from scenedetect import FrameTimecode

from src.models.models import File, Task, TaskStatus, TaskType
from src.task_manager import TaskManager


def _settings():
    return SimpleNamespace(
        split_concurrency=1,
        subtitle_concurrency=1,
        scene_detector="content",
        scene_content_threshold=27.0,
        scene_adaptive_threshold=3.0,
        scene_black_threshold=15,
        scene_white_threshold=200,
        min_scene_length_frames=15,
    )


@pytest.mark.asyncio
async def test_all_task_generates_subtitles_for_new_split_segments(tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"video")

    task = Task(
        id="task-all",
        file=File(
            id="file-1",
            name=video_path.name,
            path=str(video_path),
            size=video_path.stat().st_size,
            duration="00:00:02",
            format=".mp4",
        ),
        type=TaskType.ALL,
        status=TaskStatus.QUEUED,
        createdAt="2026-01-01T00:00:00",
        subtitleLanguage="English",
    )

    manager = TaskManager()
    manager.tasks_db[task.id] = task

    scenes = [
        (FrameTimecode("00:00:00.000", 30), FrameTimecode("00:00:01.000", 30)),
        (FrameTimecode("00:00:01.000", 30), FrameTimecode("00:00:02.000", 30)),
    ]

    async def fake_split_video(*_args, **_kwargs):
        (tmp_path / "video-001.mp4").write_bytes(b"segment-1")
        (tmp_path / "video-002.mp4").write_bytes(b"segment-2")

    async def fake_generate_subtitles(*_args, **_kwargs):
        return "subtitle text"

    mock_scene_crud = MagicMock()
    mock_scene_crud.return_value.get_scenes_for_file.return_value = []

    with (
        patch("src.task_manager.get_settings", return_value=_settings()),
        patch("src.task_manager.update_task"),
        patch("src.task_manager.get_db", return_value=MagicMock()),
        patch("src.task_manager.close_db"),
        patch("src.task_manager.SceneCRUD", mock_scene_crud),
        patch.object(manager, "_emit_notification_tracked"),
        patch.object(manager, "_track_new_split_files"),
        patch.object(manager, "_track_new_subtitle_files"),
        patch("src.processor.detect_scenes", return_value=scenes),
        patch("src.processor.split_video", side_effect=fake_split_video),
        patch("src.processor.generate_subtitles", side_effect=fake_generate_subtitles) as generate_subtitles,
        patch("src.processor.save_subtitles"),
    ):
        await manager.process_video(task.id)

    generated_paths = [Path(call.args[0]).name for call in generate_subtitles.call_args_list]
    assert generated_paths == ["video-001.mp4", "video-002.mp4"]
    assert task.subtitle_progress == 100.0
