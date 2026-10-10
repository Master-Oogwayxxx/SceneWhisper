from sqlalchemy import create_engine, text

from src.schemas.db_helper import _ensure_task_type_priority_column


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


def test_task_type_priority_column_exists(monkeypatch):
    """Verify task_type_priority column is added by migration."""
    engine = _engine_without_column()
    monkeypatch.setattr("src.schemas.db_helper.engine", engine)

    _ensure_task_type_priority_column()

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
    assert "task_type_priority" in cols


def test_task_type_priority_idempotent(monkeypatch):
    """Verify migration is idempotent."""
    engine = _engine_without_column()
    monkeypatch.setattr("src.schemas.db_helper.engine", engine)

    _ensure_task_type_priority_column()
    _ensure_task_type_priority_column()  # second call must not raise

    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
    assert cols.count("task_type_priority") == 1
