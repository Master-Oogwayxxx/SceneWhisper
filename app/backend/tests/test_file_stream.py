from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
import sqlalchemy

import src.schemas.db_helper as dbh
from src.api.file import router as file_router
from src.schemas.db_helper import Base
from src.schemas.file import FileRecord


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
    return tmp_path


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(file_router)
    return TestClient(app)


def _add_video(path: str) -> None:
    db = dbh.SessionLocal()
    db.add(
        FileRecord(
            id="video-1",
            name="video.unknownvideo",
            path=path,
            size=10,
            created_at=datetime(2026, 1, 1),
            modified_at=datetime(2026, 1, 1),
            format=".unknownvideo",
            duration="00:00:10",
            file_type="video",
            status="unprocessed",
            directory_id="dir-1",
            queue_disabled=False,
            split_disabled=False,
            subtitle_disabled=False,
            is_deleted=False,
        )
    )
    db.commit()
    db.close()


def test_stream_file_supports_suffix_range_and_video_fallback_type(isolated_db):
    video_path = isolated_db / "video.unknownvideo"
    video_path.write_bytes(b"0123456789")
    _add_video(str(video_path))

    response = _client().get("/api/files/video-1/stream", headers={"Range": "bytes=-4"})

    assert response.status_code == 206
    assert response.headers["content-range"] == "bytes 6-9/10"
    assert response.headers["content-type"].startswith("video/mp4")
    assert response.content == b"6789"


def test_stream_file_rejects_invalid_range(isolated_db):
    video_path = isolated_db / "video.unknownvideo"
    video_path.write_bytes(b"0123456789")
    _add_video(str(video_path))

    response = _client().get("/api/files/video-1/stream", headers={"Range": "bytes=abc-def"})

    assert response.status_code == 416
