from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from scenedetect import FrameTimecode

from src.models.models import File, Task, TaskStatus, TaskType
from src.processor import SplitVideoFfmpegError, split_output_paths
from src.task_manager import TaskManager, _scene_fps_from_file


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


def _split_task(tmp_path: Path) -> Task:
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"video")
    return Task(
        id="task-split",
        file=File(
            id="file-1",
            name=video_path.name,
            path=str(video_path),
            size=video_path.stat().st_size,
            duration="00:00:02",
            format=".mp4",
        ),
        type=TaskType.SPLIT,
        status=TaskStatus.QUEUED,
        createdAt="2026-01-01T00:00:00",
    )


@pytest.mark.asyncio
async def test_zero_size_split_task_is_cancelled_with_file_size_reason(tmp_path):
    task = _split_task(tmp_path)
    task.file.size = 0
    manager = TaskManager()
    manager.tasks_db[task.id] = task

    with (
        patch("src.task_manager.update_task") as update_task,
        patch.object(manager, "_emit_notification_tracked", new_callable=AsyncMock) as emit_notification,
        patch("src.task_manager.get_settings") as get_settings,
        patch("src.processor.detect_scenes", new_callable=AsyncMock) as detect_scenes,
    ):
        await manager.process_video(task.id)

    assert task.status == TaskStatus.CANCELLED
    assert task.error == "File size is 0 bytes"
    assert task.id not in manager.tasks_db
    update_task.assert_called_once_with(task)
    emit_notification.assert_awaited_once()
    get_settings.assert_not_called()
    detect_scenes.assert_not_awaited()


def test_scene_fps_from_file_prefers_positive_file_fps():
    file = File(
        id="file-1",
        name="video.mp4",
        path="/tmp/video.mp4",
        size=1,
        format=".mp4",
        fps=23.976,
    )

    assert _scene_fps_from_file(file) == 23.976


@pytest.mark.parametrize("fps", [None, 0, 0.0, -1, "bad"])
def test_scene_fps_from_file_falls_back_for_invalid_values(fps):
    file = SimpleNamespace(fps=fps)

    assert _scene_fps_from_file(file) == 30.0


def _scenes():
    return [
        (FrameTimecode("00:00:00.000", 30), FrameTimecode("00:00:01.000", 30)),
        (FrameTimecode("00:00:01.000", 30), FrameTimecode("00:00:02.000", 30)),
    ]


def test_split_output_paths():
    paths = split_output_paths("/media/clip.mp4", 3)
    assert paths == [
        Path("/media/clip-001.mp4"),
        Path("/media/clip-002.mp4"),
        Path("/media/clip-003.mp4"),
    ]


def _scene_crud_mock():
    mock_scene_crud = MagicMock()
    mock_scene_crud.return_value.get_scenes_for_file.return_value = []
    return mock_scene_crud


@pytest.mark.asyncio
async def test_non_ffmpeg_split_error_skips_reencode_fallback(tmp_path):
    task = _split_task(tmp_path)
    manager = TaskManager()
    manager.tasks_db[task.id] = task

    async def failing_split(*_args, **_kwargs):
        raise OSError("No space left on device")

    with (
        patch("src.task_manager.get_settings", return_value=_settings()),
        patch("src.task_manager.update_task"),
        patch("src.task_manager.get_db", return_value=MagicMock()),
        patch("src.task_manager.close_db"),
        patch("src.task_manager.SceneCRUD", _scene_crud_mock()),
        patch.object(manager, "_emit_notification_tracked"),
        patch.object(manager, "_track_new_split_files"),
        patch("src.processor.detect_scenes", return_value=_scenes()),
        patch("src.processor.split_video", side_effect=failing_split),
        patch("src.processor.reencode_video", new_callable=AsyncMock) as reencode_video,
    ):
        await manager.process_video(task.id)

    reencode_video.assert_not_called()
    assert task.status == TaskStatus.FAILED
    assert "No space left on device" in task.error


