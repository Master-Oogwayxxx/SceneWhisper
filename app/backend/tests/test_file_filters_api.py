from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
import sqlalchemy

import src.schemas.db_helper as dbh
from src.schemas.db_helper import Base
from src.schemas.setting import SettingRecord


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Each test gets its own isolated DB."""
    db_path = tmp_path / "test.db"
    engine = sqlalchemy.create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sqlalchemy.orm.sessionmaker(autocommit=False, autoflush=False, bind=engine))
    yield


@pytest.fixture()
def test_client(isolated_db):
    """Return a TestClient for the file filters API."""
    db = dbh.SessionLocal()
    db.add(SettingRecord())
    db.commit()
    db.close()

    import importlib
    import src.api.file_filters as file_filters_mod

    importlib.reload(file_filters_mod)

    app = FastAPI()
    app.include_router(file_filters_mod.router)
    return TestClient(app)


SAMPLE_FILTERS = {
    "type": ["video"],
    "format": ["mp4"],
    "dateRange": [],
    "hasScenes": True,
    "hasSplit": False,
    "hasSubtitle": False,
    "hasNoScenes": False,
    "hasNoSplit": False,
    "hasNoSubtitle": False,
    "sceneCount": None,
    "statusFilter": ["done"],
    "queueDisabled": False,
    "queueDisabledNo": False,
    "splitDisabled": False,
    "splitDisabledNo": False,
    "subtitleDisabled": False,
    "subtitleDisabledNo": False,
    "noNumberSuffix": False,
    "newVideos": False,
    "resolutionFilter": ["1080p"],
    "selectedDirectoryIds": ["dir-1"],
    "directoryExclude": False,
    "selectedDirectoryId": "dir-1",
    "isGroupedView": False,
}


def test_list_empty(test_client: TestClient):
    resp = test_client.get("/api/settings/file-filters")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_and_list(test_client: TestClient):
    create = test_client.post(
        "/api/settings/file-filters",
        json={"name": "Done videos", "filters": SAMPLE_FILTERS},
    )
    assert create.status_code == 200
    data = create.json()
    assert data["name"] == "Done videos"
    assert data["filters"]["type"] == ["video"]
    assert data["isDefault"] is False
    assert "id" in data
    assert "created_at" in data

    listed = test_client.get("/api/settings/file-filters")
    assert listed.status_code == 200
    assert len(listed.json()) == 1


def test_duplicate_name_overwrites_existing_preset(test_client: TestClient):
    created = test_client.post("/api/settings/file-filters", json={"name": "My Filter", "filters": SAMPLE_FILTERS}).json()
    replacement_filters = {**SAMPLE_FILTERS, "hasSplit": True, "statusFilter": ["unprocessed"]}

    overwritten = test_client.post("/api/settings/file-filters", json={"name": "my filter", "filters": replacement_filters})

    assert overwritten.status_code == 200
    body = overwritten.json()
    assert body["id"] == created["id"]
    assert body["name"] == "my filter"
    assert body["filters"]["hasSplit"] is True
    assert body["filters"]["statusFilter"] == ["unprocessed"]

    listed = test_client.get("/api/settings/file-filters")
    assert listed.status_code == 200
    assert len(listed.json()) == 1


def test_update_preset(test_client: TestClient):
    created = test_client.post(
        "/api/settings/file-filters",
        json={"name": "Original", "filters": SAMPLE_FILTERS},
    ).json()

    updated = test_client.patch(
        f"/api/settings/file-filters/{created['id']}",
        json={"name": "Renamed", "filters": {**SAMPLE_FILTERS, "hasSplit": True}},
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["name"] == "Renamed"
    assert body["filters"]["hasSplit"] is True


def test_set_default_preset(test_client: TestClient):
    first = test_client.post("/api/settings/file-filters", json={"name": "First", "filters": SAMPLE_FILTERS}).json()
    second = test_client.post("/api/settings/file-filters", json={"name": "Second", "filters": {**SAMPLE_FILTERS, "hasSplit": True}}).json()

    set_default = test_client.patch(
        f"/api/settings/file-filters/{second['id']}",
        json={"isDefault": True},
    )
    assert set_default.status_code == 200
    body = set_default.json()
    assert body["isDefault"] is True

    listed = test_client.get("/api/settings/file-filters").json()
    assert next(p for p in listed if p["id"] == second["id"])["isDefault"] is True
    assert next(p for p in listed if p["id"] == first["id"])["isDefault"] is False


def test_delete_preset(test_client: TestClient):
    created = test_client.post(
        "/api/settings/file-filters",
        json={"name": "To delete", "filters": SAMPLE_FILTERS},
    ).json()

    deleted = test_client.delete(f"/api/settings/file-filters/{created['id']}")
    assert deleted.status_code == 200

    listed = test_client.get("/api/settings/file-filters")
    assert listed.json() == []


def test_delete_missing_returns_404(test_client: TestClient):
    resp = test_client.delete("/api/settings/file-filters/missing-id")
    assert resp.status_code == 404
