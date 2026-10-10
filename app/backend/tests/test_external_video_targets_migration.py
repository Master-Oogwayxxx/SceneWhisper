from sqlalchemy import create_engine, text

from src.schemas.db_helper import _ensure_external_video_targets_column


def _engine_without_column():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                default_task_type TEXT NOT NULL DEFAULT 'all'
            )
        """))
    return engine


def test_adds_external_video_targets_column(monkeypatch):
    engine = _engine_without_column()
    monkeypatch.setattr("src.schemas.db_helper.engine", engine)

    _ensure_external_video_targets_column()

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
    assert "external_video_targets" in cols


def test_external_video_targets_column_is_idempotent(monkeypatch):
    engine = _engine_without_column()
    monkeypatch.setattr("src.schemas.db_helper.engine", engine)

    _ensure_external_video_targets_column()
    _ensure_external_video_targets_column()

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
    assert cols.count("external_video_targets") == 1
