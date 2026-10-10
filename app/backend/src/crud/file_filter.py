"""CRUD for saved file filter presets stored in settings.saved_file_filters JSON."""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from ..schemas.db_helper import close_db, get_db
from ..schemas.setting import SettingRecord
from .setting import get_settings

MAX_PRESETS = 50

_FILTER_KEYS = frozenset({
    "type",
    "format",
    "dateRange",
    "hasScenes",
    "hasSplit",
    "hasSubtitle",
    "hasNoScenes",
    "hasNoSplit",
    "hasNoSubtitle",
    "sceneCount",
    "statusFilter",
    "queueDisabled",
    "queueDisabledNo",
    "splitDisabled",
    "splitDisabledNo",
    "subtitleDisabled",
    "subtitleDisabledNo",
    "noNumberSuffix",
    "newVideos",
    "contentTag",
    "resolutionFilter",
    "fileSizeOperator",
    "fileSizeValue",
    "selectedDirectoryIds",
    "directoryExclude",
    "selectedDirectoryId",
    "isGroupedView",
})
_PRESET_KEYS = frozenset({"isDefault"})


def _default_filters() -> dict[str, Any]:
    """Return empty filter snapshot defaults."""
    return {
        "type": [],
        "format": [],
        "dateRange": [],
        "hasScenes": False,
        "hasSplit": False,
        "hasSubtitle": False,
        "hasNoScenes": False,
        "hasNoSplit": False,
        "hasNoSubtitle": False,
        "sceneCount": None,
        "statusFilter": [],
        "queueDisabled": False,
        "queueDisabledNo": False,
        "splitDisabled": False,
        "splitDisabledNo": False,
        "subtitleDisabled": False,
        "subtitleDisabledNo": False,
        "noNumberSuffix": False,
        "newVideos": False,
        "contentTag": None,
        "resolutionFilter": [],
        "fileSizeOperator": "gte",
        "fileSizeValue": None,
        "selectedDirectoryIds": [],
        "directoryExclude": False,
        "selectedDirectoryId": None,
        "isGroupedView": False,
    }


def _default_preset() -> dict[str, Any]:
    return {"isDefault": False}


def _normalize_preset(raw: dict[str, Any]) -> dict[str, Any]:
    result = _default_preset()
    if not isinstance(raw, dict):
        return result
    if "isDefault" in raw:
        result["isDefault"] = bool(raw["isDefault"])
    return result


