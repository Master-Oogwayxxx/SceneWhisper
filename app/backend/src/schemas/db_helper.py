import logging
import os
import re
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import Session, sessionmaker

# Database file location - stored in persistent volume
# Use the absolute path where you mounted the volume in docker-compose
DB_DIR = Path(os.getenv("DB_STORAGE_PATH", "/data"))
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "videoprocessor.db"

# SQLite database URL
DATABASE_URL = f"sqlite:///{DB_PATH}"

# Create engine with SQLite-specific settings
# SQLite is single-writer; a large pool starves WAL checkpoints because idle
# connections hold WAL reader references, preventing the WAL from being
# truncated. Keep the pool small so auto-checkpoint (see wal_autocheckpoint
# below) can complete between bursts of activity.
engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=3600,
    pool_pre_ping=True,
)


# Enable WAL mode and foreign key constraints for SQLite.
# WAL mode allows concurrent reads while a write is in progress, preventing
# write locks from freezing the async event loop when readers are on the main thread.
def _configure_sqlite(dbapi_conn, connection_record):
    dbapi_conn.create_function("REGEXP", 2, lambda pattern, value: bool(re.search(pattern, value or "")))
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")  # safe with WAL, faster than FULL
    cursor.execute("PRAGMA busy_timeout=5000")  # wait up to 5s instead of failing immediately
    # Checkpoint every 100 pages instead of the default 1000; with a small
    # pool (pool_size=5) checkpoints complete reliably, keeping the WAL small.
    cursor.execute("PRAGMA wal_autocheckpoint=100")
    cursor.close()


event.listen(engine, "connect", _configure_sqlite)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()


def _cleanup_orphaned_tasks():
    """Remove tasks whose files no longer exist in the database"""
    from .file import FileRecord
    from .task import TaskRecord

    db = SessionLocal()
    try:
        # Find tasks with file_ids that don't exist in the files table
        orphaned = db.query(TaskRecord).filter(~TaskRecord.file_id.in_(db.query(FileRecord.id))).all()

        if orphaned:
            count = len(orphaned)
            for task in orphaned:
                db.delete(task)
            db.commit()
            logging.info(f"Cleaned up {count} orphaned tasks with missing files")
    except Exception as e:
        # Log but don't fail startup if cleanup has issues (schema mismatch, etc)
        logging.warning(f"Could not clean up orphaned tasks on startup: {e}")
        db.rollback()
    finally:
        db.close()


def _ensure_ignore_patterns_column():
    """Add ignore_patterns column to settings table if absent (migration)."""
    with engine.connect() as conn:
        existing = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "ignore_patterns" not in existing:
            conn.execute(text("ALTER TABLE settings ADD COLUMN ignore_patterns TEXT"))
            conn.commit()
            logging.info("Migrated: added ignore_patterns column to settings")


def _ensure_merge_input_paths_column():
    """Add merge_input_paths column to tasks table if absent (migration)."""
    with engine.connect() as conn:
        existing = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)")).fetchall()]
        if "merge_input_paths" not in existing:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN merge_input_paths TEXT"))
            conn.commit()
            logging.info("Migrated: added merge_input_paths column to tasks")


def _ensure_selected_scan_directories_column() -> None:
    """Add selected_scan_directories column if it doesn't exist"""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)"))]
        if "selected_scan_directories" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN selected_scan_directories TEXT"))
            conn.commit()


def _ensure_task_scene_detector_column() -> None:
    """Add scene_detector column to tasks table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]
        if "scene_detector" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN scene_detector TEXT"))
            conn.commit()
            logging.info("Migrated: added scene_detector column to tasks")


def _ensure_task_bypass_split_guard_column() -> None:
    """Add bypass_split_guard column to tasks table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]
        if "bypass_split_guard" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN bypass_split_guard BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
            logging.info("Migrated: added bypass_split_guard column to tasks")


def _ensure_nvenc_overwrite_original_column() -> None:
    """Add nvenc_overwrite_original column to tasks table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)"))]
        if "nvenc_overwrite_original" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN nvenc_overwrite_original BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
            logging.info("Migrated: added nvenc_overwrite_original column to tasks")


def _ensure_scene_detector_settings_columns() -> None:
    """Add scene detector settings columns if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)"))]
        migrations = [
            ("scene_detector", "TEXT NOT NULL DEFAULT 'threshold'"),
            ("scene_content_threshold", "REAL NOT NULL DEFAULT 45"),
            ("scene_adaptive_threshold", "REAL NOT NULL DEFAULT 3.0"),
            ("scene_black_threshold", "REAL NOT NULL DEFAULT 12.0"),
            ("scene_white_threshold", "REAL NOT NULL DEFAULT 240.0"),
        ]
        for col, definition in migrations:
            if col not in cols:
                conn.execute(text(f"ALTER TABLE settings ADD COLUMN {col} {definition}"))
                logging.info(f"Migrated: added {col} column to settings")
        conn.commit()


