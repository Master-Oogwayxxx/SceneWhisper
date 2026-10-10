import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, StrictInt, field_validator
from sqlalchemy import text

from ..api.tasks import task_manager
from ..crud.setting import get_settings, patch_settings
from ..crud.download_queue import get_processing_items
from ..schemas.db_helper import DB_PATH, SessionLocal
from ..schemas.setting import DEFAULT_EXTERNAL_VIDEO_TARGETS, DEFAULT_PROCESSING_HOURS_WINDOWS, DEFAULT_SCRAPER_TEMPLATES
from ..utils import calculate_next_run, utc_isoformat

router = APIRouter(prefix="/api/settings", tags=["settings"])

_JSON_FIELDS = {
    "ignore_patterns",
    "selected_scan_directories",
    "task_type_priority",
    "external_video_targets",
    "scraper_templates",
    "actress_favorites",
    "processing_hours_windows",
}
_JSON_FIELD_DEFAULTS = {
    "ignore_patterns": [],
    "selected_scan_directories": [],
    "task_type_priority": [],
    "external_video_targets": json.loads(DEFAULT_EXTERNAL_VIDEO_TARGETS),
    "scraper_templates": json.loads(DEFAULT_SCRAPER_TEMPLATES),
    "actress_favorites": [],
    "processing_hours_windows": json.loads(DEFAULT_PROCESSING_HOURS_WINDOWS),
}
_GENERIC_SETTINGS_EXCLUDED_FIELDS = {"actress_favorites"}
_APP_TORRENT_TABLES = (
    "tasks",
    "files",
    "directories",
    "torrent_tracking",
    "download_queue",
    "notifications",
    "logs",
)


def _validate_settings_patch(body: dict[str, Any]) -> dict[str, Any]:
    validated = dict(body)
    if "scene_detection_concurrency" in validated:
        try:
            validated["scene_detection_concurrency"] = max(1, min(3, int(validated["scene_detection_concurrency"])))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="scene_detection_concurrency must be an integer from 1 to 3")
    if "frame_pacing_analyzer_concurrency" in validated:
        try:
            validated["frame_pacing_analyzer_concurrency"] = max(1, min(8, int(validated["frame_pacing_analyzer_concurrency"])))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="frame_pacing_analyzer_concurrency must be an integer from 1 to 8")
    if "frame_pacing_analyzer_timeout_minutes" in validated:
        try:
            validated["frame_pacing_analyzer_timeout_minutes"] = max(1, min(240, int(validated["frame_pacing_analyzer_timeout_minutes"])))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="frame_pacing_analyzer_timeout_minutes must be an integer from 1 to 240")
    return validated


def _row_to_dict(row, *, exclude_fields: set[str] | None = None) -> dict[str, Any]:
    excluded = exclude_fields or set()
    result = {}
    for c in row.__table__.columns:
        if c.name == "id" or c.name in excluded:
            continue
        value = getattr(row, c.name)
        if c.name in _JSON_FIELDS:
            if isinstance(value, str):
                result[c.name] = json.loads(value)
            else:
                result[c.name] = value or _JSON_FIELD_DEFAULTS[c.name]
        else:
            result[c.name] = value
    return result


class ActressFavoritesPayload(BaseModel):
    actress_ids: list[StrictInt]

    @field_validator("actress_ids")
    @classmethod
    def validate_positive_ids(cls, actress_ids: list[int]) -> list[int]:
        if any(actress_id <= 0 for actress_id in actress_ids):
            raise ValueError("actress_ids must contain only positive integers")
        return actress_ids


def _normalize_actress_ids(ids: list[int]) -> list[int]:
    seen: set[int] = set()
    normalized: list[int] = []
    for actress_id in ids:
        if actress_id in seen:
            continue
        seen.add(actress_id)
        normalized.append(actress_id)
    return normalized


@router.get("")
async def read_settings():
    """Return current settings."""
    loop = asyncio.get_running_loop()
    row = await loop.run_in_executor(None, get_settings)
    return _row_to_dict(row, exclude_fields=_GENERIC_SETTINGS_EXCLUDED_FIELDS)


@router.get("/actress-favorites")
async def read_actress_favorites():
    loop = asyncio.get_running_loop()
    row = await loop.run_in_executor(None, get_settings)
    data = _row_to_dict(row)
    return {"actress_ids": _normalize_actress_ids(data.get("actress_favorites", []))}


@router.put("/actress-favorites")
async def update_actress_favorites(body: ActressFavoritesPayload):
    normalized = _normalize_actress_ids(body.actress_ids)
    loop = asyncio.get_running_loop()

    def _write():
        return patch_settings({"actress_favorites": json.dumps(normalized)})

    row = await loop.run_in_executor(None, _write)
    data = _row_to_dict(row)
    return {"actress_ids": _normalize_actress_ids(data.get("actress_favorites", []))}


