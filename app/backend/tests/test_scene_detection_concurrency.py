import asyncio
import contextlib
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from src.models.models import File, Task, TaskStatus, TaskType
from src.task_manager import TaskManager


@pytest.mark.asyncio
async def test_scene_detection_limit_caps_parallel_operations():
    manager = TaskManager()
    active = 0
    peak = 0

    async def operation():
        nonlocal active, peak
        await manager._acquire_scene_detection_slot(2)
        try:
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1
        finally:
            await manager._release_scene_detection_slot()

    await asyncio.gather(*(operation() for _ in range(5)))

    assert peak == 2


@pytest.mark.asyncio
async def test_task_waiting_for_detection_slot_stays_queued(tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"video")
    manager = TaskManager()
    task = Task(
        id="waiting-scene-task",
        file=File(id="file-1", name=video_path.name, path=str(video_path), size=5, format=".mp4"),
        type=TaskType.SCENE,
        status=TaskStatus.QUEUED,
        createdAt="2026-09-20T00:00:00Z",
    )
    manager.tasks_db[task.id] = task

    await manager._acquire_scene_detection_slot(1)
    settings = SimpleNamespace(scene_detection_concurrency=1)
    with (
        patch("src.task_manager.get_settings", return_value=settings),
        patch("src.task_manager.update_task"),
    ):
        processing = asyncio.create_task(manager.process_video(task.id))
        await asyncio.sleep(0.02)
        assert task.status == TaskStatus.QUEUED
        processing.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await processing

    await manager._release_scene_detection_slot()


@pytest.mark.asyncio
async def test_frame_pacing_task_waiting_for_split_lane_stays_queued(tmp_path):
    video_path = tmp_path / "video.mp4"
    video_path.write_bytes(b"video")
    manager = TaskManager()
    task = Task(
        id="waiting-frame-pacing-task",
        file=File(id="file-1", name=video_path.name, path=str(video_path), size=5, format=".mp4"),
        type=TaskType.ANALYZE_FRAME_PACING,
        status=TaskStatus.QUEUED,
        createdAt="2026-09-20T00:00:00Z",
    )
    manager.tasks_db[task.id] = task

    await manager._downstream_processing_lock.acquire()
    settings = SimpleNamespace(scene_detection_concurrency=1)
    with (
        patch("src.task_manager.get_settings", return_value=settings),
        patch("src.task_manager.update_task"),
    ):
        processing = asyncio.create_task(manager.process_video(task.id))
        await asyncio.sleep(0.02)
        assert task.status == TaskStatus.QUEUED
        processing.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await processing

    manager._downstream_processing_lock.release()


@pytest.mark.asyncio
async def test_downstream_processing_remains_serial():
    manager = TaskManager()
    active = 0
    peak = 0

    async def operation():
        nonlocal active, peak
        async with manager._downstream_processing_lock:
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1

    await asyncio.gather(*(operation() for _ in range(3)))

    assert peak == 1
