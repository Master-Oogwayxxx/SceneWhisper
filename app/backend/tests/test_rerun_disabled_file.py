"""Tests for queue_disabled validation on POST /api/tasks/add_video endpoint."""
from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.models.models import File, Task, TaskStatus, TaskType
from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base

# Import all schemas to register them with Base
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
    return TestClient(app)


@pytest.fixture()
def temp_video_file(tmp_path):
    """Create temporary video file for testing."""
    video_file = tmp_path / "test_video.mp4"
    video_file.write_bytes(b"fake video content")
    return str(video_file)


@pytest.fixture()
def disabled_file(tmp_path, isolated_db, temp_video_file):
    """Create a file record with queue_disabled=True."""
    from src.crud.file import File as FileCRUD
    from src.schemas.db_helper import SessionLocal
    from src.schemas.directory import DirectoryRecord

    db = SessionLocal()
    dir_record = DirectoryRecord(id="test-dir-1", name="testdir", path=str(tmp_path))
    db.add(dir_record)
    db.flush()

    crud = FileCRUD(db)
    record = crud.create_file_metadata(
        name="test_video.mp4",
        path=temp_video_file,
        size=18,
        file_type="video",
        format=".mp4",
        directory_id=dir_record.id,
    )
    db.commit()
    db.refresh(record)

    # Enable queue_disabled
    record.queue_disabled = True
    db.commit()
    db.refresh(record)

    file_id = record.id
    db.close()

    return file_id, temp_video_file


@pytest.fixture()
def enabled_file(tmp_path, isolated_db, temp_video_file):
    """Create a file record with queue_disabled=False (enabled for queue)."""
    from src.crud.file import File as FileCRUD
    from src.schemas.db_helper import SessionLocal
    from src.schemas.directory import DirectoryRecord

    # Use different video file name to avoid conflicts
    enabled_video = tmp_path / "enabled_video.mp4"
    enabled_video.write_bytes(b"fake video content")

    db = SessionLocal()
    dir_record = DirectoryRecord(id="test-dir-2", name="testdir", path=str(tmp_path))
    db.add(dir_record)
    db.flush()

    crud = FileCRUD(db)
    record = crud.create_file_metadata(
        name="enabled_video.mp4",
        path=str(enabled_video),
        size=18,
        file_type="video",
        format=".mp4",
        directory_id=dir_record.id,
    )
    db.commit()
    db.refresh(record)

    # Ensure queue_disabled is False
    record.queue_disabled = False
    db.commit()
    db.refresh(record)

    file_id = record.id
    db.close()

    return file_id, str(enabled_video)


def test_cannot_rerun_disabled_file(client, disabled_file):
    """Test: Cannot create task for disabled file (queue_disabled=True)."""
    file_id, file_path = disabled_file

    task_request = Task(
        id="test-task-1",
        file=File(
            id=file_id,
            name="test_video.mp4",
            path=file_path,
            size=18,
            duration="00:00:10",
            format=".mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.QUEUED,
        createdAt=datetime.utcnow().isoformat(),
    )

    response = client.post("/api/tasks/add_video", json=task_request.model_dump())

    # Expect 422 Unprocessable Entity
    assert response.status_code == 422
    # Verify error message contains "disabled for queue" (case-insensitive)
    error_detail = response.json()["detail"].lower()
    assert "disabled" in error_detail or "queue" in error_detail


def test_can_create_task_for_enabled_file(client, enabled_file):
    """Test: Can create task for enabled file (queue_disabled=False)."""
    file_id, file_path = enabled_file

    task_request = Task(
        id="test-task-2",
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

    response = client.post("/api/tasks/add_video", json=task_request.model_dump())

    # Expect success (200 or 201)
    assert response.status_code in [200, 201]
    # Verify response contains tasks in expected format
    data = response.json()
    assert "tasks" in data
    # Verify task was created
    assert len(data["tasks"]) > 0
    # Verify task ID is present
    assert data["tasks"][0].get("id") is not None


@pytest.mark.parametrize(
    "task_type",
    [TaskType.SCENE, TaskType.SPLIT, TaskType.SUBTITLE, TaskType.ALL],
    ids=["scene", "split", "subtitle", "all"],
)
def test_rerun_disabled_respects_all_task_types(client, disabled_file, task_type):
    """Test: All task types respect queue_disabled flag."""
    file_id, file_path = disabled_file

    task_request = Task(
        id=f"test-{task_type.value}-task",
        file=File(
            id=file_id,
            name="test_video.mp4",
            path=file_path,
            size=18,
            duration="00:00:10",
            format=".mp4",
        ),
        type=task_type,
        status=TaskStatus.QUEUED,
        createdAt=datetime.utcnow().isoformat(),
    )

    response = client.post("/api/tasks/add_video", json=task_request.model_dump())

    assert response.status_code == 422
    error_detail = response.json()["detail"].lower()
    assert "disabled" in error_detail or "queue" in error_detail


def test_rerun_scenario_disabled_after_failure(client, isolated_db, tmp_path):
    """Test: Rerun scenario - file disabled after failed task."""
    from src.crud.file import File as FileCRUD
    from src.crud.task import Task as TaskCRUD
    from src.schemas.db_helper import SessionLocal
    from src.schemas.directory import DirectoryRecord
    from src.schemas.task import TaskRecord

    video_file = tmp_path / "rerun_test.mp4"
    video_file.write_bytes(b"fake video")

    db = SessionLocal()
    dir_record = DirectoryRecord(id="test-dir-3", name="testdir", path=str(tmp_path))
    db.add(dir_record)
    db.flush()

    # Create file
    file_crud = FileCRUD(db)
    file_record = file_crud.create_file_metadata(
        name="rerun_test.mp4",
        path=str(video_file),
        size=10,
        file_type="video",
        format=".mp4",
        directory_id=dir_record.id,
    )

    # Create a failed task
    task_record = TaskRecord(
        id="failed-task-1",
        file_id=file_record.id,
        type="scene",
        status="failed",
        error="Scene detection failed",
        created_at=datetime.utcnow(),
    )
    db.add(task_record)
    db.commit()
    db.refresh(file_record)

    # Now disable the file
    file_record.queue_disabled = True
    db.commit()
    db.refresh(file_record)

    db.close()

    # Try to create a new task for the disabled file
    task_request = Task(
        id="rerun-attempt",
        file=File(
            id=file_record.id,
            name="rerun_test.mp4",
            path=str(video_file),
            size=10,
            duration="00:00:10",
            format=".mp4",
        ),
        type=TaskType.SCENE,
        status=TaskStatus.QUEUED,
        createdAt=datetime.utcnow().isoformat(),
    )

    response = client.post("/api/tasks/add_video", json=task_request.model_dump())

    # Should fail with 422 because file is disabled
    assert response.status_code == 422
    error_detail = response.json()["detail"].lower()
    assert "disabled" in error_detail or "queue" in error_detail