@router.get("/export-db")
async def export_database():
    """Download the SQLite database file."""
    return FileResponse(
        path=str(DB_PATH),
        media_type="application/octet-stream",
        filename="videoprocessor.db",
    )


def _clear_torrent_app_database() -> dict[str, int]:
    db = SessionLocal()
    try:
        processing_downloads = len(get_processing_items(db))
        if task_manager.is_processing or processing_downloads > 0:
            raise HTTPException(
                status_code=409,
                detail="Cannot clear torrent database while processing is active.",
            )

        deleted: dict[str, int] = {}
        for table_name in _APP_TORRENT_TABLES:
            result = db.execute(text(f"DELETE FROM {table_name}"))
            deleted[table_name] = result.rowcount or 0
        db.commit()

        return {
            "deleted": sum(deleted.values()),
            "downloads": deleted["download_queue"],
            "tracked_torrents": deleted["torrent_tracking"],
            "tasks": deleted["tasks"],
            "files": deleted["files"],
            "directories": deleted["directories"],
            "notifications": deleted["notifications"],
            "logs": deleted["logs"],
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to clear torrent database: {exc}") from exc
    finally:
        db.close()


@router.delete("/torrent-db")
async def clear_torrent_database():
    """Clear torrent-related app database tables without touching the R18 database."""
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, _clear_torrent_app_database)

    await task_manager.clear_queue()
    task_manager.tasks_db.clear()
    task_manager._paused_tasks.clear()
    task_manager._progress_snapshots.clear()
    task_manager._globally_paused_task_ids.clear()
    task_manager.is_globally_paused = False

    return {
        **result,
        "message": "Cleared app torrent database. R18 reference database was not modified.",
    }


@router.patch("")
async def update_settings(body: dict[str, Any]):
    """Partially update settings. Unknown keys are ignored."""
    encoded = _validate_settings_patch(body)
    for field in _GENERIC_SETTINGS_EXCLUDED_FIELDS:
        encoded.pop(field, None)
    for field in _JSON_FIELDS - _GENERIC_SETTINGS_EXCLUDED_FIELDS:
        if field in encoded and isinstance(encoded[field], (list, dict)):
            encoded[field] = json.dumps(encoded[field])

    should_refresh_r18_schedule = any(
        field in body
        for field in (
            "r18_auto_refresh_enabled",
            "r18_auto_refresh_time",
            "r18_auto_refresh_day_of_week",
        )
    )
    if should_refresh_r18_schedule:
        current = await asyncio.get_running_loop().run_in_executor(None, get_settings)
        enabled = bool(encoded.get("r18_auto_refresh_enabled", current.r18_auto_refresh_enabled))
        time_value = encoded.get("r18_auto_refresh_time", current.r18_auto_refresh_time)
        day_value = encoded.get("r18_auto_refresh_day_of_week", current.r18_auto_refresh_day_of_week)
        if enabled and time_value and day_value is not None:
            encoded["r18_auto_refresh_next_run"] = utc_isoformat(
                calculate_next_run({"interval": "weekly", "time": time_value, "dayOfWeek": day_value})
            )
            encoded["r18_auto_refresh_last_error"] = None
        elif not enabled:
            encoded["r18_auto_refresh_next_run"] = None
            encoded["r18_auto_refresh_last_error"] = None

    should_refresh_scan_schedule = any(
        field in body
        for field in (
            "scan_schedule_enabled",
            "scan_schedule_time",
            "scan_schedule_time_zone",
            "scan_schedule_mode",
        )
    )
    if should_refresh_scan_schedule:
        current = await asyncio.get_running_loop().run_in_executor(None, get_settings)
        enabled = bool(encoded.get("scan_schedule_enabled", current.scan_schedule_enabled))
        time_value = encoded.get("scan_schedule_time", current.scan_schedule_time)
        time_zone = encoded.get("scan_schedule_time_zone", current.scan_schedule_time_zone)
        mode_value = encoded.get("scan_schedule_mode", current.scan_schedule_mode)
        if mode_value not in {"all", "selected"}:
            mode_value = "all"
            encoded["scan_schedule_mode"] = mode_value
        if enabled and time_value:
            encoded["scan_schedule_next_run"] = utc_isoformat(
                calculate_next_run({"interval": "daily", "time": time_value, "timeZone": time_zone})
            )
            encoded["scan_schedule_last_error"] = None
        elif not enabled:
            encoded["scan_schedule_next_run"] = None
            encoded["scan_schedule_last_error"] = None

    result = _row_to_dict(
        patch_settings(encoded),
        exclude_fields=_GENERIC_SETTINGS_EXCLUDED_FIELDS,
    )
    if "task_type_priority" in body and isinstance(body["task_type_priority"], list):
        await task_manager.rerank_queue(body["task_type_priority"])
    return result
