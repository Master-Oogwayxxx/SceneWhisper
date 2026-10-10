import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import src.schemas.db_helper as dbh
from src.schemas.db_helper import Base


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Each test gets its own in-memory DB."""
    from sqlalchemy import text
    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM logs"))
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    yield


@pytest.fixture()
def client(isolated_db):
    # Import app after DB is patched
    from src.log_handler import configure_logging
    from sqlalchemy import text

    configure_logging()

    # Clear logs that may have been created during configure_logging
    db = dbh.SessionLocal()
    db.execute(text("DELETE FROM logs"))
    db.commit()
    db.close()

    import importlib, src.api.logs as logs_mod
    importlib.reload(logs_mod)

    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(logs_mod.router)
    return TestClient(app)


def _emit(message: str, level: int = logging.INFO):
    logging.getLogger("test").log(level, message)


def test_get_logs_returns_structure(client):
    res = client.get("/api/logs")
    assert res.status_code == 200
    data = res.json()
    assert "items" in data
    assert "total" in data
    assert isinstance(data["items"], list)
    assert isinstance(data["total"], int)


def test_get_logs_returns_entries(client):
    _emit("hello info")
    _emit("hello debug", logging.DEBUG)

    res = client.get("/api/logs?limit=100")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] >= 2
    messages = [e["message"] for e in data["items"]]
    assert any("hello info" in m for m in messages)


def test_get_logs_level_filter(client):
    _emit("an error occurred", logging.ERROR)
    _emit("just info", logging.INFO)

    res = client.get("/api/logs?level=ERROR&limit=100")
    assert res.status_code == 200
    data = res.json()
    assert all(e["level"] == "ERROR" for e in data["items"])


def test_get_logs_search_filter(client):
    _emit("unique_xyz_string")
    _emit("something else entirely")

    res = client.get("/api/logs?search=unique_xyz_string&limit=100")
    assert res.status_code == 200
    data = res.json()
    assert len(data["items"]) >= 1
    assert all("unique_xyz_string" in e["message"] for e in data["items"])
