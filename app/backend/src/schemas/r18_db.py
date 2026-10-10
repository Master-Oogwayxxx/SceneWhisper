"""SQLite connection and import helpers for the R18.dev reference database."""

from __future__ import annotations

import gzip
import json
import logging
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from collections.abc import Callable
from typing import Any

from ..models.notification import NotificationType
from ..notification_service import emit_notification_sync
from .r18_schema import ACTRESS_TABLE
from .r18_pg_dump_importer import import_pg_dump_sql_gz

logger = logging.getLogger(__name__)


def _format_bytes(num: int) -> str:
    """Format a byte count for human-readable notification messages."""
    if num < 1024:
        return f"{num} B"
    units = ["KB", "MB", "GB", "TB"]
    value = num / 1024
    unit_index = 0
    while value >= 1024 and unit_index < len(units) - 1:
        value /= 1024
        unit_index += 1
    return f"{value:.1f} {units[unit_index]}"


def _emit_r18_notification(
    notification_type: NotificationType,
    title: str,
    message: str,
) -> None:
    """Broadcast an R18 import lifecycle notification. Never raises."""
    emit_notification_sync(notification_type, title, message)


DB_DIR = Path(os.getenv("DB_STORAGE_PATH", "/data"))
R18_DATA_DIR = DB_DIR / "r18"
R18_DB_PATH = Path(os.getenv("R18_DB_PATH", str(R18_DATA_DIR / "r18.db")))
R18_METADATA_PATH = R18_DATA_DIR / "metadata.json"
R18_IMPORT_STATUS_PATH = R18_DATA_DIR / "import_status.json"

_import_lock = threading.Lock()
_import_state: dict[str, Any] = {
    "state": "idle",
    "phase": None,
    "download_bytes": None,
    "download_total": None,
    "error": None,
    "started_at": None,
    "finished_at": None,
}

_STALE_RUNNING_IMPORT_SECONDS = 60 * 60


def _idle_import_state() -> dict[str, Any]:
    """Return a fresh idle import status payload."""
    return {
        "state": "idle",
        "phase": None,
        "download_bytes": None,
        "download_total": None,
        "error": None,
        "started_at": None,
        "finished_at": None,
    }


def _persist_import_state() -> None:
    """Write the in-memory import status to disk."""
    _ensure_data_dir()
    R18_IMPORT_STATUS_PATH.write_text(json.dumps(_import_state, indent=2), encoding="utf-8")


