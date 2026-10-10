import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    yield


@pytest.fixture()
def client(isolated_db):
    import importlib
    import src.api.file as file_mod
    importlib.reload(file_mod)
    app = FastAPI()
    app.include_router(file_mod.router)
    return TestClient(app)


@pytest.fixture()
def video_file(tmp_path, isolated_db):
    from src.crud.file import File as FileCRUD
    from src.schemas.db_helper import SessionLocal
    from src.schemas.directory import DirectoryRecord

    f = tmp_path / "movie.mp4"
    f.write_bytes(b"fake video")

    db = SessionLocal()
    dir_record = DirectoryRecord(id="test-dir-1", name="testdir", path=str(tmp_path))
    db.add(dir_record)
    db.flush()

    crud = FileCRUD(db)
    record = crud.create_file_metadata(
        name="movie.mp4",
        path=str(f),
        size=f.stat().st_size,
        file_type="video",
        format=".mp4",
        directory_id=dir_record.id,
    )
    db.commit()
    db.refresh(record)
    file_id = record.id
    db.close()
    return file_id


def test_toggle_queue_disabled_enables(client, video_file):
    """First toggle sets queue_disabled=True."""
    res = client.patch(f"/api/files/{video_file}/queue-disabled")
    assert res.status_code == 200
    assert res.json()["queue_disabled"] is True


def test_toggle_queue_disabled_disables(client, video_file):
    """Second toggle sets queue_disabled=False."""
    client.patch(f"/api/files/{video_file}/queue-disabled")
    res = client.patch(f"/api/files/{video_file}/queue-disabled")
    assert res.status_code == 200
    assert res.json()["queue_disabled"] is False


def test_toggle_queue_disabled_404(client):
    """Unknown file_id returns 404."""
    res = client.patch("/api/files/nonexistent/queue-disabled")
    assert res.status_code == 404


def test_get_task_ids_by_file_and_statuses(isolated_db):
    from src.crud.task import get_task_ids_by_file_and_statuses
    from src.schemas.db_helper import SessionLocal
    from src.schemas.task import TaskRecord

    db = SessionLocal()
    db.add(TaskRecord(id="t1", file_id="f1", status="queued", type="scene"))
    db.add(TaskRecord(id="t2", file_id="f1", status="processing", type="scene"))
    db.add(TaskRecord(id="t3", file_id="f1", status="completed", type="scene"))
    db.add(TaskRecord(id="t4", file_id="f2", status="queued", type="scene"))
    db.commit()
    db.close()

    result = get_task_ids_by_file_and_statuses("f1", ["queued", "processing"])
    assert sorted(result) == ["t1", "t2"]


@pytest.fixture()
def queued_task(video_file, isolated_db):
    """Insert a queued task for the video_file."""
    from src.schemas.db_helper import SessionLocal
    from src.schemas.task import TaskRecord
    db = SessionLocal()
    db.add(TaskRecord(id="task-q1", file_id=video_file, status="queued", type="scene"))
    db.commit()
    db.close()
    return "task-q1"


def test_disable_queue_deletes_queued_tasks(client, video_file, queued_task):
    """Disabling queue removes queued tasks from DB."""
    from src.schemas.db_helper import SessionLocal
    from src.schemas.task import TaskRecord

    res = client.patch(f"/api/files/{video_file}/queue-disabled")
    assert res.status_code == 200
    assert res.json()["queue_disabled"] is True

    db = SessionLocal()
    remaining = db.query(TaskRecord).filter(TaskRecord.id == queued_task).first()
    db.close()
    assert remaining is None


def test_enable_queue_does_not_delete_tasks(client, video_file, queued_task):
    """Re-enabling queue does NOT delete tasks."""
    from src.schemas.db_helper import SessionLocal
    from src.schemas.task import TaskRecord

    # Disable first
    client.patch(f"/api/files/{video_file}/queue-disabled")
    # Re-add a task (simulating tasks created after re-enable)
    db = SessionLocal()
    db.add(TaskRecord(id="task-q2", file_id=video_file, status="queued", type="scene"))
    db.commit()
    db.close()

    # Re-enable
    res = client.patch(f"/api/files/{video_file}/queue-disabled")
    assert res.status_code == 200
    assert res.json()["queue_disabled"] is False

    db = SessionLocal()
    remaining = db.query(TaskRecord).filter(TaskRecord.id == "task-q2").first()
    db.close()
    assert remaining is not None
