# app/backend/src/crud/setting.py
import logging
from typing import Any

from ..schemas.db_helper import close_db, get_db
from ..schemas.setting import SettingRecord


def get_settings() -> SettingRecord:
    """Return the single settings row, creating it with defaults if absent."""
    db = get_db()
    try:
        row = db.query(SettingRecord).filter(SettingRecord.id == 1).first()
        if row is None:
            row = SettingRecord(id=1)
            db.add(row)
            db.commit()
            db.refresh(row)
        return row
    except Exception as e:
        logging.error("get_settings failed: %s", e)
        raise
    finally:
        close_db(db)


def patch_settings(updates: dict[str, Any]) -> SettingRecord:
    """Apply a partial update to the settings row."""
    db = get_db()
    try:
        row = db.query(SettingRecord).filter(SettingRecord.id == 1).first()
        if row is None:
            row = SettingRecord(id=1)
            db.add(row)

        for key, value in updates.items():
            if hasattr(row, key) and key != "id":
                setattr(row, key, value)

        db.commit()
        db.refresh(row)
        return row
    except Exception as e:
        logging.error("patch_settings failed: %s", e)
        raise
    finally:
        close_db(db)