@pytest.mark.asyncio
async def test_ffmpeg_split_failure_reencodes_and_retries(tmp_path):
    task = _split_task(tmp_path)
    manager = TaskManager()
    manager.tasks_db[task.id] = task
    split_calls: list[str] = []

    async def split_side_effect(video_path, *_args, **_kwargs):
        split_calls.append(str(video_path))
        if len(split_calls) == 1:
            raise SplitVideoFfmpegError("Splitting Video failed: ffmpeg exited 1 on scene 1")
        (tmp_path / "video-001.mp4").write_bytes(b"segment-1")
        (tmp_path / "video-002.mp4").write_bytes(b"segment-2")

    reencode_video = AsyncMock()

    with (
        patch("src.task_manager.get_settings", return_value=_settings()),
        patch("src.task_manager.update_task"),
        patch("src.task_manager.get_db", return_value=MagicMock()),
        patch("src.task_manager.close_db"),
        patch("src.task_manager.SceneCRUD", _scene_crud_mock()),
        patch.object(manager, "_emit_notification_tracked"),
        patch.object(manager, "_track_new_split_files"),
        patch("src.processor.detect_scenes", return_value=_scenes()),
        patch("src.processor.split_video", side_effect=split_side_effect),
        patch("src.processor.reencode_video", reencode_video),
    ):
        await manager.process_video(task.id)

    reencode_video.assert_awaited_once()
    assert split_calls == [str(task.file.path), str(task.file.path)]
    assert task.status == TaskStatus.COMPLETED


@pytest.mark.asyncio
async def test_partial_split_outputs_removed_before_retry(tmp_path):
    task = _split_task(tmp_path)
    manager = TaskManager()
    manager.tasks_db[task.id] = task

    partial_paths = split_output_paths(task.file.path, len(_scenes()))
    for path in partial_paths:
        path.write_bytes(b"partial")

    split_calls = 0

    async def split_side_effect(*_args, **_kwargs):
        nonlocal split_calls
        split_calls += 1
        if split_calls == 1:
            raise SplitVideoFfmpegError("Splitting Video failed: ffmpeg exited 1 on scene 2")
        (tmp_path / "video-001.mp4").write_bytes(b"segment-1")
        (tmp_path / "video-002.mp4").write_bytes(b"segment-2")

    with (
        patch("src.task_manager.get_settings", return_value=_settings()),
        patch("src.task_manager.update_task"),
        patch("src.task_manager.get_db", return_value=MagicMock()),
        patch("src.task_manager.close_db"),
        patch("src.task_manager.SceneCRUD", _scene_crud_mock()),
        patch.object(manager, "_emit_notification_tracked"),
        patch.object(manager, "_track_new_split_files"),
        patch("src.processor.detect_scenes", return_value=_scenes()),
        patch("src.processor.split_video", side_effect=split_side_effect),
        patch("src.processor.reencode_video", new_callable=AsyncMock),
    ):
        await manager.process_video(task.id)

    assert (tmp_path / "video-001.mp4").read_bytes() == b"segment-1"
    assert (tmp_path / "video-002.mp4").read_bytes() == b"segment-2"


@pytest.mark.asyncio
async def test_source_file_preserved_when_retry_split_fails(tmp_path):
    task = _split_task(tmp_path)
    manager = TaskManager()
    manager.tasks_db[task.id] = task
    source_path = Path(task.file.path)

    async def always_fail_split(*_args, **_kwargs):
        raise SplitVideoFfmpegError("Splitting Video failed: ffmpeg exited 1 on scene 1")

    with (
        patch("src.task_manager.get_settings", return_value=_settings()),
        patch("src.task_manager.update_task"),
        patch("src.task_manager.get_db", return_value=MagicMock()),
        patch("src.task_manager.close_db"),
        patch("src.task_manager.SceneCRUD", _scene_crud_mock()),
        patch.object(manager, "_emit_notification_tracked"),
        patch("src.processor.detect_scenes", return_value=_scenes()),
        patch("src.processor.split_video", side_effect=always_fail_split),
        patch("src.processor.reencode_video", new_callable=AsyncMock),
    ):
        await manager.process_video(task.id)

    assert source_path.exists()
    assert task.status == TaskStatus.FAILED
    assert "even after video reencoding" in task.error
