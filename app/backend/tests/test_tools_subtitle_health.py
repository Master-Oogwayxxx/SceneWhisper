from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api import tools as tools_mod
from src.schemas.db_helper import Base
from src.schemas.file import FileRecord


def _client(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(tools_mod, "get_db", get_test_db)

    app = FastAPI()
    app.include_router(tools_mod.router)
    return TestClient(app), Session


def _add_file(db, *, file_id, name, path, file_type, parent_id=None, size=1):
    db.add(
        FileRecord(
            id=file_id,
            name=name,
            path=str(path),
            size=size,
            directory_id="dir-1",
            file_type=file_type,
            parent_id=parent_id,
            is_deleted=False,
        )
    )


def test_subtitle_health_reports_and_deletes_orphaned_subtitles(monkeypatch, tmp_path):
    client, Session = _client(monkeypatch)
    paired_video = tmp_path / "ABC-001.mp4"
    paired_subtitle = tmp_path / "ABC-001.srt"
    orphaned_subtitle = tmp_path / "DEF-002.srt"
    missing_subtitle_video = tmp_path / "GHI-003.mp4"
    empty_subtitle = tmp_path / "JKL-004.srt"
    empty_video = tmp_path / "JKL-004.mp4"

    paired_video.write_bytes(b"video")
    paired_subtitle.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n", encoding="utf-8")
    orphaned_subtitle.write_text("orphan", encoding="utf-8")
    missing_subtitle_video.write_bytes(b"video")
    empty_video.write_bytes(b"video")
    empty_subtitle.write_bytes(b"")

    db = Session()
    try:
        _add_file(db, file_id="video-1", name="ABC-001.mp4", path=paired_video, file_type="video")
        _add_file(db, file_id="subtitle-1", name="ABC-001.srt", path=paired_subtitle, file_type="subtitle", parent_id="video-1")
        _add_file(db, file_id="subtitle-2", name="DEF-002.srt", path=orphaned_subtitle, file_type="subtitle")
        _add_file(db, file_id="video-2", name="GHI-003.mp4", path=missing_subtitle_video, file_type="video")
        _add_file(db, file_id="video-3", name="JKL-004.mp4", path=empty_video, file_type="video")
        _add_file(db, file_id="subtitle-3", name="JKL-004.srt", path=empty_subtitle, file_type="subtitle", parent_id="video-3", size=0)
        db.commit()
    finally:
        db.close()

    health = client.get("/api/tools/subtitles/health")
    assert health.status_code == 200
    body = health.json()
    assert [item["file"]["id"] for item in body["orphaned_subtitles"]] == ["subtitle-2"]
    assert [item["file"]["id"] for item in body["missing_subtitles"]] == ["video-2"]
    assert [item["file"]["id"] for item in body["empty_subtitles"]] == ["subtitle-3"]

    delete_response = client.post("/api/tools/subtitles/orphaned/delete", json={"file_ids": ["subtitle-1", "subtitle-2"]})
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] == 1
    assert delete_response.json()["skipped"] == 1
    assert not orphaned_subtitle.exists()
    assert paired_subtitle.exists()

    db = Session()
    try:
        assert db.query(FileRecord).filter(FileRecord.id == "subtitle-2").first() is None
        assert db.query(FileRecord).filter(FileRecord.id == "subtitle-1").first() is not None
    finally:
        db.close()