def normalize_filters(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize a filter snapshot from the client.

    Args:
        raw: Client-supplied filter object.

    Returns:
        Normalized filter dict with only known keys and coerced types.

    Raises:
        ValueError: If required structure is invalid.
    """
    if not isinstance(raw, dict):
        raise ValueError("filters must be an object")

    result = _default_filters()
    for key in _FILTER_KEYS:
        if key not in raw:
            continue
        value = raw[key]
        if key in ("type", "format", "dateRange", "statusFilter", "resolutionFilter"):
            if not isinstance(value, list):
                raise ValueError(f"{key} must be a list")
            result[key] = value
        elif key == "fileSizeOperator":
            if value not in ("gte", "lte", "eq"):
                raise ValueError("fileSizeOperator must be gte, lte, or eq")
            result[key] = value
        elif key == "fileSizeValue":
            if value is not None and (not isinstance(value, (int, float)) or value < 0):
                raise ValueError("fileSizeValue must be a non-negative number or null")
            result[key] = value
        elif key == "contentTag":
            if value is not None and value not in ("censored", "uncensored", "subtitled"):
                raise ValueError("contentTag must be censored, uncensored, subtitled, or null")
            result[key] = value
        elif key == "selectedDirectoryIds":
            if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                raise ValueError("selectedDirectoryIds must be a list of strings")
            result[key] = value
        elif key == "sceneCount":
            if value is not None and not isinstance(value, int):
                raise ValueError("sceneCount must be an integer or null")
            result[key] = value
        elif key == "selectedDirectoryId":
            if value is not None and not isinstance(value, str):
                raise ValueError("selectedDirectoryId must be a string or null")
            result[key] = value
            if value and not result["selectedDirectoryIds"]:
                result["selectedDirectoryIds"] = [value]
        elif key == "isGroupedView":
            result[key] = bool(value)
        else:
            result[key] = bool(value)
    return result


def _load_presets(row: SettingRecord) -> list[dict[str, Any]]:
    """Parse saved presets JSON from a settings row."""
    raw = row.saved_file_filters
    if not raw:
        return []
    if isinstance(raw, str):
        presets = json.loads(raw)
    else:
        presets = raw
    normalized_presets: list[dict[str, Any]] = []
    for preset in presets:
        merged = {**preset, **_default_preset()}
        merged.update(_normalize_preset(preset))
        normalized_presets.append(merged)
    return normalized_presets


def _persist_presets(db, row: SettingRecord, presets: list[dict[str, Any]]) -> None:
    """Write presets JSON to the settings row."""
    row.saved_file_filters = json.dumps(presets)
    db.commit()
    db.refresh(row)


def _clear_other_defaults(presets: list[dict[str, Any]], default_id: str | None) -> list[dict[str, Any]]:
    for preset in presets:
        preset["isDefault"] = bool(default_id and preset["id"] == default_id)
    return presets


def list_file_filters() -> list[dict[str, Any]]:
    """Return all saved file filter presets."""
    row = get_settings()
    return _load_presets(row)


def create_file_filter(name: str, filters: dict[str, Any]) -> dict[str, Any]:
    """Create a named file filter preset.

    Args:
        name: User-visible preset name.
        filters: Filter snapshot to store.

    Returns:
        Created preset including id and created_at.

    Raises:
        ValueError: On validation failure.
    """
    trimmed = name.strip()
    if not trimmed:
        raise ValueError("name is required")

    normalized = normalize_filters(filters)
    db = get_db()
    try:
        row = db.query(SettingRecord).filter(SettingRecord.id == 1).first()
        if row is None:
            row = SettingRecord(id=1)
            db.add(row)
            db.commit()
            db.refresh(row)

        presets = _load_presets(row)
        lower = trimmed.casefold()
        existing_index = next((i for i, p in enumerate(presets) if p["name"].casefold() == lower), None)
        if existing_index is not None:
            preset = presets[existing_index]
            preset["name"] = trimmed
            preset["filters"] = normalized
            presets[existing_index] = preset
            _persist_presets(db, row, presets)
            return preset

        if len(presets) >= MAX_PRESETS:
            raise ValueError(f"maximum of {MAX_PRESETS} saved filters reached")

        preset = {
            "id": str(uuid.uuid4()),
            "name": trimmed,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "filters": normalized,
            "isDefault": False,
        }
        presets.append(preset)
        _persist_presets(db, row, presets)
        return preset
    except Exception as e:
        logging.error("create_file_filter failed: %s", e)
        raise
    finally:
        close_db(db)


def update_file_filter(
    preset_id: str,
    *,
    name: str | None = None,
    filters: dict[str, Any] | None = None,
    is_default: bool | None = None,
) -> dict[str, Any]:
    """Update an existing preset's name and/or filters.

    Args:
        preset_id: UUID of the preset to update.
        name: Optional new name.
        filters: Optional new filter snapshot.

    Returns:
        Updated preset dict.

    Raises:
        ValueError: If preset not found or validation fails.
    """
    db = get_db()
    try:
        row = db.query(SettingRecord).filter(SettingRecord.id == 1).first()
        if row is None:
            raise ValueError("preset not found")

        presets = _load_presets(row)
        index = next((i for i, p in enumerate(presets) if p["id"] == preset_id), None)
        if index is None:
            raise ValueError("preset not found")

        preset = presets[index]

        if name is not None:
            trimmed = name.strip()
            if not trimmed:
                raise ValueError("name is required")
            lower = trimmed.casefold()
            if any(i != index and p["name"].casefold() == lower for i, p in enumerate(presets)):
                raise ValueError("a saved filter with this name already exists")
            preset["name"] = trimmed

        if filters is not None:
            preset["filters"] = normalize_filters(filters)
        if is_default is not None:
            preset["isDefault"] = bool(is_default)
            if preset["isDefault"]:
                presets = _clear_other_defaults(presets, preset_id)

        presets[index] = preset
        _persist_presets(db, row, presets)
        return preset
    except Exception as e:
        logging.error("update_file_filter failed: %s", e)
        raise
    finally:
        close_db(db)


def delete_file_filter(preset_id: str) -> None:
    """Delete a saved file filter preset by id.

    Raises:
        ValueError: If preset not found.
    """
    db = get_db()
    try:
        row = db.query(SettingRecord).filter(SettingRecord.id == 1).first()
        if row is None:
            raise ValueError("preset not found")

        presets = _load_presets(row)
        filtered = [p for p in presets if p["id"] != preset_id]
        if len(filtered) == len(presets):
            raise ValueError("preset not found")

        _persist_presets(db, row, filtered)
    except Exception as e:
        logging.error("delete_file_filter failed: %s", e)
        raise
    finally:
        close_db(db)