def _ensure_paused_at_column() -> None:
    """Add paused_at column to tasks table if it doesn't exist (migration)."""
    inspector = inspect(engine)
    cols = [c["name"] for c in inspector.get_columns("tasks")]
    if "paused_at" not in cols:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN paused_at DATETIME"))
            conn.commit()
            logging.info("Migrated: added paused_at column to tasks")


def _ensure_stage_elapsed_columns() -> None:
    """Add per-stage elapsed_seconds columns to tasks table if absent (migration)."""
    with engine.connect() as conn:
        existing = {row[1] for row in conn.execute(text("PRAGMA table_info(tasks)")).fetchall()}
        for col in ("scene_elapsed_seconds", "split_elapsed_seconds", "subtitle_elapsed_seconds"):
            if col not in existing:
                conn.execute(text(f"ALTER TABLE tasks ADD COLUMN {col} INTEGER"))
        conn.commit()
        logging.info("Migrated: added per-stage elapsed_seconds columns to tasks")


def _ensure_queue_disabled_column() -> None:
    """Add queue-disable columns to files table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(files)")).fetchall()]
        if "queue_disabled" not in cols:
            conn.execute(text("ALTER TABLE files ADD COLUMN queue_disabled BOOLEAN NOT NULL DEFAULT 0"))
            logging.info("Migrated: added queue_disabled column to files")
        if "split_disabled" not in cols:
            conn.execute(text("ALTER TABLE files ADD COLUMN split_disabled BOOLEAN NOT NULL DEFAULT 0"))
            logging.info("Migrated: added split_disabled column to files")
        if "subtitle_disabled" not in cols:
            conn.execute(text("ALTER TABLE files ADD COLUMN subtitle_disabled BOOLEAN NOT NULL DEFAULT 0"))
            logging.info("Migrated: added subtitle_disabled column to files")
        conn.commit()


def _ensure_file_is_deleted_column() -> None:
    """Add is_deleted column to files table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(files)")).fetchall()]
        if "is_deleted" not in cols:
            conn.execute(text("ALTER TABLE files ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
            logging.info("Migrated: added is_deleted column to files")


def _ensure_file_filter_indexes() -> None:
    """Create indexes used by the server-backed File Browser filters."""
    with engine.connect() as conn:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_files_active_created_at ON files (is_deleted, created_at)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_files_active_directory ON files (is_deleted, directory_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_files_parent_type_active ON files (parent_id, file_type, is_deleted)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_files_active_type_status ON files (is_deleted, file_type, status)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_files_directory_name_active ON files (directory_id, name, is_deleted)"))
        conn.commit()


def _ensure_actress_work_file_state_table() -> None:
    """Create persistent local-file state table for actress works if absent."""
    with engine.connect() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS actress_work_file_state (
                    path TEXT PRIMARY KEY,
                    status TEXT NOT NULL DEFAULT 'present',
                    file_record_id TEXT,
                    file_name TEXT NOT NULL,
                    file_type TEXT,
                    first_seen_at DATETIME NOT NULL,
                    last_seen_at DATETIME NOT NULL,
                    deleted_at DATETIME
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_actress_work_file_state_file_record_id ON actress_work_file_state (file_record_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_actress_work_file_state_file_name ON actress_work_file_state (file_name)"))
        conn.commit()


def _ensure_deleted_files_table() -> None:
    """Create persistent deleted-file ledger if absent."""
    with engine.connect() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS deleted_files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_record_id TEXT,
                    name TEXT NOT NULL,
                    path TEXT NOT NULL,
                    size INTEGER,
                    file_type TEXT,
                    format TEXT,
                    sha256 TEXT,
                    directory_id TEXT,
                    deleted_at DATETIME NOT NULL,
                    original_created_at DATETIME,
                    original_modified_at DATETIME,
                    reason TEXT NOT NULL DEFAULT 'unknown',
                    source TEXT NOT NULL DEFAULT 'app'
                )
                """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_deleted_files_file_record_id ON deleted_files (file_record_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_deleted_files_path ON deleted_files (path)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_deleted_files_directory_id ON deleted_files (directory_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_deleted_files_deleted_at ON deleted_files (deleted_at)"))
        conn.commit()


def _ensure_queue_position_column() -> None:
    """Add queue_position column to tasks table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(tasks)")).fetchall()]
        if "queue_position" not in cols:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN queue_position INTEGER"))
            conn.commit()
            logging.info("Migrated: added queue_position column to tasks")


def _ensure_fill_missing_subtitles_column() -> None:
    """Add fill_missing_subtitles column to directory_monitors table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(directory_monitors)")).fetchall()]
        if "fill_missing_subtitles" not in cols:
            conn.execute(text("ALTER TABLE directory_monitors ADD COLUMN fill_missing_subtitles BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
            logging.info("Migrated: added fill_missing_subtitles column to directory_monitors")


def _ensure_directory_monitor_split_scope_column() -> None:
    """Add the split category selector to existing directory monitor tables."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(directory_monitors)")).fetchall()]
        if "split_scope" not in cols:
            conn.execute(text("ALTER TABLE directory_monitors ADD COLUMN split_scope TEXT NOT NULL DEFAULT 'both'"))
            conn.commit()
            logging.info("Migrated: added split_scope column to directory_monitors")


def _ensure_directory_monitor_task_types_column() -> None:
    """Add multi-task selector storage to existing directory monitor tables."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(directory_monitors)")).fetchall()]
        if "task_types" not in cols:
            conn.execute(text("ALTER TABLE directory_monitors ADD COLUMN task_types TEXT"))
            conn.execute(text("UPDATE directory_monitors SET task_types = '[\"' || task_type || '\"]' WHERE task_types IS NULL"))
            conn.commit()
            logging.info("Migrated: added task_types column to directory_monitors")


def _ensure_directory_monitor_nvenc_overwrite_original_column() -> None:
    """Add frame-pacing overwrite-original storage to existing directory monitor tables."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(directory_monitors)")).fetchall()]
        if "nvenc_overwrite_original" not in cols:
            conn.execute(text("ALTER TABLE directory_monitors ADD COLUMN nvenc_overwrite_original BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
            logging.info("Migrated: added nvenc_overwrite_original column to directory_monitors")


def _ensure_directory_monitor_frame_pacing_scope_column() -> None:
    """Add frame-pacing candidate scope storage to existing directory monitor tables."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(directory_monitors)")).fetchall()]
        if "frame_pacing_scope" not in cols:
            conn.execute(text("ALTER TABLE directory_monitors ADD COLUMN frame_pacing_scope TEXT NOT NULL DEFAULT 'all'"))
            conn.commit()
            logging.info("Migrated: added frame_pacing_scope column to directory_monitors")


def _ensure_directory_monitor_frame_pacing_resolution_column() -> None:
    """Add frame-pacing resolution filter storage to existing directory monitor tables."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(directory_monitors)")).fetchall()]
        if "frame_pacing_resolution" not in cols:
            conn.execute(text("ALTER TABLE directory_monitors ADD COLUMN frame_pacing_resolution TEXT NOT NULL DEFAULT 'all'"))
            conn.commit()
            logging.info("Migrated: added frame_pacing_resolution column to directory_monitors")


