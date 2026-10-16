import logging
import os
import re
import threading
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from sqlite3 import OperationalError as SQLiteOperationalError

_TASK_ID_RE = re.compile(r"\[Task ([a-fA-F0-9\-]+)\]")
_configured_data_dir = os.getenv("DB_STORAGE_PATH")
_DATA_DIR = Path(_configured_data_dir) if _configured_data_dir else Path(__file__).resolve().parents[1] / "data"
_LOG_DIR = _DATA_DIR / "logs"
_prune_lock = threading.Lock()
_last_prune_time = time.time()
_prune_interval = 60  # Only prune once per 60 seconds
_db_ready = False
_DB_DEBUG_LOG_PREFIXES = ("httpcore", "httpx", "urllib3", "hpack", "h11")


def mark_db_ready() -> None:
    global _db_ready
    _db_ready = True


class SQLiteLogHandler(logging.Handler):
    """Logging handler that persists log records to the SQLite logs table."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.levelno <= logging.DEBUG and record.name.startswith(_DB_DEBUG_LOG_PREFIXES):
            return False
        return super().filter(record)

    def emit(self, record: logging.LogRecord) -> None:
        if not _db_ready:
            return
        try:
            from .schemas.db_helper import SessionLocal
            from .schemas.log import LogRecord
            global _last_prune_time

            message = self.format(record)
            task_id: str | None = None
            m = _TASK_ID_RE.search(message)
            if m:
                task_id = m.group(1)

            exc_text = record.exc_text or None

            session = SessionLocal()
            try:
                entry = LogRecord(
                    level=record.levelname,
                    logger_name=record.name,
                    module=record.module,
                    message=message,
                    task_id=task_id,
                    exc_text=exc_text,
                )
                session.add(entry)
                session.flush()
                session.commit()

                # Only prune old logs periodically (every 60 seconds)
                now = time.time()
                if now - _last_prune_time > _prune_interval:
                    with _prune_lock:
                        _last_prune_time = now
                        # Run prune in a separate transaction to avoid blocking
                        try:
                            session.execute(
                                __import__("sqlalchemy").text("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 10000)"),
                            )
                            session.commit()
                        except Exception:
                            session.rollback()
            except Exception as exc:
                session.rollback()
                if _is_sqlite_locked_error(exc):
                    return
                raise
            finally:
                session.close()
        except Exception:
            self.handleError(record)


def _is_sqlite_locked_error(exc: BaseException) -> bool:
    if isinstance(exc, SQLiteOperationalError) and "database is locked" in str(exc).lower():
        return True
    original = getattr(exc, "orig", None)
    return isinstance(original, SQLiteOperationalError) and "database is locked" in str(original).lower()


def configure_logging() -> None:
    """Set up root logger with SQLite + rotating file handlers."""
    _LOG_DIR.mkdir(parents=True, exist_ok=True)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    # Remove any existing handlers (e.g. basicConfig handler)
    root.handlers.clear()

    fmt = logging.Formatter("%(message)s")

    file_handler = RotatingFileHandler(
        _LOG_DIR / "app.log",
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(logging.DEBUG)

    db_handler = SQLiteLogHandler()
    db_handler.setFormatter(fmt)
    db_handler.setLevel(logging.INFO)

    root.addHandler(file_handler)
    root.addHandler(db_handler)
