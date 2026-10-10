import os
import pytest
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
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(file_mod.router)
    return TestClient(app)


@pytest.fixture()
def video_file(tmp_path, isolated_db):
    """Create a real file on disk and a DB record for it."""
    from src.crud.file import File as FileCRUD
    from src.schemas.db_helper import SessionLocal
    from src.schemas.directory import DirectoryRecord

    f = tmp_path / "movie.mp4"
    f.write_bytes(b"fake video content")

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
        duration=None,
        format=".mp4",
        directory_id=dir_record.id,
    )
    db.commit()
    db.refresh(record)
    file_id = record.id
    db.close()
    return {"id": file_id, "path": str(f), "dir": str(tmp_path)}


def test_rename_file_success(client, video_file):
    res = client.patch(f"/api/files/{video_file['id']}/rename", json={"new_name": "film.mp4"})
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "film.mp4"
    assert data["id"] == video_file["id"]
    new_path = os.path.join(video_file["dir"], "film.mp4")
    assert os.path.exists(new_path)
    assert not os.path.exists(video_file["path"])

    fetch_res = client.get(f"/api/files/{video_file['id']}")
    assert fetch_res.status_code == 200
    assert fetch_res.json()["name"] == "film.mp4"


def test_rename_file_keeps_related_records_connected(client, video_file, tmp_path):
    from src.models.models import TaskStatus, TaskType
    from src.schemas.db_helper import SessionLocal
    from src.schemas.file import FileRecord
    from src.schemas.notification import NotificationRecord
    from src.schemas.scene import SceneRecord
    from src.schemas.task import TaskRecord

    db = SessionLocal()
    child = FileRecord(
        id="child-1",
        name="movie-001.mp4",
        path=str(tmp_path / "movie-001.mp4"),
        size=1,
        file_type="video",
        format=".mp4",
        directory_id="test-dir-1",
        parent_id=video_file["id"],
    )
    parent = db.query(FileRecord).filter(FileRecord.id == video_file["id"]).first()
    parent.child_ids = "child-1"
    db.add(child)
    db.add(TaskRecord(id="task-1", file_id=video_file["id"], type=TaskType.SCENE, status=TaskStatus.QUEUED))
    db.add(
        SceneRecord(
            id="scene-1",
            file_id=video_file["id"],
            scene_number=1,
            start_frame=0,
            end_frame=24,
            start_timecode="00:00:00.000",
            end_timecode="00:00:01.000",
            start_seconds=0,
            end_seconds=1,
            duration_seconds=1,
        )
    )
    db.add(NotificationRecord(id="notification-1", type="info", title="Title", message="Message", file_id=video_file["id"]))
    db.commit()
    db.close()

    res = client.patch(f"/api/files/{video_file['id']}/rename", json={"new_name": "film.mp4"})
    assert res.status_code == 200
    file_id = res.json()["id"]

    db = SessionLocal()
    try:
        assert file_id == video_file["id"]
        assert db.query(FileRecord).filter(FileRecord.id == "child-1").one().parent_id == file_id
        assert db.query(TaskRecord).filter(TaskRecord.id == "task-1").one().file_id == file_id
        assert db.query(SceneRecord).filter(SceneRecord.id == "scene-1").one().file_id == file_id
        assert db.query(NotificationRecord).filter(NotificationRecord.id == "notification-1").one().file_id == file_id
    finally:
        db.close()


def test_rename_file_not_found(client):
    res = client.patch("/api/files/nonexistent/rename", json={"new_name": "film.mp4"})
    assert res.status_code == 404


def test_rename_reuses_deleted_file_path(client, video_file, tmp_path):
    from src.crud.file import File as FileCRUD
    from src.schemas.actress_work_file_state import ActressWorkFileStateRecord
    from src.schemas.deleted_file import DeletedFileRecord

    destination = tmp_path / "film.mp4"
    destination.write_bytes(b"deleted video")
    with dbh.SessionLocal() as db:
        deleted = FileCRUD(db).create_file_metadata(
            name=destination.name, path=str(destination), size=13,
            file_type="video", format=".mp4", directory_id="test-dir-1",
        )
        db.commit()
        deleted_id = deleted.id

    assert client.delete(f"/api/files/{deleted_id}").status_code == 200
    assert not destination.exists()
    res = client.patch(f"/api/files/{video_file['id']}/rename", json={"new_name": destination.name})
    assert res.status_code == 200, res.text
    assert res.json()["id"] == video_file["id"]
    assert destination.read_bytes() == b"fake video content"
    assert not os.path.exists(video_file["path"])
    with dbh.SessionLocal() as db:
        state = db.get(ActressWorkFileStateRecord, str(destination))
        assert state.status == "present"
        assert state.file_record_id == video_file["id"]
        assert state.file_name == destination.name
        assert state.deleted_at is None
        assert db.get(ActressWorkFileStateRecord, video_file["path"]) is None
        history = db.query(DeletedFileRecord).filter_by(file_record_id=deleted_id).one()
        assert history.path == str(destination)


