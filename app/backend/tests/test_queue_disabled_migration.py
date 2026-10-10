import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base, _ensure_queue_disabled_column


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    yield engine


def test_migration_adds_queue_disabled_column(isolated_db):
    """Column must exist after migration runs on a pre-migration DB."""
    engine = isolated_db
    with engine.connect() as conn:
        # Drop the table that Base.metadata created (it already has queue_disabled)
        conn.execute(text("DROP TABLE files"))
        # Recreate with only the minimal columns — no queue_disabled
        conn.execute(text("""
            CREATE TABLE files (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL UNIQUE,
                size INTEGER NOT NULL,
                directory_id TEXT NOT NULL
            )
        """))
        conn.commit()

    _ensure_queue_disabled_column()

    inspector = inspect(engine)
    col_names = [c["name"] for c in inspector.get_columns("files")]
    assert "queue_disabled" in col_names


def test_migration_idempotent(isolated_db):
    """Running migration twice must not raise or duplicate the column."""
    _ensure_queue_disabled_column()
    _ensure_queue_disabled_column()
    inspector = inspect(isolated_db)
    col_names = [c["name"] for c in inspector.get_columns("files")]
    assert col_names.count("queue_disabled") == 1
