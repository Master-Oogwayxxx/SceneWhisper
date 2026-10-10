from sqlalchemy import create_engine, text

from src.schemas.db_helper import _drop_ffmpeg_split_settings_columns, _ensure_concurrency_columns


def _engine_with_ffmpeg_columns():
    """Create an in-memory SQLite engine with legacy ffmpeg split settings columns."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                default_task_type TEXT NOT NULL DEFAULT 'all',
                ffmpeg_cq INTEGER NOT NULL DEFAULT 22,
                ffmpeg_preset TEXT NOT NULL DEFAULT 'p6',
                split_concurrency INTEGER NOT NULL DEFAULT 3
            )
        """))
        conn.execute(text("INSERT INTO settings (id) VALUES (1)"))
    return engine


def test_drop_ffmpeg_split_settings_columns_removes_legacy_columns(monkeypatch):
    """Migration removes ffmpeg_cq and ffmpeg_preset from existing settings tables."""
    engine = _engine_with_ffmpeg_columns()
    monkeypatch.setattr("src.schemas.db_helper.engine", engine)
    monkeypatch.setattr(
        "src.schemas.db_helper.SessionLocal",
        __import__("sqlalchemy.orm", fromlist=["sessionmaker"]).sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=engine,
        ),
    )

    _drop_ffmpeg_split_settings_columns()

    with engine.connect() as conn:
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()}
        row = conn.execute(text("SELECT id, default_task_type, split_concurrency FROM settings")).fetchone()

    assert "ffmpeg_cq" not in cols
    assert "ffmpeg_preset" not in cols
    assert "split_concurrency" in cols
    assert row == (1, "all", 3)


def test_drop_ffmpeg_split_settings_columns_is_idempotent(monkeypatch):
    """Second migration run is a no-op and does not raise."""
    engine = _engine_with_ffmpeg_columns()
    monkeypatch.setattr("src.schemas.db_helper.engine", engine)
    monkeypatch.setattr(
        "src.schemas.db_helper.SessionLocal",
        __import__("sqlalchemy.orm", fromlist=["sessionmaker"]).sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=engine,
        ),
    )

    _drop_ffmpeg_split_settings_columns()
    _drop_ffmpeg_split_settings_columns()

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]

    assert cols.count("split_concurrency") == 1
    assert "ffmpeg_cq" not in cols
    assert "ffmpeg_preset" not in cols


def test_ensure_concurrency_columns_adds_analysis_limits(monkeypatch):
    engine = _engine_with_ffmpeg_columns()
    monkeypatch.setattr("src.schemas.db_helper.engine", engine)

    _ensure_concurrency_columns()
    _ensure_concurrency_columns()

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        row = conn.execute(text(
            "SELECT scene_detection_concurrency, frame_pacing_analyzer_concurrency, frame_pacing_analyzer_timeout_minutes FROM settings WHERE id = 1"
        )).fetchone()

    assert cols.count("scene_detection_concurrency") == 1
    assert cols.count("frame_pacing_analyzer_concurrency") == 1
    assert cols.count("frame_pacing_analyzer_timeout_minutes") == 1
    assert row == (1, 4, 30)
