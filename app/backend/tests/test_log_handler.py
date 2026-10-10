import logging
import re
import sqlite3

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import src.schemas.db_helper as dbh
from src.schemas.log import LogRecord


def _make_test_engine():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    from src.schemas.db_helper import Base
    Base.metadata.create_all(bind=engine)
    return engine


def test_emit_inserts_row():
    """SQLiteLogHandler inserts one row per log call."""
    engine = _make_test_engine()
    original_engine = dbh.engine
    original_session = dbh.SessionLocal
    import src.log_handler as log_handler
    original_db_ready = log_handler._db_ready
    dbh.engine = engine
    dbh.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    log_handler.mark_db_ready()

    try:
        handler = log_handler.SQLiteLogHandler()
        logger = logging.getLogger("test_emit")
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)

        logger.info("hello world")

        session = dbh.SessionLocal()
        rows = session.query(LogRecord).all()
        session.close()

        assert len(rows) == 1
        assert rows[0].message == "hello world"
        assert rows[0].level == "INFO"
        assert rows[0].logger_name == "test_emit"
    finally:
        logger.removeHandler(handler)
        dbh.engine = original_engine
        dbh.SessionLocal = original_session
        log_handler._db_ready = original_db_ready


def test_task_id_extracted():
    """task_id is parsed from [Task 42] prefix in message."""
    engine = _make_test_engine()
    original_engine = dbh.engine
    original_session = dbh.SessionLocal
    import src.log_handler as log_handler
    original_db_ready = log_handler._db_ready
    dbh.engine = engine
    dbh.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    log_handler.mark_db_ready()

    try:
        handler = log_handler.SQLiteLogHandler()
        logger = logging.getLogger("test_task_id")
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)

        logger.info("[Task 42] Starting scene detection")

        session = dbh.SessionLocal()
        row = session.query(LogRecord).first()
        session.close()

        assert row.task_id == "42"
    finally:
        logger.removeHandler(handler)
        dbh.engine = original_engine
        dbh.SessionLocal = original_session
        log_handler._db_ready = original_db_ready


def test_pruning_keeps_last_10000():
    """After inserting 10005 rows, count stays at or below 10000."""
    engine = _make_test_engine()
    original_engine = dbh.engine
    original_session = dbh.SessionLocal
    import src.log_handler as log_handler
    original_db_ready = log_handler._db_ready
    original_last_prune_time = log_handler._last_prune_time
    dbh.engine = engine
    dbh.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    log_handler.mark_db_ready()
    log_handler._last_prune_time = 0

    try:
        handler = log_handler.SQLiteLogHandler()

        record = logging.LogRecord(
            name="pruner", level=logging.INFO, pathname="", lineno=0,
            msg="msg", args=(), exc_info=None
        )
        for _ in range(10005):
            handler.emit(record)
        log_handler._last_prune_time = 0
        handler.emit(record)

        session = dbh.SessionLocal()
        count = session.query(LogRecord).count()
        session.close()

        assert count <= 10000
    finally:
        dbh.engine = original_engine
        dbh.SessionLocal = original_session
        log_handler._db_ready = original_db_ready
        log_handler._last_prune_time = original_last_prune_time


def test_sqlite_locked_error_is_dropped_without_handle_error(monkeypatch):
    """Logging must not print recursive tracebacks when SQLite is locked."""
    import src.log_handler as log_handler

    class LockedSession:
        def add(self, entry):
            pass

        def flush(self):
            raise sqlite3.OperationalError("database is locked")

        def rollback(self):
            pass

        def close(self):
            pass

    original_session = dbh.SessionLocal
    original_db_ready = log_handler._db_ready
    dbh.SessionLocal = LockedSession
    log_handler.mark_db_ready()

    handled = False

    def fake_handle_error(record):
        nonlocal handled
        handled = True

    try:
        handler = log_handler.SQLiteLogHandler()
        monkeypatch.setattr(handler, "handleError", fake_handle_error)
        record = logging.LogRecord("scene", logging.INFO, "", 0, "hello", (), None)

        handler.emit(record)

        assert handled is False
    finally:
        dbh.SessionLocal = original_session
        log_handler._db_ready = original_db_ready


def test_db_handler_filters_noisy_http_debug_records():
    import src.log_handler as log_handler

    handler = log_handler.SQLiteLogHandler()
    noisy = logging.LogRecord("httpcore.connection", logging.DEBUG, "", 0, "close.complete", (), None)
    app_debug = logging.LogRecord("src.processor", logging.DEBUG, "", 0, "progress", (), None)

    assert handler.filter(noisy) is False
    assert handler.filter(app_debug) is True