def _ensure_directory_monitor_schedule_timezone_column() -> None:
    """Add browser timezone storage to existing directory monitor tables."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(directory_monitors)")).fetchall()]
        if "schedule_timezone" not in cols:
            conn.execute(text("ALTER TABLE directory_monitors ADD COLUMN schedule_timezone TEXT"))
            conn.commit()
            logging.info("Migrated: added schedule_timezone column to directory_monitors")


def _ensure_concurrency_columns() -> None:
    """Add concurrency and subtitle GPU settings columns to settings if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "scene_detection_concurrency" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN scene_detection_concurrency INTEGER NOT NULL DEFAULT 1"))
            logging.info("Migrated: added scene_detection_concurrency column to settings")
        if "frame_pacing_analyzer_concurrency" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN frame_pacing_analyzer_concurrency INTEGER NOT NULL DEFAULT 4"))
            logging.info("Migrated: added frame_pacing_analyzer_concurrency column to settings")
        if "frame_pacing_analyzer_timeout_minutes" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN frame_pacing_analyzer_timeout_minutes INTEGER NOT NULL DEFAULT 30"))
            logging.info("Migrated: added frame_pacing_analyzer_timeout_minutes column to settings")
        if "split_concurrency" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN split_concurrency INTEGER NOT NULL DEFAULT 3"))
            logging.info("Migrated: added split_concurrency column to settings")
        if "split_gpu_required" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN split_gpu_required BOOLEAN NOT NULL DEFAULT 0"))
            logging.info("Migrated: added split_gpu_required column to settings")
        if "subtitle_concurrency" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN subtitle_concurrency INTEGER NOT NULL DEFAULT 2"))
            logging.info("Migrated: added subtitle_concurrency column to settings")
        if "subtitle_gpu_required" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN subtitle_gpu_required BOOLEAN NOT NULL DEFAULT 0"))
            logging.info("Migrated: added subtitle_gpu_required column to settings")
        conn.commit()


