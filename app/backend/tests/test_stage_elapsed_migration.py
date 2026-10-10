from sqlalchemy import create_engine, text

from src.schemas.db_helper import _ensure_stage_elapsed_columns


def _make_engine_without_stage_elapsed():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE tasks (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                elapsed_seconds INTEGER
            )
        """))
    return engine


def test_stage_elapsed_columns_added():
    engine = _make_engine_without_stage_elapsed()
    import src.schemas.db_helper as dbh
    original = dbh.engine
    dbh.engine = engine
    try:
        _ensure_stage_elapsed_columns()
        with engine.connect() as conn:
            rows = conn.execute(text("PRAGMA table_info(tasks)")).fetchall()
            col_names = {row[1] for row in rows}
        assert "scene_elapsed_seconds" in col_names
        assert "split_elapsed_seconds" in col_names
        assert "subtitle_elapsed_seconds" in col_names
    finally:
        dbh.engine = original


def test_stage_elapsed_columns_idempotent():
    engine = _make_engine_without_stage_elapsed()
    import src.schemas.db_helper as dbh
    original = dbh.engine
    dbh.engine = engine
    try:
        _ensure_stage_elapsed_columns()
        _ensure_stage_elapsed_columns()  # must not raise
    finally:
        dbh.engine = original
