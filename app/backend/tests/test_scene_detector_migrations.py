from sqlalchemy import create_engine, text

from src.schemas.db_helper import _ensure_scene_detector_settings_columns, _ensure_task_scene_detector_column


def _make_engine_with_old_schema():
    """Create an in-memory SQLite engine with legacy table schemas (missing new columns)."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})

    with engine.begin() as conn:
        # Create old settings table without scene_detector, scene_adaptive_threshold, scene_black_threshold, scene_white_threshold
        conn.execute(text("""
            CREATE TABLE settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                default_task_type TEXT NOT NULL DEFAULT 'all',
                default_subtitle_language TEXT NOT NULL DEFAULT 'en',
                default_layout TEXT NOT NULL DEFAULT 'grid',
                show_stats_panel BOOLEAN NOT NULL DEFAULT 1,
                default_sort_field TEXT NOT NULL DEFAULT 'name',
                default_sort_direction TEXT NOT NULL DEFAULT 'asc',
                scene_content_threshold REAL NOT NULL DEFAULT 27.0,
                min_scene_length_frames INTEGER NOT NULL DEFAULT 180,
                ffmpeg_cq INTEGER NOT NULL DEFAULT 22,
                ffmpeg_preset TEXT NOT NULL DEFAULT 'p6',
                monitor_sort_field TEXT NOT NULL DEFAULT 'directoryName',
                monitor_sort_direction TEXT NOT NULL DEFAULT 'asc',
                task_poll_interval_ms INTEGER NOT NULL DEFAULT 3000,
                auto_cleanup_on_scan BOOLEAN NOT NULL DEFAULT 0
            )
        """))

        # Create old tasks table without scene_detector column
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
                scheduled_for TEXT,
                created_at DATETIME NOT NULL,
                started_at DATETIME,
                completed_at DATETIME,
                elapsed_seconds INTEGER,
                error TEXT
            )
        """))

    return engine


def test_scene_detector_settings_columns_added():
    engine = _make_engine_with_old_schema()
    import src.schemas.db_helper as dbh
    original = dbh.engine
    dbh.engine = engine
    try:
        _ensure_scene_detector_settings_columns()
        with engine.connect() as conn:
            rows = conn.execute(text("PRAGMA table_info(settings)")).fetchall()
            col_names = {row[1] for row in rows}
        assert "scene_detector" in col_names
        assert "scene_adaptive_threshold" in col_names
        assert "scene_black_threshold" in col_names
        assert "scene_white_threshold" in col_names
    finally:
        dbh.engine = original


def test_task_scene_detector_column_added():
    engine = _make_engine_with_old_schema()
    import src.schemas.db_helper as dbh
    original = dbh.engine
    dbh.engine = engine
    try:
        _ensure_task_scene_detector_column()
        with engine.connect() as conn:
            rows = conn.execute(text("PRAGMA table_info(tasks)")).fetchall()
            col_names = {row[1] for row in rows}
        assert "scene_detector" in col_names
    finally:
        dbh.engine = original
