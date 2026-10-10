"""Tests for global pause_all and unpause_all methods."""
import asyncio
import pytest
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.task_manager import TaskManager
from src.models.models import File, Task, TaskStatus, TaskType


@pytest.fixture
def task_manager():
    """Create a fresh TaskManager instance."""
    return TaskManager()


@pytest.fixture
def sample_queued_task():
    """Create a sample queued task."""
    return Task(
        id="task-queued-1",
        file=File(
            id="file-1",
            name="test_video.mp4",
            path="/tmp/test_video.mp4",
            size=1000000,
            duration="00:10:00",
            format="mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.QUEUED,
        createdAt=datetime.utcnow().isoformat(),
    )


@pytest.fixture
def sample_processing_task():
    """Create a sample processing task."""
    return Task(
        id="task-processing-1",
        file=File(
            id="file-2",
            name="test_video2.mp4",
            path="/tmp/test_video2.mp4",
            size=1000000,
            duration="00:10:00",
            format="mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.PROCESSING,
        startedAt=datetime.utcnow().isoformat(),
        createdAt=datetime.utcnow().isoformat(),
    )


def test_task_manager_has_global_pause_state(task_manager):
    """Test that TaskManager initializes global pause state."""
    assert hasattr(task_manager, 'is_globally_paused')
    assert task_manager.is_globally_paused is False
    assert hasattr(task_manager, '_globally_paused_task_ids')
    assert isinstance(task_manager._globally_paused_task_ids, set)
    assert len(task_manager._globally_paused_task_ids) == 0


@pytest.mark.asyncio
async def test_pause_all_sets_flag(task_manager, sample_queued_task):
    """Test that pause_all sets the is_globally_paused flag."""
    task_manager.tasks_db[sample_queued_task.id] = sample_queued_task

    with patch.object(task_manager, 'pause_task', new_callable=AsyncMock, return_value=True), \
         patch('src.task_manager.emit_notification', new_callable=AsyncMock):
        await task_manager.pause_all()

    assert task_manager.is_globally_paused is True


@pytest.mark.asyncio
async def test_unpause_all_clears_flag(task_manager):
    """Test that unpause_all clears the is_globally_paused flag."""
    task_manager.is_globally_paused = True
    task_manager._globally_paused_task_ids.add("task-1")
    task_manager._globally_paused_task_ids.add("task-2")

    with patch.object(task_manager, 'unpause_task', new_callable=AsyncMock, return_value=True), \
         patch('src.task_manager.emit_notification', new_callable=AsyncMock):
        await task_manager.unpause_all()

    assert task_manager.is_globally_paused is False
    assert len(task_manager._globally_paused_task_ids) == 0


@pytest.mark.asyncio
async def test_pause_all_pauses_queued_and_processing_tasks(task_manager, sample_queued_task, sample_processing_task):
    """Test that pause_all pauses both QUEUED and PROCESSING tasks."""
    task_manager.tasks_db[sample_queued_task.id] = sample_queued_task
    task_manager.tasks_db[sample_processing_task.id] = sample_processing_task

    paused_count = [0]

    async def mock_pause_task(task_id):
        paused_count[0] += 1
        return True

    with patch.object(task_manager, 'pause_task', side_effect=mock_pause_task), \
         patch('src.task_manager.emit_notification', new_callable=AsyncMock):
        await task_manager.pause_all()

    assert paused_count[0] == 2
    assert task_manager.is_globally_paused is True


@pytest.mark.asyncio
async def test_pause_all_tracks_paused_task_ids(task_manager, sample_queued_task, sample_processing_task):
    """Test that pause_all tracks paused task IDs."""
    task_manager.tasks_db[sample_queued_task.id] = sample_queued_task
    task_manager.tasks_db[sample_processing_task.id] = sample_processing_task

    with patch.object(task_manager, 'pause_task', new_callable=AsyncMock, return_value=True), \
         patch('src.task_manager.emit_notification', new_callable=AsyncMock):
        await task_manager.pause_all()

    assert sample_queued_task.id in task_manager._globally_paused_task_ids
    assert sample_processing_task.id in task_manager._globally_paused_task_ids


@pytest.mark.asyncio
async def test_pause_all_emits_notification(task_manager, sample_queued_task):
    """Test that pause_all emits a notification."""
    task_manager.tasks_db[sample_queued_task.id] = sample_queued_task

    with patch.object(task_manager, 'pause_task', new_callable=AsyncMock, return_value=True), \
         patch('src.task_manager.emit_notification', new_callable=AsyncMock) as mock_emit:
        await task_manager.pause_all()

    assert mock_emit.called
    # emit_notification is called with positional args: (type, title, message, ...)
    call_args = mock_emit.call_args
    title = call_args[0][1]  # Second positional arg
    assert "All Tasks Paused" in title


@pytest.mark.asyncio
async def test_unpause_all_unpauses_tracked_tasks(task_manager):
    """Test that unpause_all unpauses all tracked tasks."""
    task_manager.is_globally_paused = True
    task_id_1 = "task-paused-1"
    task_id_2 = "task-paused-2"
    task_manager._globally_paused_task_ids.add(task_id_1)
    task_manager._globally_paused_task_ids.add(task_id_2)

    unpaused_ids = []

    async def mock_unpause_task(task_id):
        unpaused_ids.append(task_id)
        return True

    with patch.object(task_manager, 'unpause_task', side_effect=mock_unpause_task), \
         patch('src.task_manager.emit_notification', new_callable=AsyncMock):
        await task_manager.unpause_all()

    assert task_id_1 in unpaused_ids
    assert task_id_2 in unpaused_ids
    assert task_manager.is_globally_paused is False
    assert len(task_manager._globally_paused_task_ids) == 0


@pytest.mark.asyncio
async def test_unpause_all_handles_nonexistent_tasks(task_manager):
    """Test that unpause_all silently skips nonexistent tasks."""
    task_manager.is_globally_paused = True
    task_manager._globally_paused_task_ids.add("nonexistent-task")

    call_count = [0]

    async def mock_unpause_task(task_id):
        call_count[0] += 1
        if task_id == "nonexistent-task":
            return False  # Simulate task not found
        return True

    with patch.object(task_manager, 'unpause_task', side_effect=mock_unpause_task), \
         patch('src.task_manager.emit_notification', new_callable=AsyncMock):
        await task_manager.unpause_all()

    # Should have attempted to unpause
    assert call_count[0] == 1
    # Should have cleared the set
    assert len(task_manager._globally_paused_task_ids) == 0
    assert task_manager.is_globally_paused is False


@pytest.mark.asyncio
async def test_unpause_all_emits_notification(task_manager):
    """Test that unpause_all emits a notification."""
    task_manager.is_globally_paused = True
    task_manager._globally_paused_task_ids.add("task-1")

    with patch.object(task_manager, 'unpause_task', new_callable=AsyncMock, return_value=True), \
         patch('src.task_manager.emit_notification', new_callable=AsyncMock) as mock_emit:
        await task_manager.unpause_all()

    assert mock_emit.called
    # emit_notification is called with positional args: (type, title, message, ...)
    call_args = mock_emit.call_args
    title = call_args[0][1]  # Second positional arg
    assert "All Tasks Resumed" in title
