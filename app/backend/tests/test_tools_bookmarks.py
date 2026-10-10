from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api import tools as tools_mod
from src.schemas.db_helper import Base
from src.schemas.file import FileRecord


def test_bookmark_video_check_reports_existing_codes(monkeypatch):
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

    db = Session()
    try:
        db.add(
            FileRecord(
                id="file-1",
                name="ABC-001.mp4",
                path="D:/Videos/ABC-001.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                is_deleted=False,
            )
        )
        db.commit()
    finally:
        db.close()

    app = FastAPI()
    app.include_router(tools_mod.router)
    client = TestClient(app)

    response = client.post(
        "/api/tools/bookmarks/check",
        json={
            "items": [
                {"title": "Existing", "url": "https://example.test/abc-001", "video_code": "ABC-001"},
                {"title": "Missing", "url": "https://example.test/def-002", "video_code": "DEF-002"},
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["existing"] == 1
    assert [item["file_exists"] for item in body["items"]] == [True, False]
    assert body["items"][0]["matched_files"][0]["name"] == "ABC-001.mp4"
    assert body["items"][0]["matched_files"][0]["path"] == "D:/Videos/ABC-001.mp4"
    assert body["items"][1]["matched_files"] == []


def test_bookmark_video_check_ignores_non_video_matches(monkeypatch):
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

    db = Session()
    try:
        db.add(
            FileRecord(
                id="subtitle-1",
                name="ABC-001.srt",
                path="D:/Videos/ABC-001.srt",
                size=1,
                directory_id="dir-1",
                file_type="subtitle",
                is_deleted=False,
            )
        )
        db.commit()
    finally:
        db.close()

    app = FastAPI()
    app.include_router(tools_mod.router)
    client = TestClient(app)

    response = client.post(
        "/api/tools/bookmarks/check",
        json={
            "items": [
                {"title": "Subtitle only", "url": "https://example.test/abc-001", "video_code": "ABC-001"},
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["existing"] == 0
    assert body["items"][0]["file_exists"] is False
    assert body["items"][0]["matched_files"] == []


def test_bookmark_video_check_scopes_matches_to_selected_directories(monkeypatch):
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

    db = Session()
    try:
        db.add_all(
            [
                FileRecord(
                    id="file-1",
                    name="ABC-001.mp4",
                    path="D:/Videos/Dir One/ABC-001.mp4",
                    size=1,
                    directory_id="dir-1",
                    file_type="video",
                    is_deleted=False,
                ),
                FileRecord(
                    id="file-2",
                    name="ABC-001.mp4",
                    path="D:/Videos/Dir Two/ABC-001.mp4",
                    size=1,
                    directory_id="dir-2",
                    file_type="video",
                    is_deleted=False,
                ),
                FileRecord(
                    id="file-3",
                    name="DEF-002.mp4",
                    path="D:/Videos/Dir Three/DEF-002.mp4",
                    size=1,
                    directory_id="dir-3",
                    file_type="video",
                    is_deleted=False,
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    app = FastAPI()
    app.include_router(tools_mod.router)
    client = TestClient(app)

    response = client.post(
        "/api/tools/bookmarks/check",
        json={
            "directory_ids": ["dir-2", "dir-3"],
            "items": [
                {"title": "Existing", "url": "https://example.test/abc-001", "video_code": "ABC-001"},
                {"title": "Other", "url": "https://example.test/def-002", "video_code": "DEF-002"},
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["existing"] == 2
    assert [file["id"] for file in body["items"][0]["matched_files"]] == ["file-2"]
    assert [file["id"] for file in body["items"][1]["matched_files"]] == ["file-3"]