def _ensure_split_min_video_duration_column() -> None:
    """Add split_min_video_duration_seconds setting if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "split_min_video_duration_seconds" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN split_min_video_duration_seconds INTEGER NOT NULL DEFAULT 0"))
            logging.info("Migrated: added split_min_video_duration_seconds column to settings")
        conn.commit()


def _ensure_task_type_priority_column() -> None:
    """Add task_type_priority column to settings if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "task_type_priority" not in cols:
            conn.execute(text('ALTER TABLE settings ADD COLUMN task_type_priority TEXT DEFAULT \'["all","merge","subtitle","split","scene","analyze_frame_pacing","nvenc_frame_pacing","remux"]\''))
            conn.commit()
            logging.info("Migrated: added task_type_priority column to settings")


def _ensure_auto_cleanup_on_scan_column() -> None:
    """Add auto_cleanup_on_scan column to settings if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "auto_cleanup_on_scan" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN auto_cleanup_on_scan BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
            logging.info("Migrated: added auto_cleanup_on_scan column to settings")


def _ensure_scan_schedule_columns() -> None:
    """Add scan schedule settings columns if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        for col, ddl in [
            ("scan_schedule_enabled", "BOOLEAN NOT NULL DEFAULT 0"),
            ("scan_schedule_time", "TEXT"),
            ("scan_schedule_time_zone", "TEXT"),
            ("scan_schedule_mode", "TEXT NOT NULL DEFAULT 'all'"),
            ("scan_schedule_day_of_week", "INTEGER"),
            ("scan_schedule_last_run", "TEXT"),
            ("scan_schedule_next_run", "TEXT"),
            ("scan_schedule_last_error", "TEXT"),
        ]:
            if col not in cols:
                conn.execute(text(f"ALTER TABLE settings ADD COLUMN {col} {ddl}"))
                logging.info("Migrated: added %s column to settings", col)
        conn.commit()


def _ensure_saved_file_filters_column() -> None:
    """Add saved_file_filters column to settings if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "saved_file_filters" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN saved_file_filters TEXT"))
            conn.commit()
            logging.info("Migrated: added saved_file_filters column to settings")


def _ensure_show_actress_work_covers_column() -> None:
    """Add show_actress_work_covers column to settings if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "show_actress_work_covers" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN show_actress_work_covers BOOLEAN NOT NULL DEFAULT 0"))
            conn.commit()
            logging.info("Migrated: added show_actress_work_covers column to settings")


def _ensure_show_actress_work_titles_column() -> None:
    """Add show_actress_work_titles column to settings if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "show_actress_work_titles" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN show_actress_work_titles BOOLEAN NOT NULL DEFAULT 1"))
            conn.commit()
            logging.info("Migrated: added show_actress_work_titles column to settings")


def _ensure_external_video_targets_column() -> None:
    """Add external_video_targets column to settings if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "external_video_targets" not in cols:
            conn.execute(text('ALTER TABLE settings ADD COLUMN external_video_targets TEXT NOT NULL DEFAULT \'[{"label":"Google","url_template":"https://www.google.com/search?q={videoCode}"}]\''))
            conn.commit()
            logging.info("Migrated: added external_video_targets column to settings")


def _ensure_scraper_templates_column() -> None:
    """Add scraper_templates column to settings if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "scraper_templates" not in cols:
            conn.execute(text('ALTER TABLE settings ADD COLUMN scraper_templates TEXT NOT NULL DEFAULT \'[{"label":"JavPlayer","url_template":"https://javplayer.org/model/{actress_name}"}]\''))
            conn.commit()
            logging.info("Migrated: added scraper_templates column to settings")


def _ensure_actress_favorites_column() -> None:
    """Add actress_favorites column to settings if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "actress_favorites" not in cols:
            conn.execute(text("ALTER TABLE settings ADD COLUMN actress_favorites TEXT"))
            conn.commit()
            logging.info("Migrated: added actress_favorites column to settings")


