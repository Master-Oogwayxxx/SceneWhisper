from sqlalchemy import create_engine, text

from src.schemas.db_helper import _ensure_scene_split_count_columns


def _make_engine_without_count_columns():
    """In-memory SQLite with old tasks table (no scene_count/split_count)."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                current_stage TEXT,
                progress REAL DEFAULT 0.0,
                scene_progress REAL DEFAULT 0.0,
                split_progress REAL DEFAULT 0.0,
                subtitle_progress REAL DEFAULT 0.0,
                subtitle_language TEXT,
                scene_detector TEXT,
                scheduled_for TEXT,
                created_at DATETIME NOT NULL,
                started_at DATETIME,
                completed_at DATETIME,
                elapsed_seconds INTEGER,
                error TEXT
            )
        """))
    return engine


def test_scene_split_count_columns_added():
    engine = _make_engine_without_count_columns()
    import src.schemas.db_helper as dbh
    original = dbh.engine
    dbh.engine = engine
    try:
        _ensure_scene_split_count_columns()
        with engine.connect() as conn:
            rows = conn.execute(text("PRAGMA table_info(tasks)")).fetchall()
            col_names = {row[1] for row in rows}
        assert "scene_count" in col_names
        assert "split_count" in col_names
    finally:
        dbh.engine = original


def test_scene_split_count_migration_idempotent():
    """Running the migration twice must not raise."""
    engine = _make_engine_without_count_columns()
    import src.schemas.db_helper as dbh
    original = dbh.engine
    dbh.engine = engine
    try:
        _ensure_scene_split_count_columns()
        _ensure_scene_split_count_columns()  # second call must be a no-op
    finally:
        dbh.engine = original
