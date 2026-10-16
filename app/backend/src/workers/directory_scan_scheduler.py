"""Scheduler for recurring full directory scans."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.request
from urllib.parse import quote
from datetime import datetime, timezone

from ..crud.setting import get_settings, patch_settings
from ..utils import calculate_next_run, utc_isoformat

_POLL_INTERVAL = 60
_STARTUP_DELAY = 15
_REQUEST_RETRIES = 5
_REQUEST_RETRY_DELAY = 2
_INTERNAL_API_URL = os.getenv("INTERNAL_API_URL", "http://127.0.0.1:8010").rstrip("/")
_SCAN_URL = f"{_INTERNAL_API_URL}/api/directory/scan_all/stream"


def _parse_utc_timestamp(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _get_schedule_payload(settings) -> dict[str, object] | None:
    if not settings.scan_schedule_enabled:
        return None
    if not settings.scan_schedule_time:
        return None
    return {
        "interval": "daily",
        "time": settings.scan_schedule_time,
        "timeZone": getattr(settings, "scan_schedule_time_zone", None),
    }


def _get_scan_url(settings) -> str:
    if getattr(settings, "scan_schedule_mode", "all") != "selected":
        return _SCAN_URL
    selected = getattr(settings, "selected_scan_directories", None) or []
    if not selected:
        return _SCAN_URL
    directories = quote(",".join(selected), safe=",")
    return f"{_SCAN_URL}?directories={directories}"


async def run_due_directory_scan() -> bool:
    loop = asyncio.get_running_loop()

    def _run_due() -> bool:
        settings = get_settings()
        schedule_payload = _get_schedule_payload(settings)
        if schedule_payload is None:
            return False

        next_run_value = settings.scan_schedule_next_run
        if not next_run_value:
            return False

        now = datetime.now(timezone.utc)
        if _parse_utc_timestamp(next_run_value) > now:
            return False

        next_run = utc_isoformat(calculate_next_run(schedule_payload))
        scan_url = _get_scan_url(settings)
        try:
            last_error: Exception | None = None
            for attempt in range(_REQUEST_RETRIES):
                try:
                    with urllib.request.urlopen(scan_url, timeout=30) as response:
                        for raw_line in response:
                            line = raw_line.decode("utf-8", errors="ignore").strip()
                            if line.startswith("data: "):
                                payload = line[6:]
                                if payload:
                                    json.loads(payload)
                    last_error = None
                    break
                except Exception as exc:
                    last_error = exc
                    if attempt < _REQUEST_RETRIES - 1:
                        time.sleep(_REQUEST_RETRY_DELAY)
            if last_error is not None:
                raise last_error
        except Exception as exc:
            patch_settings(
                {
                    # Keep an operational failure retryable instead of
                    # postponing it until the next daily schedule.
                    "scan_schedule_next_run": utc_isoformat(
                        datetime.now(timezone.utc).replace(microsecond=0)
                    ),
                    "scan_schedule_last_error": str(exc),
                }
            )
            return False

        patch_settings(
            {
                "scan_schedule_last_run": utc_isoformat(now),
                "scan_schedule_next_run": next_run,
                "scan_schedule_last_error": None,
            }
        )
        return True

    return await loop.run_in_executor(None, _run_due)


async def directory_scan_scheduler() -> None:
    # FastAPI starts lifespan tasks before Uvicorn accepts HTTP requests.
    await asyncio.sleep(_STARTUP_DELAY)

    while True:
        try:
            await run_due_directory_scan()
            await asyncio.sleep(_POLL_INTERVAL)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logging.error("directory_scan_scheduler error: %s", exc, exc_info=True)
            await asyncio.sleep(_POLL_INTERVAL)