def _ensure_processing_hours_windows_column() -> None:
    """Add per-day processing hour windows to settings if absent."""
    default_windows = (
        '{"mon":{"start":2,"end":19},"tue":{"start":2,"end":19},'
        '"wed":{"start":2,"end":19},"thu":{"start":2,"end":19},'
        '"fri":{"start":2,"end":19},"sat":{"start":2,"end":19},'
        '"sun":{"start":2,"end":19}}'
    )
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        if "processing_hours_windows" not in cols:
            conn.exec_driver_sql(f"ALTER TABLE settings ADD COLUMN processing_hours_windows TEXT NOT NULL DEFAULT '{default_windows}'")
            conn.commit()
            logging.info("Migrated: added processing_hours_windows column to settings")


def _ensure_r18_auto_refresh_columns() -> None:
    """Add R18 auto-refresh settings columns if absent."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        for col, ddl in [
            ("r18_auto_refresh_enabled", "BOOLEAN NOT NULL DEFAULT 0"),
            ("r18_auto_refresh_time", "TEXT"),
            ("r18_auto_refresh_day_of_week", "INTEGER"),
            ("r18_auto_refresh_last_run", "TEXT"),
            ("r18_auto_refresh_next_run", "TEXT"),
            ("r18_auto_refresh_last_error", "TEXT"),
        ]:
            if col not in cols:
                conn.execute(text(f"ALTER TABLE settings ADD COLUMN {col} {ddl}"))
                logging.info(f"Migrated: added {col} column to settings")
        conn.commit()


def _ensure_qbittorrent_columns() -> None:
    """Add qBittorrent settings columns if missing (schema migration)."""
    conn = engine.raw_connection()
    try:
        cur = conn.cursor()
        existing = {row[1] for row in cur.execute("PRAGMA table_info(settings)")}
        for col, ddl in [
            ("qbittorrent_url", "TEXT NOT NULL DEFAULT ''"),
            ("qbittorrent_username", "TEXT NOT NULL DEFAULT ''"),
            ("qbittorrent_password", "TEXT NOT NULL DEFAULT ''"),
        ]:
            if col not in existing:
                cur.execute(f"ALTER TABLE settings ADD COLUMN {col} {ddl}")
        conn.commit()
    finally:
        conn.close()


def _ensure_torrent_tracking_table() -> None:
    """Create torrent_tracking table if it doesn't exist (migration)."""
    with engine.connect() as conn:
        conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS torrent_tracking (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_code TEXT NOT NULL,
                torrent_hash TEXT UNIQUE,
                torrent_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'downloading',
                added_at DATETIME NOT NULL,
                completed_at DATETIME
            )
            """
            )
        )
        conn.commit()
        logging.info("Migration: ensured torrent_tracking table exists")


def _ensure_download_queue_table() -> None:
    """Create download_queue table if it doesn't exist (migration)."""
    with engine.connect() as conn:
        conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS download_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_code TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT,
                added_at DATETIME NOT NULL,
                processed_at DATETIME,
                torrent_url TEXT,
                save_path TEXT,
                position INTEGER NOT NULL DEFAULT 0
            )
            """
            )
        )
        conn.commit()
        logging.info("Migration: ensured download_queue table exists")


def _ensure_frame_pacing_analysis_runs_table() -> None:
    """Create persisted frame-pacing analysis runs table if absent."""
    with engine.connect() as conn:
        conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS frame_pacing_analysis_runs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL DEFAULT 'queued',
                file_ids_json TEXT NOT NULL DEFAULT '[]',
                results_json TEXT NOT NULL DEFAULT '[]',
                progress_json TEXT NOT NULL DEFAULT '{}',
                total INTEGER NOT NULL DEFAULT 0,
                done INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                created_at DATETIME NOT NULL,
                started_at DATETIME,
                completed_at DATETIME
            )
            """
            )
        )
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(frame_pacing_analysis_runs)")).fetchall()]
        if "progress_json" not in cols:
            conn.execute(text("ALTER TABLE frame_pacing_analysis_runs ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}'"))
        conn.commit()
        logging.info("Migration: ensured frame_pacing_analysis_runs table exists")


