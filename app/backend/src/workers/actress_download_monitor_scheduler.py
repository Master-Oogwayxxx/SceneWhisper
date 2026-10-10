"""Scheduler for recurring R18 actress download monitors."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..crud import r18_actress
from ..crud.actress_download_monitor import (
    get_all_actress_download_monitors,
    update_actress_download_monitor_run,
)
from ..crud.download_queue import enqueue_works
from ..models.models import ActressDownloadMonitor
from ..schemas.db_helper import SessionLocal
from ..schemas.r18_db import r18_db_ready
from ..utils import calculate_next_run
from ..api.r18 import _merge_content_id_filters, _resolve_badge_filter, _resolve_file_exists_filter

_POLL_INTERVAL = 60
_PAGE_LIMIT = 200


def _parse_utc_timestamp(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _is_due(monitor: ActressDownloadMonitor) -> bool:
    if not monitor.isActive:
        return False
    if not monitor.nextRun:
        return True
    return datetime.now(timezone.utc) >= _parse_utc_timestamp(monitor.nextRun)


def run_actress_download_monitor(db: Session, monitor: ActressDownloadMonitor) -> tuple[int, int]:
    """Run one actress monitor and enqueue matching works.

    Returns:
        Tuple of (queued, skipped). Skipped includes matches beyond the per-run cap
        and duplicates rejected by the existing download queue.
    """
    if not r18_db_ready():
        next_run = calculate_next_run(monitor.schedule.model_dump())
        update_actress_download_monitor_run(
            db,
            monitor,
            queued=0,
            skipped=0,
            last_error="R18 database not loaded",
            next_run=next_run,
        )
        return 0, 0

    criteria = monitor.criteria
    max_items = max(1, monitor.maxItemsPerRun)
    content_ids_include, content_ids_exclude = _merge_content_id_filters(
        _resolve_file_exists_filter(criteria.fileExists, monitor.actressId, db, criteria.localFileState),
        _resolve_badge_filter(monitor.actressId, db, criteria.uncensored, criteria.censored, criteria.subtitled, criteria.resolution),
    )

    candidates: list[tuple[str, str]] = []
    skipped_by_cap = 0
    skip = 0
    total = 1
    while len(candidates) < max_items and skip < total:
        limit = min(_PAGE_LIMIT, max_items - len(candidates))
        rows, total = r18_actress.list_actress_works(
            actress_id=monitor.actressId,
            skip=skip,
            limit=limit,
            sort_by=criteria.sortBy,
            sort_dir=criteria.sortDir,
            search=criteria.search,
            has_image=criteria.hasImage,
            release_year=criteria.releaseYear,
            content_ids_include=content_ids_include,
            content_ids_exclude=content_ids_exclude,
        )
        if not rows:
            break
        for row in rows:
            content_id = row.get("content_id")
            if not content_id:
                continue
            video_code = row.get("video_code") or row.get("dvd_id") or content_id
            candidates.append((content_id, video_code))
            if len(candidates) >= max_items:
                break
        skip += len(rows)

    if total > len(candidates):
        skipped_by_cap = max(0, total - len(candidates))

    queued = enqueue_works(db, candidates)
    skipped = skipped_by_cap + (len(candidates) - queued)
    next_run = calculate_next_run(monitor.schedule.model_dump())
    update_actress_download_monitor_run(
        db,
        monitor,
        queued=queued,
        skipped=skipped,
        last_error=None,
        next_run=next_run,
    )
    return queued, skipped


async def run_due_actress_download_monitors() -> int:
    """Run currently overdue active monitors once. Returns number of monitors run."""
    loop = asyncio.get_running_loop()

    def _run_due() -> int:
        db = SessionLocal()
        try:
            monitors = get_all_actress_download_monitors(db)
            ran = 0
            for monitor in monitors:
                if not _is_due(monitor):
                    continue
                try:
                    run_actress_download_monitor(db, monitor)
                    ran += 1
                except Exception as exc:
                    logging.error("Actress download monitor %s failed: %s", monitor.id, exc, exc_info=True)
                    next_run = calculate_next_run(monitor.schedule.model_dump())
                    update_actress_download_monitor_run(
                        db,
                        monitor,
                        queued=0,
                        skipped=0,
                        last_error=str(exc),
                        next_run=next_run,
                    )
            return ran
        finally:
            db.close()

    return await loop.run_in_executor(None, _run_due)


async def actress_download_monitor_scheduler() -> None:
    while True:
        try:
            await run_due_actress_download_monitors()
            await asyncio.sleep(_POLL_INTERVAL)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logging.error("actress_download_monitor_scheduler error: %s", exc, exc_info=True)
            await asyncio.sleep(_POLL_INTERVAL)
