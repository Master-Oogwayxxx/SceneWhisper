"""Tests for POST /api/tasks/{id}/pause endpoint."""
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app
from src.models.models import File, Task, TaskStatus, TaskType
from src.api.tasks import task_manager


@pytest.fixture
def client():
    """Return a TestClient."""
    return TestClient(app)


@pytest.fixture
def sample_task():
    """Create a sample queued task."""
    return Task(
        id="test-task-1",
        file=File(
            id="test-file-1",
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
def processing_task():
    """Create a sample processing task."""
    return Task(
        id="test-task-2",
        file=File(
            id="test-file-2",
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


@pytest.fixture
def completed_task():
    """Create a sample completed task."""
    return Task(
        id="test-task-3",
        file=File(
            id="test-file-3",
            name="test_video3.mp4",
            path="/tmp/test_video3.mp4",
            size=1000000,
            duration="00:10:00",
            format="mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.COMPLETED,
        startedAt=datetime.utcnow().isoformat(),
        completedAt=datetime.utcnow().isoformat(),
        createdAt=datetime.utcnow().isoformat(),
    )


@pytest.fixture
def paused_task():
    """Create a sample paused task."""
    return Task(
        id="test-task-paused",
        file=File(
            id="test-file-paused",
            name="test_video_paused.mp4",
            path="/tmp/test_video_paused.mp4",
            size=1000000,
            duration="00:10:00",
            format="mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.PAUSED,
        createdAt=datetime.utcnow().isoformat(),
        pausedAt=datetime.utcnow().isoformat(),
    )


def test_pause_queued_task(client, sample_task):
    """Test pausing a queued task"""
    # Create a mock that returns the task before pause, and paused task after
    def get_task_side_effect(task_id):
        if task_id == sample_task.id:
            return sample_task
        return None

    # Pause the task before the second get_task call
    paused_task = Task(
        id=sample_task.id,
        file=sample_task.file,
        type=sample_task.type,
        status=TaskStatus.PAUSED,
        createdAt=sample_task.createdAt,
        pausedAt=datetime.utcnow().isoformat(),
    )

    with patch.object(task_manager, 'pause_task', return_value=True):
        # First call returns the original queued task, second returns paused task
        with patch.object(task_manager, 'get_task', side_effect=[sample_task, paused_task]):
            response = client.post(f"/api/tasks/{sample_task.id}/pause")

    assert response.status_code == 200
    data = response.json()
    assert data["task"]["status"] == "paused"
    assert data["task"]["pausedAt"] is not None


def test_pause_processing_task(client, processing_task):
    """Test pausing a processing task"""
    # Create a paused version of the processing task
    paused_task = Task(
        id=processing_task.id,
        file=processing_task.file,
        type=processing_task.type,
        status=TaskStatus.PAUSED,
        startedAt=processing_task.startedAt,
        createdAt=processing_task.createdAt,
        pausedAt=datetime.utcnow().isoformat(),
    )

    with patch.object(task_manager, 'pause_task', return_value=True):
        # First call returns the original processing task, second returns paused task
        with patch.object(task_manager, 'get_task', side_effect=[processing_task, paused_task]):
            response = client.post(f"/api/tasks/{processing_task.id}/pause")

    assert response.status_code == 200
    data = response.json()
    assert data["task"]["status"] == "paused"


def test_pause_completed_task_returns_400(client, completed_task):
    """Test that pausing a completed task returns 400"""
    with patch.object(task_manager, 'get_task', return_value=completed_task), \
         patch.object(task_manager, 'pause_task', return_value=False):
        response = client.post(f"/api/tasks/{completed_task.id}/pause")

    assert response.status_code == 400
    assert "Cannot pause" in response.json()["detail"]


def test_pause_nonexistent_task_returns_404(client):
    """Test that pausing nonexistent task returns 404"""
    with patch.object(task_manager, 'get_task', return_value=None):
        response = client.post("/api/tasks/nonexistent/pause")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_unpause_paused_task(client, paused_task):
    """Test unpausing a paused task"""
    # Create an unpaused version of the task (queued)
    unpaused_task = Task(
        id=paused_task.id,
        file=paused_task.file,
        type=paused_task.type,
        status=TaskStatus.QUEUED,
        createdAt=paused_task.createdAt,
        pausedAt=None,
    )

    with patch.object(task_manager, 'unpause_task', return_value=True):
        # First call returns the paused task, second returns unpaused task
        with patch.object(task_manager, 'get_task', side_effect=[paused_task, unpaused_task]):
            response = client.post(f"/api/tasks/{paused_task.id}/unpause")

    assert response.status_code == 200
    data = response.json()
    assert data["task"]["status"] == "queued"
    assert data["task"]["pausedAt"] is None


def test_unpause_queued_task_returns_400(client, sample_task):
    """Test that unpausing a queued task returns 400"""
    with patch.object(task_manager, 'get_task', return_value=sample_task):
        response = client.post(f"/api/tasks/{sample_task.id}/unpause")

    assert response.status_code == 400
    assert "Cannot unpause" in response.json()["detail"]


def test_unpause_nonexistent_task_returns_404(client):
    """Test that unpausing nonexistent task returns 404"""
    with patch.object(task_manager, 'get_task', return_value=None):
        response = client.post("/api/tasks/nonexistent/unpause")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_pause_task_emits_notification(sample_task):
    """Test that pause_task_endpoint emits TASK_PAUSED notification on success"""
    from src.notification_service import emit_notification
    from src.models.notification import NotificationType

    # Create a paused version of the task
    paused_task = Task(
        id=sample_task.id,
        file=sample_task.file,
        type=sample_task.type,
        status=TaskStatus.PAUSED,
        createdAt=sample_task.createdAt,
        pausedAt=datetime.utcnow().isoformat(),
        currentStage=None,
    )

    with patch.object(task_manager, 'pause_task', return_value=True), \
         patch.object(task_manager, 'get_task', side_effect=[sample_task, paused_task]), \
         patch('src.api.tasks.emit_notification', new_callable=AsyncMock) as mock_emit:

        # Import and call the endpoint directly
        from src.api.tasks import pause_task_endpoint
        result = await pause_task_endpoint(sample_task.id)

        # Verify notification was emitted
        assert mock_emit.called
        call_args = mock_emit.call_args
        assert call_args[1]['type'] == NotificationType.TASK_PAUSED
        assert call_args[1]['task_id'] == sample_task.id
        assert call_args[1]['file_id'] == sample_task.file.id
        assert "paused" in call_args[1]['title'].lower()
        assert result["task"].status == TaskStatus.PAUSED


@pytest.mark.asyncio
async def test_pause_task_notification_handles_null_stage(sample_task):
    """Test that pause notification handles null currentStage gracefully"""
    from src.notification_service import emit_notification

    # Create a paused task with null currentStage
    paused_task = Task(
        id=sample_task.id,
        file=sample_task.file,
        type=sample_task.type,
        status=TaskStatus.PAUSED,
        createdAt=sample_task.createdAt,
        pausedAt=datetime.utcnow().isoformat(),
        currentStage=None,  # null stage
    )

    with patch.object(task_manager, 'pause_task', return_value=True), \
         patch.object(task_manager, 'get_task', side_effect=[sample_task, paused_task]), \
         patch('src.api.tasks.emit_notification', new_callable=AsyncMock) as mock_emit:

        from src.api.tasks import pause_task_endpoint
        result = await pause_task_endpoint(sample_task.id)

        # Verify notification was emitted with fallback stage text
        assert mock_emit.called
        call_args = mock_emit.call_args
        assert call_args[1]['message'] == "Unknown stage"
        assert result["task"].status == TaskStatus.PAUSED


@pytest.mark.asyncio
async def test_pause_task_notification_handles_null_file(sample_task):
    """Test that pause notification handles null file gracefully"""
    from src.notification_service import emit_notification

    # Create task without file (queued first, then paused after pause_task call)
    queued_task_no_file = Task(
        id=sample_task.id,
        file=None,
        type=sample_task.type,
        status=TaskStatus.QUEUED,
        createdAt=sample_task.createdAt,
        currentStage=None,
    )

    paused_task_no_file = Task(
        id=sample_task.id,
        file=None,
        type=sample_task.type,
        status=TaskStatus.PAUSED,
        createdAt=sample_task.createdAt,
        pausedAt=datetime.utcnow().isoformat(),
        currentStage=None,
    )

    with patch.object(task_manager, 'pause_task', return_value=True), \
         patch.object(task_manager, 'get_task', side_effect=[queued_task_no_file, paused_task_no_file]), \
         patch('src.api.tasks.emit_notification', new_callable=AsyncMock) as mock_emit:

        from src.api.tasks import pause_task_endpoint
        result = await pause_task_endpoint(sample_task.id)

        # Verify notification was emitted with fallback file name and None file_id
        assert mock_emit.called
        call_args = mock_emit.call_args
        assert "Unknown" in call_args[1]['title']
        assert call_args[1]['file_id'] is None
        assert result["task"].status == TaskStatus.PAUSED


@pytest.mark.asyncio
async def test_pause_task_no_notification_on_failure(sample_task):
    """Test that notification is NOT emitted if pause fails"""
    from src.notification_service import emit_notification

    with patch.object(task_manager, 'pause_task', return_value=False), \
         patch.object(task_manager, 'get_task', return_value=sample_task), \
         patch('src.api.tasks.emit_notification', new_callable=AsyncMock) as mock_emit:

        from src.api.tasks import pause_task_endpoint

        # Should raise HTTPException
        with pytest.raises(HTTPException):
            await pause_task_endpoint(sample_task.id)

        # Verify notification was NOT emitted on failure
        assert not mock_emit.called


@pytest.mark.asyncio
async def test_unpause_task_emits_notification(paused_task):
    """Test that unpause_task_endpoint emits TASK_UNPAUSED notification on success"""
    from src.notification_service import emit_notification
    from src.models.notification import NotificationType

    # Create an unpaused version of the task
    unpaused_task = Task(
        id=paused_task.id,
        file=paused_task.file,
        type=paused_task.type,
        status=TaskStatus.QUEUED,
        createdAt=paused_task.createdAt,
        pausedAt=None,
        currentStage=None,
    )

    with patch.object(task_manager, 'unpause_task', return_value=True), \
         patch.object(task_manager, 'get_task', side_effect=[paused_task, unpaused_task]), \
         patch('src.api.tasks.emit_notification', new_callable=AsyncMock) as mock_emit:

        # Import and call the endpoint directly
        from src.api.tasks import unpause_task_endpoint
        result = await unpause_task_endpoint(paused_task.id)

        # Verify notification was emitted
        assert mock_emit.called
        call_args = mock_emit.call_args
        assert call_args[1]['type'] == NotificationType.TASK_UNPAUSED
        assert call_args[1]['task_id'] == paused_task.id
        assert call_args[1]['file_id'] == paused_task.file.id
        assert "resumed" in call_args[1]['title'].lower()
        assert "Back to" in call_args[1]['message']
        assert result["task"].status == TaskStatus.QUEUED


@pytest.mark.asyncio
async def test_unpause_task_notification_handles_null_stage(paused_task):
    """Test that unpause notification handles null currentStage gracefully"""
    from src.notification_service import emit_notification

    # Create an unpaused task with null currentStage
    unpaused_task = Task(
        id=paused_task.id,
        file=paused_task.file,
        type=paused_task.type,
        status=TaskStatus.QUEUED,
        createdAt=paused_task.createdAt,
        pausedAt=None,
        currentStage=None,  # null stage
    )

    with patch.object(task_manager, 'unpause_task', return_value=True), \
         patch.object(task_manager, 'get_task', side_effect=[paused_task, unpaused_task]), \
         patch('src.api.tasks.emit_notification', new_callable=AsyncMock) as mock_emit:

        from src.api.tasks import unpause_task_endpoint
        result = await unpause_task_endpoint(paused_task.id)

        # Verify notification was emitted with fallback stage text
        assert mock_emit.called
        call_args = mock_emit.call_args
        assert call_args[1]['message'] == "Back to Ready to process"
        assert result["task"].status == TaskStatus.QUEUED


@pytest.mark.asyncio
async def test_unpause_task_notification_handles_null_file(paused_task):
    """Test that unpause notification handles null file gracefully"""
    from src.notification_service import emit_notification

    # Create task without file (paused first, then unpaused after unpause_task call)
    paused_task_no_file = Task(
        id=paused_task.id,
        file=None,
        type=paused_task.type,
        status=TaskStatus.PAUSED,
        createdAt=paused_task.createdAt,
        pausedAt=paused_task.pausedAt,
        currentStage=None,
    )

    unpaused_task_no_file = Task(
        id=paused_task.id,
        file=None,
        type=paused_task.type,
        status=TaskStatus.QUEUED,
        createdAt=paused_task.createdAt,
        pausedAt=None,
        currentStage=None,
    )

    with patch.object(task_manager, 'unpause_task', return_value=True), \
         patch.object(task_manager, 'get_task', side_effect=[paused_task_no_file, unpaused_task_no_file]), \
         patch('src.api.tasks.emit_notification', new_callable=AsyncMock) as mock_emit:

        from src.api.tasks import unpause_task_endpoint
        result = await unpause_task_endpoint(paused_task.id)

        # Verify notification was emitted with fallback file name and None file_id
        assert mock_emit.called
        call_args = mock_emit.call_args
        assert "Unknown" in call_args[1]['title']
        assert call_args[1]['file_id'] is None
        assert result["task"].status == TaskStatus.QUEUED


@pytest.mark.asyncio
async def test_unpause_task_no_notification_on_failure(paused_task):
    """Test that notification is NOT emitted if unpause fails"""
    from src.notification_service import emit_notification

    with patch.object(task_manager, 'unpause_task', return_value=False), \
         patch.object(task_manager, 'get_task', return_value=paused_task), \
         patch('src.api.tasks.emit_notification', new_callable=AsyncMock) as mock_emit:

        from src.api.tasks import unpause_task_endpoint

        # Should raise HTTPException
        with pytest.raises(HTTPException):
            await unpause_task_endpoint(paused_task.id)

        # Verify notification was NOT emitted on failure
        assert not mock_emit.called
