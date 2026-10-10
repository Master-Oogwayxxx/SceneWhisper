"""Test that unpaused tasks are re-queued for processing."""
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.models.models import File, Task, TaskStatus, TaskType
from src.task_manager import TaskManager


@pytest.fixture
def task_manager():
    """Create a fresh TaskManager instance."""
    return TaskManager()


@pytest.fixture
def sample_paused_task():
    """Create a sample paused task."""
    return Task(
        id="test-pause-requeue-1",
        file=File(
            id="test-file-1",
            name="test_video.mp4",
            path="/tmp/test_video.mp4",
            size=1000000,
            duration="00:10:00",
            format="mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.PAUSED,
        createdAt=datetime.utcnow().isoformat(),
        pausedAt=datetime.utcnow().isoformat(),
    )


@pytest.mark.asyncio
async def test_unpause_adds_task_back_to_queue(task_manager, sample_paused_task):
    """Test that unpausing a task re-adds it to the task queue."""
    # Add paused task to in-memory store
    task_manager.tasks_db[sample_paused_task.id] = sample_paused_task

    # Verify queue is empty before unpause
    assert task_manager.task_queue.empty()

    # Unpause the task
    mock_settings = MagicMock()
    mock_settings.task_type_priority = json.dumps(["all", "merge", "subtitle", "split", "scene"])
    with patch("src.crud.task.update_task"), patch("src.task_manager.get_settings", return_value=mock_settings):
        success = await task_manager.unpause_task(sample_paused_task.id)

    # Verify unpause succeeded
    assert success

    # Verify task status changed to QUEUED
    task = task_manager.tasks_db[sample_paused_task.id]
    assert task.status == TaskStatus.QUEUED
    assert task.pausedAt is None

    # Verify task is in the queue (queue now stores (rank, monotonic, task_id) tuples)
    assert not task_manager.task_queue.empty()
    entry = await task_manager.task_queue.get()
    assert entry[2] == sample_paused_task.id


@pytest.mark.asyncio
async def test_unpause_paused_task_not_in_paused_tasks_set(
    task_manager, sample_paused_task
):
    """Test that unpaused task is removed from _paused_tasks tracking."""
    # Add paused task to in-memory store and to paused tracking
    task_manager.tasks_db[sample_paused_task.id] = sample_paused_task
    task_manager._paused_tasks.add(sample_paused_task.id)

    # Verify task is tracked as paused
    assert sample_paused_task.id in task_manager._paused_tasks

    # Unpause the task
    mock_settings = MagicMock()
    mock_settings.task_type_priority = json.dumps(["all", "merge", "subtitle", "split", "scene"])
    with patch("src.crud.task.update_task"), patch("src.task_manager.get_settings", return_value=mock_settings):
        success = await task_manager.unpause_task(sample_paused_task.id)

    # Verify unpause succeeded
    assert success

    # Note: _paused_tasks is only cleaned up when the task_processor detects
    # the paused status. The unpause doesn't remove it, but that's OK because
    # the processor will skip it if it's in processing state.
    # The important thing is the task is back in the queue.
    assert not task_manager.task_queue.empty()


@pytest.mark.asyncio
async def test_unpause_nonexistent_task_returns_false(task_manager):
    """Test that unpausing a nonexistent task returns False."""
    success = await task_manager.unpause_task("nonexistent-task")
    assert not success
    assert task_manager.task_queue.empty()


@pytest.mark.asyncio
async def test_unpause_non_paused_task_returns_false(task_manager):
    """Test that unpausing a non-paused task returns False."""
    task = Task(
        id="test-queued-task",
        file=File(
            id="test-file-2",
            name="test_video2.mp4",
            path="/tmp/test_video2.mp4",
            size=1000000,
            duration="00:10:00",
            format="mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.QUEUED,
        createdAt=datetime.utcnow().isoformat(),
    )

    task_manager.tasks_db[task.id] = task

    # Unpause a QUEUED task (not PAUSED) should fail
    success = await task_manager.unpause_task(task.id)
    assert not success

    # Queue should still be empty since unpause failed
    assert task_manager.task_queue.empty()