def _ensure_torrent_tracking_content_id_column() -> None:
    """Add content_id column to torrent_tracking table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(torrent_tracking)")).fetchall()]
        if "content_id" not in cols:
            conn.execute(text("ALTER TABLE torrent_tracking ADD COLUMN content_id TEXT"))
            conn.commit()
            logging.info("Migrated: added content_id column to torrent_tracking")


def _ensure_download_queue_content_id_column() -> None:
    """Add content_id column to download_queue table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(download_queue)")).fetchall()]
        if "content_id" not in cols:
            conn.execute(text("ALTER TABLE download_queue ADD COLUMN content_id TEXT"))
            conn.commit()
            logging.info("Migrated: added content_id column to download_queue")


def _ensure_download_queue_failed_torrent_urls_column() -> None:
    """Add failed_torrent_urls column to download_queue table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(download_queue)")).fetchall()]
        if "failed_torrent_urls" not in cols:
            conn.execute(text("ALTER TABLE download_queue ADD COLUMN failed_torrent_urls TEXT NOT NULL DEFAULT '[]'"))
            conn.commit()
            logging.info("Migrated: added failed_torrent_urls column to download_queue")


def _ensure_download_queue_save_path_column() -> None:
    """Add save_path column to download_queue table if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(download_queue)")).fetchall()]
        if "save_path" not in cols:
            conn.execute(text("ALTER TABLE download_queue ADD COLUMN save_path TEXT"))
            conn.commit()
            logging.info("Migrated: added save_path column to download_queue")


