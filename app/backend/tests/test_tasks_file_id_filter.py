"""Tests for file_id filter on GET /tasks."""
import sys
from pathlib import Path
from datetime import datetime
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app
from src.models.models import File, Task, TaskStatus, TaskType


@pytest.fixture
def client():
    return TestClient(app)


def _make_task(task_id: str, file_id: str, file_name: str) -> Task:
    return Task(
        id=task_id,
        file=File(
            id=file_id,
            name=file_name,
            path=f"/tmp/{file_name}",
            size=1000000,
            duration="00:10:00",
            format="mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.COMPLETED,
        createdAt=datetime.utcnow().isoformat(),
    )


def test_get_tasks_filters_by_file_id(client):
    """GET /tasks?file_id=X returns only tasks for that file."""
    task_a = _make_task("t1", "file-aaa", "video_a.mp4")

    with patch("src.api.tasks.get_tasks_paginated", return_value=([task_a], 1)) as mock_fn:
        response = client.get("/api/tasks?file_id=file-aaa")

    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert data["tasks"][0]["id"] == "t1"
    mock_fn.assert_called_once_with(0, 20, None, "file-aaa", None, None, None, None, None, False)


def test_get_tasks_with_status_and_file_id(client):
    """GET /tasks?status=completed&file_id=X routes to status-filtered path."""
    task_a = _make_task("t1", "file-aaa", "video_a.mp4")

    with patch("src.api.tasks.get_tasks_by_status_paginated", return_value=([task_a], 1)) as mock_fn:
        response = client.get("/api/tasks?status=completed&file_id=file-aaa")

    assert response.status_code == 200
    mock_fn.assert_called_once_with(TaskStatus.COMPLETED, 0, 20, None, "file-aaa", None, None, None, None, None, False)


def test_get_tasks_no_file_id_passes_none(client):
    """GET /tasks without file_id passes None to CRUD."""
    with patch("src.api.tasks.get_tasks_paginated", return_value=([], 0)) as mock_fn:
        response = client.get("/api/tasks")

    assert response.status_code == 200
    mock_fn.assert_called_once_with(0, 20, None, None, None, None, None, None, None, False)
