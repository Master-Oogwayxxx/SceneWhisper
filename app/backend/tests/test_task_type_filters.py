from datetime import datetime

import pytest
import sqlalchemy

import src.schemas.db_helper as dbh
from src.crud.task import get_tasks_paginated
from src.models.models import TaskStatus, TaskType
from src.schemas.db_helper import Base
from src.schemas.file import FileRecord
from src.schemas.task import TaskRecord


@pytest.fixture()
def isolated_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = sqlalchemy.create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sqlalchemy.orm.sessionmaker(autocommit=False, autoflush=False, bind=engine))
    yield


def _file(file_id: str, name: str) -> FileRecord:
    return FileRecord(
        id=file_id,
        name=name,
        path=f"/videos/{name}",
        size=1000,
        created_at=datetime(2026, 1, 1),
        modified_at=datetime(2026, 1, 1),
        format=".mp4",
        duration="00:01:00",
        file_type="video",
        status="unprocessed",
        directory_id="dir-1",
        queue_disabled=False,
        split_disabled=False,
        subtitle_disabled=False,
        is_deleted=False,
    )


def _task(task_id: str, file_id: str, task_type: TaskType) -> TaskRecord:
    return TaskRecord(
        id=task_id,
        file_id=file_id,
        type=task_type,
        status=TaskStatus.COMPLETED,
        created_at=datetime(2026, 1, 1),
    )


def test_all_processing_task_type_filter_matches_only_all_tasks(isolated_db):
    db = dbh.SessionLocal()
    db.add_all([
        _file("file-all", "all.mp4"),
        _file("file-scene", "scene.mp4"),
        _task("task-all", "file-all", TaskType.ALL),
        _task("task-scene", "file-scene", TaskType.SCENE),
    ])
    db.commit()
    db.close()

    tasks, total = get_tasks_paginated(task_types=[TaskType.ALL])

    assert total == 1
    assert [task.id for task in tasks] == ["task-all"]


def test_stage_task_type_filter_includes_all_processing_tasks(isolated_db):
    db = dbh.SessionLocal()
    db.add_all([
        _file("file-all", "all.mp4"),
        _file("file-split", "split.mp4"),
        _file("file-subtitle", "subtitle.mp4"),
        _task("task-all", "file-all", TaskType.ALL),
        _task("task-split", "file-split", TaskType.SPLIT),
        _task("task-subtitle", "file-subtitle", TaskType.SUBTITLE),
    ])
    db.commit()
    db.close()

    tasks, total = get_tasks_paginated(task_types=[TaskType.SPLIT])

    assert total == 2
    assert {task.id for task in tasks} == {"task-all", "task-split"}
