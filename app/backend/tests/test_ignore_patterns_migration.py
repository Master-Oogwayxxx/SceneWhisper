from sqlalchemy import create_engine, text

from src.schemas.db_helper import _ensure_ignore_patterns_column


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


def test_adds_column_when_missing(monkeypatch):
    engine = _engine_without_column()
    monkeypatch.setattr("src.schemas.db_helper.engine", engine)

    _ensure_ignore_patterns_column()

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
    assert "ignore_patterns" in cols


def test_idempotent_when_column_exists(monkeypatch):
    engine = _engine_without_column()
    monkeypatch.setattr("src.schemas.db_helper.engine", engine)

    _ensure_ignore_patterns_column()
    _ensure_ignore_patterns_column()  # second call must not raise

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
    assert cols.count("ignore_patterns") == 1