def _ensure_actress_work_state_table() -> None:
    """Create the actress_work_state table if it doesn't exist (migration)."""
    with engine.connect() as conn:
        conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS actress_work_state (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content_id TEXT NOT NULL UNIQUE,
                is_opened BOOLEAN NOT NULL DEFAULT 0
            )
            """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_actress_work_state_content_id ON actress_work_state (content_id)"))
        conn.commit()
        logging.info("Migration: ensured actress_work_state table exists")


def _ensure_actress_download_monitors_table() -> None:
    """Create actress_download_monitors table if it doesn't exist (migration)."""
    with engine.connect() as conn:
        conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS actress_download_monitors (
                id TEXT PRIMARY KEY,
                actress_id INTEGER NOT NULL,
                actress_name TEXT NOT NULL,
                schedule_interval TEXT NOT NULL,
                schedule_time TEXT,
                schedule_day_of_week INTEGER,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                criteria TEXT NOT NULL DEFAULT '{}',
                max_items_per_run INTEGER NOT NULL DEFAULT 25,
                save_path TEXT,
                last_run DATETIME,
                next_run DATETIME,
                last_queued INTEGER NOT NULL DEFAULT 0,
                last_skipped INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
            """
            )
        )
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(actress_download_monitors)")).fetchall()]
        if "save_path" not in cols:
            conn.execute(text("ALTER TABLE actress_download_monitors ADD COLUMN save_path TEXT"))
            logging.info("Migrated: added save_path column to actress_download_monitors")
        conn.commit()
        logging.info("Migration: ensured actress_download_monitors table exists")


def _ensure_scraper_tables() -> None:
    """Create scraper source and video tables if they do not exist."""
    with engine.connect() as conn:
        conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS scraper_sources (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                urls TEXT,
                url_actress_name_reversed TEXT,
                schedule_interval TEXT NOT NULL,
                schedule_time TEXT,
                schedule_day_of_week INTEGER,
                schedule_timezone TEXT,
                is_active BOOLEAN NOT NULL DEFAULT 1,
                last_run DATETIME,
                next_run DATETIME,
                last_found INTEGER NOT NULL DEFAULT 0,
                last_new INTEGER NOT NULL DEFAULT 0,
                last_pages_scraped INTEGER NOT NULL DEFAULT 0,
                last_website_stats TEXT,
                last_error TEXT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
            """
            )
        )
        conn.execute(
            text(
                """
            CREATE TABLE IF NOT EXISTS scraped_videos (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                source_url TEXT,
                video_code TEXT NOT NULL,
                title TEXT,
                url TEXT,
                uncensored BOOLEAN,
                censored BOOLEAN,
                subtitled BOOLEAN,
                opened BOOLEAN NOT NULL DEFAULT 0,
                opened_at DATETIME,
                scraped_at DATETIME NOT NULL,
                first_seen_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
            """
            )
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_scraper_sources_id ON scraper_sources (id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_scraped_videos_source_id ON scraped_videos (source_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_scraped_videos_video_code ON scraped_videos (video_code)"))
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(scraper_sources)")).fetchall()]
        if "urls" not in cols:
            conn.execute(text("ALTER TABLE scraper_sources ADD COLUMN urls TEXT"))
            logging.info("Migrated: added urls column to scraper_sources")
        if "url_actress_name_reversed" not in cols:
            conn.execute(text("ALTER TABLE scraper_sources ADD COLUMN url_actress_name_reversed TEXT"))
            logging.info("Migrated: added url_actress_name_reversed column to scraper_sources")
        if "schedule_timezone" not in cols:
            conn.execute(text("ALTER TABLE scraper_sources ADD COLUMN schedule_timezone TEXT"))
            logging.info("Migrated: added schedule_timezone column to scraper_sources")
        if "last_pages_scraped" not in cols:
            conn.execute(text("ALTER TABLE scraper_sources ADD COLUMN last_pages_scraped INTEGER NOT NULL DEFAULT 0"))
            logging.info("Migrated: added last_pages_scraped column to scraper_sources")
        if "last_website_stats" not in cols:
            conn.execute(text("ALTER TABLE scraper_sources ADD COLUMN last_website_stats TEXT"))
            logging.info("Migrated: added last_website_stats column to scraper_sources")
        video_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(scraped_videos)")).fetchall()]
        if "source_url" not in video_cols:
            conn.execute(text("ALTER TABLE scraped_videos ADD COLUMN source_url TEXT"))
            logging.info("Migrated: added source_url column to scraped_videos")
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_scraped_videos_source_url ON scraped_videos (source_url)"))
        for name in ("uncensored", "censored", "subtitled"):
            if name not in video_cols:
                conn.execute(text(f"ALTER TABLE scraped_videos ADD COLUMN {name} BOOLEAN"))
                logging.info("Migrated: added %s column to scraped_videos", name)
        if "opened" not in video_cols:
            conn.execute(text("ALTER TABLE scraped_videos ADD COLUMN opened BOOLEAN NOT NULL DEFAULT 0"))
            logging.info("Migrated: added opened column to scraped_videos")
        if "opened_at" not in video_cols:
            conn.execute(text("ALTER TABLE scraped_videos ADD COLUMN opened_at DATETIME"))
            logging.info("Migrated: added opened_at column to scraped_videos")
        conn.commit()
        logging.info("Migration: ensured scraper tables exist")


def _ensure_bulk_download_settings_columns() -> None:
    """Add bulk download queue settings columns if absent (migration)."""
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(settings)")).fetchall()]
        for col, ddl in [
            ("queue_base_delay_seconds", "INTEGER NOT NULL DEFAULT 60"),
            ("queue_jitter_seconds", "INTEGER NOT NULL DEFAULT 30"),
            ("queue_window_start_hour", "INTEGER NOT NULL DEFAULT 0"),
            ("queue_window_end_hour", "INTEGER NOT NULL DEFAULT 0"),
            ("queue_download_time_limit_minutes", "INTEGER NOT NULL DEFAULT 0"),
        ]:
            if col not in cols:
                conn.execute(text(f"ALTER TABLE settings ADD COLUMN {col} {ddl}"))
                logging.info(f"Migrated: added {col} column to settings")
        conn.commit()


_DROP_FFMPEG_SPLIT_COLUMNS = frozenset({"ffmpeg_cq", "ffmpeg_preset"})


def _drop_ffmpeg_split_settings_columns() -> None:
    """Remove legacy ffmpeg_cq/ffmpeg_preset columns from settings if present."""
    db = SessionLocal()
    try:
        columns = db.execute(text("PRAGMA table_info(settings)")).fetchall()
        existing_names = {col[1] for col in columns}
        if not _DROP_FFMPEG_SPLIT_COLUMNS.intersection(existing_names):
            return

        retained_columns = [col for col in columns if col[1] not in _DROP_FFMPEG_SPLIT_COLUMNS]
        retained_names = [col[1] for col in retained_columns]

        column_defs: list[str] = []
        for _, name, col_type, notnull, default_value, pk in retained_columns:
            parts = [name, col_type]
            if pk:
                parts.append("PRIMARY KEY")
            if notnull:
                parts.append("NOT NULL")
            if default_value is not None:
                parts.append(f"DEFAULT {default_value}")
            column_defs.append(" ".join(parts))

        columns_sql = ", ".join(column_defs)
        names_sql = ", ".join(retained_names)

        db.execute(text("ALTER TABLE settings RENAME TO settings_legacy"))
        db.execute(text(f"CREATE TABLE settings ({columns_sql})"))
        db.execute(text(f"INSERT INTO settings ({names_sql}) SELECT {names_sql} FROM settings_legacy"))
        db.execute(text("DROP TABLE settings_legacy"))
        db.commit()
        logging.info("Migrated: dropped ffmpeg_cq and ffmpeg_preset columns from settings")
    finally:
        db.close()


def init_db():
    """Initialize database tables"""
    from ..log_handler import mark_db_ready

    Base.metadata.create_all(bind=engine)
    _ensure_ignore_patterns_column()
    _ensure_merge_input_paths_column()
    _ensure_selected_scan_directories_column()
    _ensure_task_scene_detector_column()
    _ensure_task_bypass_split_guard_column()
    _ensure_nvenc_overwrite_original_column()
    _ensure_scene_detector_settings_columns()
    _ensure_paused_at_column()
    _ensure_stage_elapsed_columns()
    _ensure_queue_disabled_column()
    _ensure_file_is_deleted_column()
    _ensure_file_filter_indexes()
    _ensure_actress_work_file_state_table()
    _ensure_deleted_files_table()
    _ensure_fill_missing_subtitles_column()
    _ensure_directory_monitor_split_scope_column()
    _ensure_directory_monitor_task_types_column()
    _ensure_directory_monitor_nvenc_overwrite_original_column()
    _ensure_directory_monitor_frame_pacing_scope_column()
    _ensure_directory_monitor_frame_pacing_resolution_column()
    _ensure_directory_monitor_schedule_timezone_column()
    _ensure_queue_position_column()
    _ensure_concurrency_columns()
    _ensure_split_min_video_duration_column()
    _ensure_task_type_priority_column()
    _ensure_auto_cleanup_on_scan_column()
    _ensure_scan_schedule_columns()
    _ensure_saved_file_filters_column()
    _ensure_show_actress_work_covers_column()
    _ensure_show_actress_work_titles_column()
    _ensure_external_video_targets_column()
    _ensure_scraper_templates_column()
    _ensure_actress_favorites_column()
    _ensure_processing_hours_windows_column()
    _ensure_r18_auto_refresh_columns()
    _ensure_qbittorrent_columns()
    _ensure_torrent_tracking_table()
    _ensure_download_queue_table()
    _ensure_frame_pacing_analysis_runs_table()
    _ensure_bulk_download_settings_columns()
    _ensure_torrent_tracking_content_id_column()
    _ensure_download_queue_content_id_column()
    _ensure_download_queue_failed_torrent_urls_column()
    _ensure_download_queue_save_path_column()
    _ensure_actress_work_state_table()
    _drop_ffmpeg_split_settings_columns()
    _ensure_actress_download_monitors_table()
    _ensure_scraper_tables()
    _cleanup_orphaned_tasks()
    mark_db_ready()


def get_db() -> Session:
    """Open a database session. Caller must call close_db when finished."""
    db = SessionLocal()
    return db


def db_session():
    """FastAPI dependency that yields a session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logging.error(f"Database session error: {e}")
        raise
    finally:
        db.close()


def close_db(db: Session):
    """Close database session (for manual session lifecycle outside Depends)."""
    db.close()


from .actress_download_monitor import ActressDownloadMonitorRecord as _adm  # noqa: E402, F401
from .download_queue import DownloadQueueRecord as _dq  # noqa: E402, F401
from .frame_pacing_analysis import FramePacingAnalysisRunRecord as _frame_pacing_analysis  # noqa: E402, F401

# Register notification table with Base (imported after Base is defined)
from .actress_work_state import ActressWorkStateRecord as _actress_work_state  # noqa: E402, F401
from .deleted_file import DeletedFileRecord as _deleted_file  # noqa: E402, F401
from .log import LogRecord as _log  # noqa: E402, F401
from .notification import NotificationRecord as _  # noqa: E402, F401
from .scraper import ScrapedVideoRecord as _scraped_video  # noqa: E402, F401
from .scraper import ScraperSourceRecord as _scraper_source  # noqa: E402, F401
from .torrent_tracking import TorrentTrackingRecord as _torrent  # noqa: E402, F401
