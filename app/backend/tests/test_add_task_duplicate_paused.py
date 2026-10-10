"""Tests for duplicate-task detection when creating tasks for paused files."""
import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.crud.task import create_task, get_task
from src.models.models import File, Task, TaskStatus, TaskType
from src.models.notification import NotificationType
from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base

import src.schemas.directory  # noqa: F401
import src.schemas.directory_monitor  # noqa: F401
import src.schemas.file  # noqa: F401
import src.schemas.log  # noqa: F401
import src.schemas.notification  # noqa: F401
import src.schemas.scene  # noqa: F401
import src.schemas.setting  # noqa: F401
import src.schemas.task  # noqa: F401


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Create isolated test database for each test."""
    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)

    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(
        dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine)
    )
    yield


@pytest.fixture()
def client(isolated_db):
    """Create test client with tasks API router."""
    import importlib

    import src.api.tasks as tasks_mod

    importlib.reload(tasks_mod)
    app = FastAPI()
    app.include_router(tasks_mod.router)
    return TestClient(app), tasks_mod.task_manager


@pytest.fixture()
def enabled_file(tmp_path, isolated_db):
    """Create a file record enabled for queue processing."""
    from src.crud.file import File as FileCRUD
    from src.schemas.db_helper import SessionLocal
    from src.schemas.directory import DirectoryRecord

    video_path = tmp_path / "enabled_video.mp4"
    video_path.write_bytes(b"fake video content")

    db = SessionLocal()
    dir_record = DirectoryRecord(id="test-dir-1", name="testdir", path=str(tmp_path))
    db.add(dir_record)
    db.flush()

    crud = FileCRUD(db)
    record = crud.create_file_metadata(
        name="enabled_video.mp4",
        path=str(video_path),
        size=18,
        file_type="video",
        format=".mp4",
        directory_id=dir_record.id,
    )
    db.commit()
    db.refresh(record)
    file_id = record.id
    db.close()

    return file_id, str(video_path)


def _build_task_request(file_id: str, file_path: str, task_id: str = "new-task-id") -> Task:
    """Build a queued task request payload for add_video."""
    return Task(
        id=task_id,
        file=File(
            id=file_id,
            name="enabled_video.mp4",
            path=file_path,
            size=18,
            duration="00:00:10",
            format=".mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.QUEUED,
        createdAt=datetime.utcnow().isoformat(),
    )


def test_add_video_reports_existing_paused_task(client, enabled_file):
    """Creating a task for a file with a paused task returns duplicate metadata."""
    test_client, _ = client
    file_id, file_path = enabled_file

    paused_task = Task(
        id="paused-task-1",
        file=File(
            id=file_id,
            name="enabled_video.mp4",
            path=file_path,
            size=18,
            duration="00:00:10",
            format=".mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.PAUSED,
        pausedAt=datetime.utcnow().isoformat(),
        createdAt=datetime.utcnow().isoformat(),
    )
    create_task(paused_task)

    response = test_client.post(
        "/api/tasks/add_video",
        json=_build_task_request(file_id, file_path).model_dump(),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["duplicate"] is True
    assert data["existing_status"] == "paused"
    assert data["tasks"][0]["id"] == "paused-task-1"
    assert "paused task already exists" in data["message"].lower()


def test_add_video_reports_empty_file_without_queueing(client, enabled_file):
    """POST /tasks/add_video reports empty files without returning a queued task."""
    test_client, manager = client
    file_id, file_path = enabled_file
    payload = _build_task_request(file_id, file_path, task_id="empty-api-task")
    payload.file.size = 0

    response = test_client.post(
        "/api/tasks/add_video",
        json=payload.model_dump(),
    )

    assert response.status_code == 200
    data = response.json()
    assert data["duplicate"] is False
    assert data["empty_file"] is True
    assert data["tasks"] == []
    assert "empty" in data["message"].lower()
    assert manager.task_queue.qsize() == 0


@pytest.mark.asyncio
async def test_add_task_emits_notification_for_paused_duplicate(enabled_file):
    """TaskManager.add_task emits TASK_ALREADY_EXISTS for paused duplicates."""
    import importlib

    import src.task_manager as task_manager_mod

    importlib.reload(task_manager_mod)
    manager = task_manager_mod.TaskManager()

    file_id, file_path = enabled_file
    paused_task = Task(
        id="paused-task-2",
        file=File(
            id=file_id,
            name="enabled_video.mp4",
            path=file_path,
            size=18,
            duration="00:00:10",
            format=".mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.PAUSED,
        pausedAt=datetime.utcnow().isoformat(),
        createdAt=datetime.utcnow().isoformat(),
    )
    create_task(paused_task)

    duplicate_request = Task(
        id="phantom-task-id",
        file=paused_task.file,
        type=TaskType.SCENE,
        status=TaskStatus.QUEUED,
        createdAt=datetime.utcnow().isoformat(),
    )

    with patch(
        "src.task_manager.emit_notification",
        new_callable=AsyncMock,
    ) as mock_emit:
        queued, existing = await manager.add_task(duplicate_request)
        if manager._pending_notifications:
            await asyncio.gather(*manager._pending_notifications)

    assert queued is False
    assert existing is not None
    assert existing.id == "paused-task-2"
    mock_emit.assert_called_once()
    assert mock_emit.call_args.args[0] == NotificationType.TASK_ALREADY_EXISTS


@pytest.mark.asyncio
async def test_add_task_skips_empty_file_and_emits_notification(enabled_file):
    """TaskManager.add_task rejects empty files before creating a task record."""
    import importlib

    import src.task_manager as task_manager_mod

    importlib.reload(task_manager_mod)
    manager = task_manager_mod.TaskManager()

    file_id, file_path = enabled_file
    empty_task = Task(
        id="empty-file-task",
        file=File(
            id=file_id,
            name="enabled_video.mp4",
            path=file_path,
            size=0,
            duration="00:00:10",
            format=".mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.QUEUED,
        createdAt=datetime.utcnow().isoformat(),
    )

    with patch(
        "src.task_manager.emit_notification",
        new_callable=AsyncMock,
    ) as mock_emit:
        queued, existing = await manager.add_task(empty_task)
        if manager._pending_notifications:
            await asyncio.gather(*manager._pending_notifications)

    assert queued is False
    assert existing is None
    assert get_task("empty-file-task") is None
    assert "empty-file-task" not in manager.tasks_db
    assert manager.task_queue.qsize() == 0
    mock_emit.assert_called_once()
    assert mock_emit.call_args.args[0] == NotificationType.TASK_FAILED
    assert mock_emit.call_args.args[1] == "Empty file not queued"
