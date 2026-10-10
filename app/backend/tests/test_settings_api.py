from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

import src.schemas.db_helper as dbh
from src.schemas.db_helper import Base
from src.schemas.download_queue import DownloadQueueRecord  # noqa: F401
from src.schemas.file import FileRecord  # noqa: F401
from src.schemas.log import LogRecord  # noqa: F401
from src.schemas.notification import NotificationRecord  # noqa: F401
from src.schemas.setting import SettingRecord  # Import to register ORM model
from src.schemas.task import TaskRecord  # noqa: F401
from src.schemas.torrent_tracking import TorrentTrackingRecord  # noqa: F401
from src.schemas.directory import DirectoryRecord  # noqa: F401


def _rebuild_settings_table_without_column(column_name: str) -> None:
    db = dbh.SessionLocal()
    try:
        columns = db.execute(text("PRAGMA table_info(settings)")).fetchall()
        retained_columns = [col for col in columns if col[1] != column_name]
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
    finally:
        db.close()


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Each test gets its own isolated DB."""
    db_path = tmp_path / "test.db"
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    yield


@pytest.fixture()
def test_client(isolated_db):
    """Return a TestClient for the settings API."""
    from src.schemas.setting import SettingRecord

    # Create a default settings record
    db = dbh.SessionLocal()
    db.add(SettingRecord())
    db.commit()
    db.close()

    import importlib
    import src.api.settings as settings_mod

    importlib.reload(settings_mod)

    app = FastAPI()
    app.include_router(settings_mod.router)
    return TestClient(app)


def test_get_settings_includes_task_type_priority(test_client: TestClient):
    resp = test_client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert "task_type_priority" in data
    assert isinstance(data["task_type_priority"], list)


def test_get_settings_includes_default_external_video_targets(test_client: TestClient):
    resp = test_client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["external_video_targets"] == [
        {
            "label": "Google",
            "url_template": "https://www.google.com/search?q={videoCode}",
        }
    ]


def test_get_settings_includes_r18_auto_refresh_fields(test_client: TestClient):
    resp = test_client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["r18_auto_refresh_enabled"] is False
    assert data["r18_auto_refresh_time"] is None
    assert data["r18_auto_refresh_day_of_week"] is None
    assert data["r18_auto_refresh_last_run"] is None
    assert data["r18_auto_refresh_next_run"] is None
    assert data["r18_auto_refresh_last_error"] is None


def test_get_settings_includes_queue_download_time_limit(test_client: TestClient):
    resp = test_client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["queue_download_time_limit_minutes"] == 0


def test_get_settings_includes_processing_hours_windows(test_client: TestClient):
    resp = test_client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.json()
    assert data["processing_hours_windows"]["mon"] == {"start": 2, "end": 19}
    assert data["processing_hours_windows"]["sun"] == {"start": 2, "end": 19}


def test_patch_settings_persists_split_min_video_duration(test_client: TestClient):
    resp = test_client.patch("/api/settings", json={"split_min_video_duration_seconds": 180})

    assert resp.status_code == 200
    assert resp.json()["split_min_video_duration_seconds"] == 180


def test_patch_settings_clamps_frame_pacing_analyzer_concurrency(test_client: TestClient):
    resp = test_client.patch("/api/settings", json={"frame_pacing_analyzer_concurrency": 99})

    assert resp.status_code == 200
    assert resp.json()["frame_pacing_analyzer_concurrency"] == 8


def test_patch_settings_clamps_frame_pacing_analyzer_timeout(test_client: TestClient):
    resp = test_client.patch("/api/settings", json={"frame_pacing_analyzer_timeout_minutes": 999})

    assert resp.status_code == 200
    assert resp.json()["frame_pacing_analyzer_timeout_minutes"] == 240


def test_patch_settings_task_type_priority_calls_rerank(test_client: TestClient):
    new_order = ["scene", "split", "subtitle", "merge", "all"]
    mock_rerank = AsyncMock()
    with patch("src.api.settings.task_manager.rerank_queue", mock_rerank):
        resp = test_client.patch("/api/settings", json={"task_type_priority": new_order})
    assert resp.status_code == 200
    mock_rerank.assert_awaited_once_with(new_order)


def test_patch_settings_persists_external_video_targets(test_client: TestClient):
    targets = [
        {
            "label": "Google",
            "url_template": "https://www.google.com/search?q={videoCode}",
        },
        {
            "label": "Alt",
            "url_template": "https://example.com/?id={videoCode}",
        },
    ]

    resp = test_client.patch("/api/settings", json={"external_video_targets": targets})

    assert resp.status_code == 200
    assert resp.json()["external_video_targets"] == targets


def test_patch_settings_persists_r18_auto_refresh_fields(test_client: TestClient):
    payload = {
        "r18_auto_refresh_enabled": True,
        "r18_auto_refresh_time": "09:00",
        "r18_auto_refresh_day_of_week": 1,
        "r18_auto_refresh_last_run": "2026-07-07T16:00:00Z",
    }

    resp = test_client.patch("/api/settings", json=payload)

    assert resp.status_code == 200
    for key, value in payload.items():
        assert resp.json()[key] == value
    assert resp.json()["r18_auto_refresh_next_run"] is not None
    assert resp.json()["r18_auto_refresh_last_error"] is None


def test_patch_settings_persists_queue_download_time_limit(test_client: TestClient):
    resp = test_client.patch("/api/settings", json={"queue_download_time_limit_minutes": 45})

    assert resp.status_code == 200
    assert resp.json()["queue_download_time_limit_minutes"] == 45


def test_patch_settings_persists_processing_hours_windows(test_client: TestClient):
    windows = {
        "mon": {"start": 1, "end": 8},
        "tue": {"start": 2, "end": 9},
        "wed": {"start": 3, "end": 10},
        "thu": {"start": 4, "end": 11},
        "fri": {"start": 5, "end": 12},
        "sat": {"start": 6, "end": 13},
        "sun": {"start": 7, "end": 14},
    }

    resp = test_client.patch("/api/settings", json={"processing_hours_windows": windows})

    assert resp.status_code == 200
    assert resp.json()["processing_hours_windows"] == windows


def test_patch_settings_computes_next_run_when_enabling_r18_auto_refresh(test_client: TestClient):
    with patch("src.api.settings.calculate_next_run") as mock_calculate:
        mock_calculate.return_value = __import__("datetime").datetime(2026, 7, 14, 16, 0, 0)
        resp = test_client.patch(
            "/api/settings",
            json={
                "r18_auto_refresh_enabled": True,
                "r18_auto_refresh_time": "16:00",
                "r18_auto_refresh_day_of_week": 1,
            },
        )

    assert resp.status_code == 200
    assert resp.json()["r18_auto_refresh_next_run"] == "2026-07-14T16:00:00Z"
    mock_calculate.assert_called_once_with(
        {"interval": "weekly", "time": "16:00", "dayOfWeek": 1}
    )


def test_patch_settings_computes_scan_next_run_with_browser_timezone(test_client: TestClient):
    with patch("src.api.settings.calculate_next_run") as mock_calculate:
        mock_calculate.return_value = __import__("datetime").datetime(2026, 9, 6, 16, 0, 0)
        resp = test_client.patch(
            "/api/settings",
            json={
                "scan_schedule_enabled": True,
                "scan_schedule_time": "09:00",
                "scan_schedule_time_zone": "America/Los_Angeles",
            },
        )

    assert resp.status_code == 200
    assert resp.json()["scan_schedule_time"] == "09:00"
    assert resp.json()["scan_schedule_time_zone"] == "America/Los_Angeles"
    assert resp.json()["scan_schedule_next_run"] == "2026-09-06T16:00:00Z"
    mock_calculate.assert_called_once_with(
        {"interval": "daily", "time": "09:00", "timeZone": "America/Los_Angeles"}
    )


def test_get_actress_favorites_returns_empty_list(test_client: TestClient):
    resp = test_client.get("/api/settings/actress-favorites")

    assert resp.status_code == 200
    assert resp.json() == {"actress_ids": []}


def test_get_settings_omits_actress_favorites(test_client: TestClient):
    resp = test_client.get("/api/settings")

    assert resp.status_code == 200
    assert "actress_favorites" not in resp.json()


def test_put_actress_favorites_persists_deduplicated_ids(test_client: TestClient):
    resp = test_client.put("/api/settings/actress-favorites", json={"actress_ids": [5, 3, 5, 9]})

    assert resp.status_code == 200
    assert resp.json() == {"actress_ids": [5, 3, 9]}

    follow_up = test_client.get("/api/settings/actress-favorites")
    assert follow_up.status_code == 200
    assert follow_up.json() == {"actress_ids": [5, 3, 9]}


def test_put_actress_favorites_rejects_non_integer_ids(test_client: TestClient):
    resp = test_client.put("/api/settings/actress-favorites", json={"actress_ids": [1, "bad"]})

    assert resp.status_code == 422


@pytest.mark.parametrize("invalid_value", ["1", True, False, 0, -7])
def test_put_actress_favorites_rejects_non_positive_or_coerced_ids(
    test_client: TestClient,
    invalid_value,
):
    resp = test_client.put("/api/settings/actress-favorites", json={"actress_ids": [1, invalid_value]})

    assert resp.status_code == 422


def test_patch_settings_cannot_write_actress_favorites(test_client: TestClient):
    put_resp = test_client.put("/api/settings/actress-favorites", json={"actress_ids": [4, 2]})
    assert put_resp.status_code == 200

    patch_resp = test_client.patch("/api/settings", json={"actress_favorites": [99]})
    assert patch_resp.status_code == 200
    assert "actress_favorites" not in patch_resp.json()

    follow_up = test_client.get("/api/settings/actress-favorites")
    assert follow_up.status_code == 200
    assert follow_up.json() == {"actress_ids": [4, 2]}


def test_init_db_migrates_legacy_settings_table_for_actress_favorites(isolated_db):
    db = dbh.SessionLocal()
    db.add(SettingRecord())
    db.commit()
    db.close()

    _rebuild_settings_table_without_column("actress_favorites")

    with patch("src.log_handler.mark_db_ready", lambda: None):
        dbh.init_db()

    db = dbh.SessionLocal()
    try:
        columns = [row[1] for row in db.execute(text("PRAGMA table_info(settings)")).fetchall()]
        assert "actress_favorites" in columns
    finally:
        db.close()

    import importlib
    import src.api.settings as settings_mod

    importlib.reload(settings_mod)

    app = FastAPI()
    app.include_router(settings_mod.router)
    client = TestClient(app)

    get_resp = client.get("/api/settings/actress-favorites")
    assert get_resp.status_code == 200
    assert get_resp.json() == {"actress_ids": []}

    put_resp = client.put("/api/settings/actress-favorites", json={"actress_ids": [8, 8, 1]})
    assert put_resp.status_code == 200
    assert put_resp.json() == {"actress_ids": [8, 1]}


def test_init_db_migrates_legacy_settings_table_for_processing_hours_windows(isolated_db):
    db = dbh.SessionLocal()
    db.add(SettingRecord())
    db.commit()
    db.close()
    _rebuild_settings_table_without_column("processing_hours_windows")

    with patch("src.log_handler.mark_db_ready", lambda: None):
        dbh.init_db()

    db = dbh.SessionLocal()
    try:
        columns = [row[1] for row in db.execute(text("PRAGMA table_info(settings)")).fetchall()]
        assert "processing_hours_windows" in columns
    finally:
        db.close()


def test_init_db_migrates_legacy_settings_table_for_r18_auto_refresh(isolated_db):
    db = dbh.SessionLocal()
    db.add(SettingRecord())
    db.commit()
    db.close()

    for column_name in (
        "r18_auto_refresh_enabled",
        "r18_auto_refresh_time",
        "r18_auto_refresh_day_of_week",
        "r18_auto_refresh_last_run",
        "r18_auto_refresh_next_run",
        "r18_auto_refresh_last_error",
    ):
        _rebuild_settings_table_without_column(column_name)

    with patch("src.log_handler.mark_db_ready", lambda: None):
        dbh.init_db()

    db = dbh.SessionLocal()
    try:
        columns = [row[1] for row in db.execute(text("PRAGMA table_info(settings)")).fetchall()]
        for column_name in (
            "r18_auto_refresh_enabled",
            "r18_auto_refresh_time",
            "r18_auto_refresh_day_of_week",
            "r18_auto_refresh_last_run",
            "r18_auto_refresh_next_run",
            "r18_auto_refresh_last_error",
        ):
            assert column_name in columns
    finally:
        db.close()


def test_init_db_migrates_legacy_settings_table_for_scan_schedule_time_zone(isolated_db):
    db = dbh.SessionLocal()
    db.add(SettingRecord())
    db.commit()
    db.close()

    _rebuild_settings_table_without_column("scan_schedule_time_zone")

    with patch("src.log_handler.mark_db_ready", lambda: None):
        dbh.init_db()

    db = dbh.SessionLocal()
    try:
        columns = [row[1] for row in db.execute(text("PRAGMA table_info(settings)")).fetchall()]
        assert "scan_schedule_time_zone" in columns
    finally:
        db.close()


def test_init_db_migrates_legacy_settings_table_for_queue_download_time_limit(isolated_db):
    db = dbh.SessionLocal()
    db.add(SettingRecord())
    db.commit()
    db.close()

    _rebuild_settings_table_without_column("queue_download_time_limit_minutes")

    with patch("src.log_handler.mark_db_ready", lambda: None):
        dbh.init_db()

    db = dbh.SessionLocal()
    try:
        columns = [row[1] for row in db.execute(text("PRAGMA table_info(settings)")).fetchall()]
        assert "queue_download_time_limit_minutes" in columns
    finally:
        db.close()


def test_init_db_migrates_legacy_settings_table_for_split_min_video_duration(isolated_db):
    db = dbh.SessionLocal()
    db.add(SettingRecord())
    db.commit()
    db.close()

    _rebuild_settings_table_without_column("split_min_video_duration_seconds")

    with patch("src.log_handler.mark_db_ready", lambda: None):
        dbh.init_db()

    db = dbh.SessionLocal()
    try:
        columns = [row[1] for row in db.execute(text("PRAGMA table_info(settings)")).fetchall()]
        assert "split_min_video_duration_seconds" in columns
    finally:
        db.close()


def test_clear_torrent_db_preserves_settings(test_client: TestClient):
    db = dbh.SessionLocal()
    try:
        db.execute(text("INSERT INTO directories (id, name, path, created_at, updated_at) VALUES ('dir-1', 'Root', '/videos', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
        db.execute(text("INSERT INTO files (id, name, path, size, created_at, modified_at, directory_id, queue_disabled, split_disabled, subtitle_disabled, is_deleted) VALUES ('file-1', 'video.mp4', '/videos/video.mp4', 123, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'dir-1', 0, 0, 0, 0)"))
        db.execute(text("INSERT INTO tasks (id, file_id, type, status, created_at, overwrite_scenes, overwrite_split, overwrite_subtitles, bypass_split_guard, delete_video_after_completion) VALUES ('task-1', 'file-1', 'ALL', 'completed', CURRENT_TIMESTAMP, 0, 0, 0, 0, 0)"))
        db.execute(text("INSERT INTO torrent_tracking (content_id, video_code, torrent_hash, torrent_name, status, added_at) VALUES ('cid-1', 'ABP-123', 'abc', 'ABP-123', 'completed', CURRENT_TIMESTAMP)"))
        db.execute(text("INSERT INTO download_queue (content_id, video_code, status, added_at, failed_torrent_urls, position) VALUES ('cid-1', 'ABP-123', 'done', CURRENT_TIMESTAMP, '[]', 1)"))
        db.execute(text("INSERT INTO notifications (id, type, title, message, is_read, created_at) VALUES ('notif-1', 'task_completed', 'Done', 'Finished', 0, CURRENT_TIMESTAMP)"))
        db.commit()
    finally:
        db.close()

    resp = test_client.delete("/api/settings/torrent-db")
    assert resp.status_code == 200
    data = resp.json()
    assert data["files"] == 1
    assert data["tasks"] == 1
    assert data["tracked_torrents"] == 1
    assert data["downloads"] == 1
    assert "R18 reference database was not modified" in data["message"]

    db = dbh.SessionLocal()
    try:
        assert db.execute(text("SELECT COUNT(*) FROM settings")).scalar() == 1
        assert db.execute(text("SELECT COUNT(*) FROM files")).scalar() == 0
        assert db.execute(text("SELECT COUNT(*) FROM tasks")).scalar() == 0
        assert db.execute(text("SELECT COUNT(*) FROM torrent_tracking")).scalar() == 0
        assert db.execute(text("SELECT COUNT(*) FROM download_queue")).scalar() == 0
        assert db.execute(text("SELECT COUNT(*) FROM notifications")).scalar() == 0
    finally:
        db.close()


def test_clear_torrent_db_rejects_active_processing(test_client: TestClient):
    with patch("src.api.settings.task_manager.is_processing", True):
        resp = test_client.delete("/api/settings/torrent-db")

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot clear torrent database while processing is active."
