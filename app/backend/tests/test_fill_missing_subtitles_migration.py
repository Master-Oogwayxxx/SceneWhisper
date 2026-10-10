import pytest
from sqlalchemy import create_engine, inspect, text
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
    yield engine


def test_fill_missing_subtitles_column_exists(isolated_db):
    """Column must exist after init_db() runs migrations."""
    engine = isolated_db
    inspector = inspect(engine)
    cols = [c["name"] for c in inspector.get_columns("directory_monitors")]
    assert "fill_missing_subtitles" in cols


def test_migration_adds_fill_missing_subtitles_column(isolated_db):
    """Column must exist after migration runs on a pre-migration DB."""
    from src.schemas.db_helper import _ensure_fill_missing_subtitles_column

    engine = isolated_db
    with engine.connect() as conn:
        # Drop the table that Base.metadata created (it already has fill_missing_subtitles)
        conn.execute(text("DROP TABLE directory_monitors"))
        # Recreate with only the minimal columns — no fill_missing_subtitles
        conn.execute(text("""
            CREATE TABLE directory_monitors (
                id TEXT PRIMARY KEY,
                directory_id TEXT NOT NULL,
                directory_name TEXT NOT NULL,
                directory_path TEXT NOT NULL,
                task_type TEXT NOT NULL,
                subtitle_language TEXT,
                schedule_interval TEXT NOT NULL,
                schedule_time TEXT,
                schedule_day_of_week INTEGER,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                delete_video_after_completion BOOLEAN NOT NULL DEFAULT 0,
                last_run DATETIME,
                next_run DATETIME,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
        """))
        conn.commit()

    _ensure_fill_missing_subtitles_column()

    inspector = inspect(engine)
    col_names = [c["name"] for c in inspector.get_columns("directory_monitors")]
    assert "fill_missing_subtitles" in col_names


def test_migration_idempotent(isolated_db):
    """Running migration twice must not raise or duplicate the column."""
    from src.schemas.db_helper import _ensure_fill_missing_subtitles_column

    _ensure_fill_missing_subtitles_column()
    _ensure_fill_missing_subtitles_column()
    inspector = inspect(isolated_db)
    col_names = [c["name"] for c in inspector.get_columns("directory_monitors")]
    assert col_names.count("fill_missing_subtitles") == 1
