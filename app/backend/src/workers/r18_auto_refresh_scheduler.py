"""Scheduler for recurring R18 dump download/import refreshes."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from ..api.r18 import LATEST_DUMP_URL
from ..crud.setting import get_settings, patch_settings
from ..schemas.r18_db import schedule_import_from_url
from ..utils import calculate_next_run, utc_isoformat

_POLL_INTERVAL = 60


def _parse_utc_timestamp(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _get_schedule_payload(settings) -> dict[str, object] | None:
    if not settings.r18_auto_refresh_enabled:
        return None
    if not settings.r18_auto_refresh_time or settings.r18_auto_refresh_day_of_week is None:
        return None
    return {
        "interval": "weekly",
        "time": settings.r18_auto_refresh_time,
        "dayOfWeek": settings.r18_auto_refresh_day_of_week,
    }


async def run_due_r18_auto_refresh() -> bool:
    """Run the scheduled R18 auto-refresh once if overdue."""
    loop = asyncio.get_running_loop()

    def _run_due() -> bool:
        settings = get_settings()
        schedule_payload = _get_schedule_payload(settings)
        if schedule_payload is None:
            return False

        next_run_value = settings.r18_auto_refresh_next_run
        if not next_run_value:
            return False

        now = datetime.now(timezone.utc)
        if _parse_utc_timestamp(next_run_value) > now:
            return False

        next_run = utc_isoformat(calculate_next_run(schedule_payload))
        try:
            schedule_import_from_url(LATEST_DUMP_URL)
        except Exception as exc:
            patch_settings(
                {
                    "r18_auto_refresh_next_run": next_run,
                    "r18_auto_refresh_last_error": str(exc),
                }
            )
            return False

        patch_settings(
            {
                "r18_auto_refresh_last_run": utc_isoformat(now),
                "r18_auto_refresh_next_run": next_run,
                "r18_auto_refresh_last_error": None,
            }
        )
        return True

    return await loop.run_in_executor(None, _run_due)


async def r18_auto_refresh_scheduler() -> None:
    while True:
        try:
            await run_due_r18_auto_refresh()
            await asyncio.sleep(_POLL_INTERVAL)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logging.error("r18_auto_refresh_scheduler error: %s", exc, exc_info=True)
            await asyncio.sleep(_POLL_INTERVAL)
