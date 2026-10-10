from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.api import directory as directory_mod
from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base
from src.schemas.deleted_file import DeletedFileRecord
from src.schemas.directory import DirectoryRecord
from src.schemas.file import FileRecord


def _client_with_directory(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))

    directory_path = tmp_path / "videos"
    directory_path.mkdir()
    disk_file = directory_path / "video.mp4"
    disk_file.write_text("video")

    db = dbh.SessionLocal()
    try:
        db.add(DirectoryRecord(id="dir-1", name="videos", path=str(directory_path)))
        db.add(
            FileRecord(
                id="file-1",
                name="video.mp4",
                path=str(disk_file),
                size=5,
                created_at=datetime.utcnow(),
                modified_at=datetime.utcnow(),
                format=".mp4",
                file_type="video",
                directory_id="dir-1",
            )
        )
        db.commit()
    finally:
        db.close()

    app = FastAPI()
    app.include_router(directory_mod.router)
    return TestClient(app), directory_path, dbh.SessionLocal


def test_delete_directory_can_remove_disk_only(tmp_path, monkeypatch):
    client, directory_path, session_factory = _client_with_directory(tmp_path, monkeypatch)

    response = client.delete("/api/directory/delete/dir-1", params={"delete_from_disk": True, "delete_from_database": False})

    assert response.status_code == 200
    assert not directory_path.exists()

    db = session_factory()
    try:
        assert db.query(DirectoryRecord).filter(DirectoryRecord.id == "dir-1").first() is not None
        assert db.query(FileRecord).filter(FileRecord.id == "file-1").first() is not None
        assert db.query(DeletedFileRecord).count() == 0
    finally:
        db.close()


def test_delete_directory_can_remove_database_only(tmp_path, monkeypatch):
    client, directory_path, session_factory = _client_with_directory(tmp_path, monkeypatch)

    response = client.delete("/api/directory/delete/dir-1", params={"delete_from_disk": False, "delete_from_database": True})

    assert response.status_code == 200
    assert directory_path.exists()

    db = session_factory()
    try:
        assert db.query(DirectoryRecord).filter(DirectoryRecord.id == "dir-1").first() is None
        assert db.query(FileRecord).filter(FileRecord.id == "file-1").first() is None
        assert db.query(DeletedFileRecord).filter(DeletedFileRecord.file_record_id == "file-1").count() == 1
    finally:
        db.close()


def test_delete_directory_requires_a_delete_target(tmp_path, monkeypatch):
    client, directory_path, session_factory = _client_with_directory(tmp_path, monkeypatch)

    response = client.delete("/api/directory/delete/dir-1", params={"delete_from_disk": False, "delete_from_database": False})

    assert response.status_code == 400
    assert response.json()["detail"] == "Choose at least one delete target"
    assert directory_path.exists()

    db = session_factory()
    try:
        assert db.query(DirectoryRecord).filter(DirectoryRecord.id == "dir-1").first() is not None
        assert db.query(FileRecord).filter(FileRecord.id == "file-1").first() is not None
    finally:
        db.close()