def test_rename_reuses_soft_deleted_file_path(client, video_file, tmp_path):
    from src.crud.deleted_file import record_deleted_file
    from src.crud.file import File as FileCRUD
    from src.schemas.deleted_file import DeletedFileRecord
    from src.schemas.file import FileRecord

    destination = tmp_path / "film.mp4"
    destination.write_bytes(b"deleted video")
    with dbh.SessionLocal() as db:
        deleted = FileCRUD(db).create_file_metadata(
            name=destination.name, path=str(destination), size=13,
            file_type="video", format=".mp4", directory_id="test-dir-1",
        )
        deleted_id = deleted.id
        record_deleted_file(db, deleted, reason="delete_video_after_completion", source="task_manager")
        deleted.is_deleted = True
        db.commit()
    destination.unlink()

    res = client.patch(f"/api/files/{video_file['id']}/rename", json={"new_name": destination.name})

    assert res.status_code == 200, res.text
    assert res.json()["id"] == video_file["id"]
    assert destination.read_bytes() == b"fake video content"
    with dbh.SessionLocal() as db:
        assert db.get(FileRecord, deleted_id) is None
        assert db.get(FileRecord, video_file["id"]).path == str(destination)
        history = db.query(DeletedFileRecord).filter_by(file_record_id=deleted_id).one()
        assert history.path == str(destination)


def test_rename_rejects_active_database_path_conflict(client, video_file, tmp_path):
    from src.crud.file import File as FileCRUD

    destination = tmp_path / "film.mp4"
    destination.write_bytes(b"other video")
    with dbh.SessionLocal() as db:
        FileCRUD(db).create_file_metadata(
            name=destination.name, path=str(destination), size=11,
            file_type="video", format=".mp4", directory_id="test-dir-1",
        )
    destination.unlink()

    res = client.patch(f"/api/files/{video_file['id']}/rename", json={"new_name": destination.name})

    assert res.status_code == 409
    assert res.json()["detail"] == "A file with that name already exists in the database"
    assert os.path.exists(video_file["path"])
    assert not destination.exists()


@pytest.mark.parametrize("failure_stage", ["execute", "commit", "enrich"])
def test_rename_failure_restores_disk_and_metadata(client, video_file, monkeypatch, failure_stage):
    import src.api.file as file_mod
    from sqlalchemy.orm import Session
    from src.schemas.file import FileRecord

    def fail(*args, **kwargs):
        raise RuntimeError("simulated metadata failure")

    with monkeypatch.context() as patch:
        if failure_stage == "enrich":
            patch.setattr(file_mod, "_enrich_file", fail)
        elif failure_stage == "execute":
            original_execute = Session.execute

            def execute(self, statement, *args, **kwargs):
                if str(statement).startswith("DELETE FROM actress_work_file_state"):
                    return fail()
                return original_execute(self, statement, *args, **kwargs)

            patch.setattr(Session, "execute", execute)
        else:
            patch.setattr(Session, "commit", fail)

        res = client.patch(f"/api/files/{video_file['id']}/rename", json={"new_name": "film.mp4"})

    assert res.status_code == 500
    assert "Failed to update file metadata after rename" in res.json()["detail"]
    assert os.path.exists(video_file["path"])
    assert not os.path.exists(os.path.join(video_file["dir"], "film.mp4"))
    with dbh.SessionLocal() as db:
        record = db.get(FileRecord, video_file["id"])
        assert record.name == "movie.mp4"
        assert record.path == video_file["path"]


def test_rename_rejects_path_separator(client, video_file):
    res = client.patch(f"/api/files/{video_file['id']}/rename", json={"new_name": "sub/film.mp4"})
    assert res.status_code == 422


def test_rename_rejects_extension_change(client, video_file):
    res = client.patch(f"/api/files/{video_file['id']}/rename", json={"new_name": "movie.mkv"})
    assert res.status_code == 422


def test_rename_rejects_conflict(client, video_file, tmp_path):
    existing = tmp_path / "film.mp4"
    existing.write_bytes(b"other file")
    res = client.patch(f"/api/files/{video_file['id']}/rename", json={"new_name": "film.mp4"})
    assert res.status_code == 409
