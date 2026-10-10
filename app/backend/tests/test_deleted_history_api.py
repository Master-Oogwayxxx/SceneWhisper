from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.api import file as file_mod
from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base
from src.schemas.deleted_file import DeletedFileRecord


def test_deleted_history_lists_recent_entries(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))

    db = dbh.SessionLocal()
    try:
        older = datetime.utcnow() - timedelta(days=1)
        db.add_all(
            [
                DeletedFileRecord(
                    file_record_id="file-1",
                    name="old-video.mp4",
                    path="/videos/old-video.mp4",
                    size=123,
                    file_type="video",
                    format=".mp4",
                    directory_id="dir-1",
                    deleted_at=older,
                    reason="manual_file_delete",
                    source="file_api",
                ),
                DeletedFileRecord(
                    file_record_id="file-2",
                    name="new-video.mp4",
                    path="/videos/new-video.mp4",
                    size=456,
                    file_type="video",
                    format=".mp4",
                    directory_id="dir-1",
                    deleted_at=datetime.utcnow(),
                    reason="missing_file_cleanup",
                    source="directory_cleanup",
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    app = FastAPI()
    app.include_router(file_mod.router)
    client = TestClient(app)

    response = client.get("/api/files/deleted-history", params={"search": "video", "file_type": "video"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["items"][0]["name"] == "new-video.mp4"
    assert body["items"][1]["name"] == "old-video.mp4"