def get_r18_connection() -> sqlite3.Connection:
    """Open a read connection to the R18 reference SQLite database.

    Returns:
        An open sqlite3 connection with ``Row`` factory. Caller must close it.

    Raises:
        sqlite3.Error: If the database file is missing or unreadable.
    """
    conn = sqlite3.connect(R18_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_data_dir() -> None:
    R18_DATA_DIR.mkdir(parents=True, exist_ok=True)


def _write_metadata(filename: str, actress_count: int) -> dict[str, Any]:
    """Persist import metadata to disk."""
    _ensure_data_dir()
    metadata = {
        "imported_at": datetime.now(timezone.utc).isoformat(),
        "filename": filename,
        "actress_count": actress_count,
    }
    R18_METADATA_PATH.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return metadata


def read_metadata() -> dict[str, Any] | None:
    """Return last import metadata, or None if never imported."""
    if not R18_METADATA_PATH.exists():
        return None
    try:
        return json.loads(R18_METADATA_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _set_import_state(state: str, *, error: str | None = None, phase: str | None = None) -> None:
    """Update import job state and persist it for status polling.

    Args:
        state: One of idle, running, completed, or failed.
        error: Failure message when state is failed.
        phase: Active step when running: downloading or importing.
    """
    global _import_state
    now = datetime.now(timezone.utc).isoformat()
    prev = _import_state

    if state == "running":
        next_phase = phase if phase is not None else prev.get("phase") or "importing"
        _import_state = {
            "state": "running",
            "phase": next_phase,
            "download_bytes": None if next_phase == "importing" else prev.get("download_bytes", 0),
            "download_total": None if next_phase == "importing" else prev.get("download_total"),
            "error": None,
            "started_at": prev.get("started_at") or now,
            "finished_at": None,
        }
    elif state == "completed":
        _import_state = {
            "state": "completed",
            "phase": None,
            "download_bytes": None,
            "download_total": None,
            "error": None,
            "started_at": prev.get("started_at"),
            "finished_at": now,
        }
    elif state == "failed":
        _import_state = {
            "state": "failed",
            "phase": None,
            "download_bytes": None,
            "download_total": None,
            "error": error,
            "started_at": prev.get("started_at"),
            "finished_at": now,
        }
    else:
        _import_state = _idle_import_state()

    _persist_import_state()


def update_download_progress(download_bytes: int, download_total: int | None) -> None:
    """Record streamed download progress for URL imports.

    Args:
        download_bytes: Bytes written so far.
        download_total: Expected total size from Content-Length, if known.
    """
    global _import_state
    if _import_state.get("state") != "running":
        return
    _import_state = {
        **_import_state,
        "phase": "downloading",
        "download_bytes": download_bytes,
        "download_total": download_total,
    }
    _persist_import_state()


def get_import_status() -> dict[str, Any]:
    """Return current import job status."""
    if R18_IMPORT_STATUS_PATH.exists():
        try:
            on_disk = json.loads(R18_IMPORT_STATUS_PATH.read_text(encoding="utf-8"))
            if _is_stale_orphaned_running_import(on_disk):
                recovered = _recover_stale_import_status(on_disk)
                return {**_import_state, **recovered}
            return {**_import_state, **on_disk}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(_import_state)


def _parse_import_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _is_stale_orphaned_running_import(status: dict[str, Any]) -> bool:
    if status.get("state") != "running":
        return False
    if _import_lock.locked():
        return False

    started_at = _parse_import_timestamp(status.get("started_at"))
    if started_at is None:
        return True
    age = datetime.now(timezone.utc) - started_at
    return age.total_seconds() > _STALE_RUNNING_IMPORT_SECONDS


def _recover_stale_import_status(status: dict[str, Any]) -> dict[str, Any]:
    recovered = {
        **status,
        "state": "completed" if r18_db_ready() else "failed",
        "phase": None,
        "download_bytes": None,
        "download_total": None,
        "finished_at": status.get("finished_at") or datetime.now(timezone.utc).isoformat(),
    }
    recovered["error"] = None if recovered["state"] == "completed" else "Previous import did not finish"
    try:
        global _import_state
        _import_state = recovered
        _persist_import_state()
    except OSError:
        pass
    return recovered


def _table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def count_actresses(conn: sqlite3.Connection | None = None) -> int:
    """Count rows in the actress table, or 0 if unavailable."""
    own_conn = conn is None
    if own_conn:
        if not R18_DB_PATH.exists():
            return 0
        try:
            conn = get_r18_connection()
        except sqlite3.Error:
            return 0
    assert conn is not None
    try:
        if not _table_exists(conn, ACTRESS_TABLE):
            return 0
        row = conn.execute(f"SELECT COUNT(*) FROM {ACTRESS_TABLE}").fetchone()
        return int(row[0]) if row else 0
    except sqlite3.Error:
        return 0
    finally:
        if own_conn:
            conn.close()


def ensure_r18_indexes() -> None:
    """Create missing performance indexes on an already-imported R18 database."""
    if not R18_DB_PATH.exists():
        return
    index_specs = [
        ("derived_video_actress", "actress_id", "idx_derived_video_actress_actress_id"),
        (
            "derived_video_actress",
            "actress_id, content_id, release_date",
            "idx_derived_video_actress_actress_content_release",
        ),
        ("derived_video_actress", "release_date", "idx_derived_video_actress_release_date"),
        ("derived_video", "content_id", "idx_derived_video_content_id"),
        ("derived_video", "title_en", "idx_derived_video_title_en"),
    ]
    try:
        conn = sqlite3.connect(R18_DB_PATH, check_same_thread=False)
        try:
            existing_tables = {
                row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            }
            for table, column, index_name in index_specs:
                if table in existing_tables:
                    conn.execute(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table}({column})")
            conn.commit()
        finally:
            conn.close()
    except sqlite3.Error:
        pass


def r18_db_ready() -> bool:
    """Return True when the R18 database exists and has actress data."""
    if not R18_DB_PATH.exists():
        return False
    try:
        conn = get_r18_connection()
    except sqlite3.Error:
        return False
    try:
        return _table_exists(conn, ACTRESS_TABLE) and count_actresses(conn) > 0
    finally:
        conn.close()


def _run_sqlite_import(sql_gz_path: Path) -> None:
    """Import a gzipped PostgreSQL dump into the R18 SQLite database."""
    import_pg_dump_sql_gz(sql_gz_path, R18_DB_PATH)


@dataclass
class ImportResult:
    """Outcome of an R18 SQL.gz import."""

    actress_count: int
    duration_seconds: float
    imported_at: str
    filename: str


def import_r18_sql_gz(sql_gz_path: Path, *, filename: str | None = None) -> ImportResult:
    """Replace the R18 database by importing a gzipped r18.dev PostgreSQL dump.

    Args:
        sql_gz_path: Path to the `.sql.gz` file on disk.
        filename: Original upload filename for metadata.

    Returns:
        ImportResult with counts and timing.

    Raises:
        RuntimeError: If import is already running or parsing fails.
        FileNotFoundError: If sql_gz_path does not exist.
    """
    if not sql_gz_path.exists():
        raise FileNotFoundError(str(sql_gz_path))

    if not _import_lock.acquire(blocking=False):
        raise RuntimeError("An import is already in progress")

    started = time.monotonic()
    display_name = filename or sql_gz_path.name
    try:
        _set_import_state("running", phase="importing")
        _emit_r18_notification(
            NotificationType.R18_IMPORTING,
            "R18 database import in progress",
            f"Loading {display_name} into SQLite",
        )
        _ensure_data_dir()
        _run_sqlite_import(sql_gz_path)

        if not r18_db_ready():
            raise RuntimeError(f"Import finished but `{ACTRESS_TABLE}` is missing or empty")

        actress_count = count_actresses()
        metadata = _write_metadata(display_name, actress_count)
        _set_import_state("completed")
        _emit_r18_notification(
            NotificationType.R18_IMPORT_COMPLETED,
            "R18 import complete",
            f"{actress_count:,} actresses loaded from {display_name}",
        )
        duration = time.monotonic() - started
        return ImportResult(
            actress_count=actress_count,
            duration_seconds=round(duration, 2),
            imported_at=metadata["imported_at"],
            filename=display_name,
        )
    except Exception as exc:
        _set_import_state("failed", error=str(exc))
        _emit_r18_notification(
            NotificationType.R18_IMPORT_FAILED,
            "R18 import failed",
            str(exc),
        )
        raise
    finally:
        _import_lock.release()


def _import_status_model() -> dict[str, Any]:
    """Return the current import status payload."""
    return get_import_status()


def schedule_import_r18_sql_gz(sql_gz_path: Path, *, filename: str | None = None) -> dict[str, Any]:
    """Start importing a dump on a background thread.

    Args:
        sql_gz_path: Path to the `.sql.gz` file on disk.
        filename: Original upload filename for metadata.

    Returns:
        Current import status immediately after scheduling.

    Raises:
        RuntimeError: If an import is already running.
        FileNotFoundError: If sql_gz_path does not exist.
    """
    if not sql_gz_path.exists():
        raise FileNotFoundError(str(sql_gz_path))
    if get_import_status().get("state") == "running":
        raise RuntimeError("An import is already in progress")

    def _worker() -> None:
        try:
            import_r18_sql_gz(sql_gz_path, filename=filename)
        except Exception as exc:
            if get_import_status().get("state") == "running":
                _set_import_state("failed", error=str(exc))
                _emit_r18_notification(
                    NotificationType.R18_IMPORT_FAILED,
                    "R18 import failed",
                    str(exc),
                )
            logger.exception("Background R18 import failed")

    _set_import_state("running", phase="importing")
    _emit_r18_notification(
        NotificationType.R18_IMPORT_STARTED,
        "R18 import started",
        f"Queued import of {filename or sql_gz_path.name}",
    )
    threading.Thread(target=_worker, daemon=True, name="r18-import").start()
    return _import_status_model()


def schedule_import_from_url(url: str, dest_name: str = "latest.sql.gz") -> dict[str, Any]:
    """Download a remote dump and import it on a background thread.

    Args:
        url: HTTP(S) URL to fetch.
        dest_name: Local filename under R18_DATA_DIR.

    Returns:
        Current import status immediately after scheduling.

    Raises:
        RuntimeError: If an import is already running.
    """
    if get_import_status().get("state") == "running":
        raise RuntimeError("An import is already in progress")

    def _worker() -> None:
        try:
            path = download_sql_gz(url, dest_name, progress_callback=update_download_progress)
            _set_import_state("running", phase="importing")
            size = path.stat().st_size
            _emit_r18_notification(
                NotificationType.R18_DOWNLOAD_COMPLETED,
                "R18 dump download complete",
                f"Downloaded {_format_bytes(size)} from r18.dev",
            )
            import_r18_sql_gz(path, filename=path.name)
        except Exception as exc:
            if get_import_status().get("state") == "running":
                _set_import_state("failed", error=str(exc))
                _emit_r18_notification(
                    NotificationType.R18_IMPORT_FAILED,
                    "R18 import failed",
                    str(exc),
                )
            logger.exception("Background R18 import-from-url failed")

    _set_import_state("running", phase="downloading")
    _emit_r18_notification(
        NotificationType.R18_IMPORT_STARTED,
        "R18 import started",
        "Downloading latest dump from r18.dev",
    )
    _emit_r18_notification(
        NotificationType.R18_DOWNLOAD_STARTED,
        "R18 dump download started",
        f"Fetching dump from {url}",
    )
    threading.Thread(target=_worker, daemon=True, name="r18-import-url").start()
    return _import_status_model()


def save_uploaded_gz(content: bytes, original_filename: str) -> Path:
    """Write uploaded bytes to the R18 data directory.

    Args:
        content: Raw file bytes.
        original_filename: Client-provided filename.

    Returns:
        Path to the saved `.sql.gz` file.

    Raises:
        ValueError: If the filename is not a `.gz` archive.
    """
    _ensure_data_dir()
    safe_name = Path(original_filename).name
    if not safe_name.endswith(".gz"):
        raise ValueError("File must be a .sql.gz archive")
    dest = R18_DATA_DIR / safe_name
    dest.write_bytes(content)
    return dest


def download_sql_gz(
    url: str,
    dest_name: str = "latest.sql.gz",
    *,
    progress_callback: Callable[[int, int | None], None] | None = None,
) -> Path:
    """Download a remote `.sql.gz` dump to the R18 data directory.

    Args:
        url: HTTP(S) URL to fetch.
        dest_name: Local filename under R18_DATA_DIR.
        progress_callback: Optional `(bytes_done, total_bytes)` hook for status UI.

    Returns:
        Path to the downloaded file.
    """
    import httpx

    _ensure_data_dir()
    dest = R18_DATA_DIR / dest_name
    chunk_size = 1024 * 1024
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
    }
    with httpx.stream("GET", url, headers=headers, timeout=600, follow_redirects=True) as response:
        response.raise_for_status()
        content_length = response.headers.get("Content-Length")
        total_bytes = int(content_length) if content_length else None
        downloaded = 0
        if progress_callback:
            progress_callback(0, total_bytes)
        with open(dest, "wb") as out:
            for chunk in response.iter_bytes(chunk_size):
                out.write(chunk)
                downloaded += len(chunk)
                if progress_callback:
                    progress_callback(downloaded, total_bytes)
    return dest
