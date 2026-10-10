"""Background worker: processes the download_queue table sequentially with delays."""

from __future__ import annotations

import asyncio
import logging
import random
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

from ..crud.download_queue import get_failed_torrent_urls, get_next_pending, get_processing_items, mark_done, mark_failed, mark_failed_with_candidate, mark_processing, mark_skipped, set_torrent_url
from ..crud.actress_download_monitor import get_all_actress_download_monitors
from ..crud.r18_actress import get_actress_ids_by_content_id, get_actress_names_by_content_id
from ..crud.setting import get_settings
from ..crud.torrent_tracking import get_tracking_by_content_id, get_tracking_by_video_code, insert_tracking, is_within_missing_torrent_grace_period, update_hash
from ..crud.torrent_tracking import update_status as update_tracking_status
from ..schemas.db_helper import SessionLocal
from ..utils.qbit import find_torrent_hash_by_name
from ..utils.qbit import find_torrent_hash_by_name as _find_hash
from ..utils.qbit import delete_torrent
from ..utils.qbit import get_torrent_progress
from ..utils.qbit import send_to_qbit as _send_to_qbit

_IDLE_SLEEP = 30  # seconds to sleep when queue is empty
_WINDOW_POLL = 60  # seconds to sleep when outside time window
_ALL_CANDIDATES_FAILED = "All torrent candidates failed"
_MISSING_TORRENT_ERROR = "Torrent removed from qBittorrent before completion"
_QBIT_CATEGORY = "Scene Whisper"


def _get_time_limit_error(limit_minutes: int) -> str:
    return f"Torrent exceeded download time limit of {limit_minutes} minutes"


def _has_exceeded_download_time_limit(tracking, limit_minutes: int) -> bool:
    if limit_minutes <= 0:
        return False
    added_at = getattr(tracking, "added_at", None)
    if added_at is None:
        return False
    if added_at.tzinfo is None:
        added_at = added_at.replace(tzinfo=timezone.utc)
    elapsed = datetime.now(timezone.utc) - added_at
    return elapsed.total_seconds() >= limit_minutes * 60


@dataclass(frozen=True)
class NyaaCandidate:
    title: str
    torrent_url: str
    seeders: int


def _candidate_sort_key(candidate: NyaaCandidate) -> tuple[int, int, int]:
    title_lower = candidate.title.lower()
    has_reducing_mosaic = int("reducing mosaic" in title_lower)
    has_uncensored = int("uncensored" in title_lower)
    return (has_reducing_mosaic, has_uncensored, candidate.seeders)


def _is_in_window(start_hour: int, end_hour: int) -> bool:
    """Return True if current UTC hour is within [start_hour, end_hour).

    If start == end == 0, always returns True (window disabled).
    If start < end: window is start..end within same day.
    If start > end: window wraps midnight (e.g. 22..06).
    """
    if start_hour == 0 and end_hour == 0:
        return True
    current = datetime.now(timezone.utc).hour
    if start_hour < end_hour:
        return start_hour <= current < end_hour
    # Wraps midnight
    return current >= start_hour or current < end_hour


def _fetch_nyaa_candidates(video_code: str) -> list[NyaaCandidate]:
    """Return Nyaa torrent candidates ordered by title preference then seeders."""
    url = f"https://sukebei.nyaa.si/?page=rss&q={video_code}&c=0_0&f=0"
    headers = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")}
    try:
        resp = httpx.get(url, timeout=10, follow_redirects=True, headers=headers)
        resp.raise_for_status()
    except Exception as exc:
        logging.warning("download_queue_worker: nyaa fetch failed for %s: %s", video_code, exc)
        return []

    ns = {"nyaa": "https://sukebei.nyaa.si/xmlns/nyaa"}
    try:
        root = ET.fromstring(resp.text)
    except ET.ParseError as exc:
        logging.warning("download_queue_worker: nyaa parse error for %s: %s", video_code, exc)
        return []

    candidates: list[NyaaCandidate] = []
    for item in root.findall(".//item")[:10]:
        title_el = item.find("title")
        link_el = item.find("link")
        seeders_el = item.find("nyaa:seeders", ns)
        if title_el is None or link_el is None:
            continue
        title = (title_el.text or "").strip()
        torrent_url = (link_el.text or "").strip()
        if not torrent_url:
            continue
        try:
            seeders = int(seeders_el.text or 0) if seeders_el is not None else 0
        except ValueError:
            seeders = 0
        candidates.append(NyaaCandidate(title=title, torrent_url=torrent_url, seeders=seeders))

    candidates.sort(key=_candidate_sort_key, reverse=True)
    return candidates


def _build_qbit_labels(content_id: str | None) -> tuple[str, list[str] | None]:
    """Return default qBittorrent category and tags for a queued work."""
    tags = get_actress_names_by_content_id(content_id) if content_id else []
    return _QBIT_CATEGORY, tags or None


def _get_monitor_save_path(db, content_id: str | None) -> str | None:
    """Return the first configured monitor save path for actresses linked to a work."""
    if not content_id:
        return None

    try:
        actress_ids = get_actress_ids_by_content_id(content_id)
    except Exception:
        return None
    if not actress_ids:
        return None

    monitors = get_all_actress_download_monitors(db)
    for actress_id in actress_ids:
        for monitor in monitors:
            if monitor.actressId != actress_id:
                continue
            if monitor.savePath and monitor.savePath.strip():
                return monitor.savePath.strip()
    return None


def _poll_processing_items() -> None:
    """Check all 'processing' queue items against qBittorrent; mark done at 100%."""

    db = SessionLocal()
    try:
        settings = get_settings()
        limit_minutes = max(0, int(getattr(settings, "queue_download_time_limit_minutes", 0) or 0))
        items = get_processing_items(db)
        if not items:
            return
        for item in items:
            tracking = get_tracking_by_content_id(db, item.content_id) if item.content_id else get_tracking_by_video_code(db, item.video_code)
            if tracking is None:
                continue

            torrent_hash = tracking.torrent_hash
            if not torrent_hash:
                # Try to resolve hash if we didn't get it on send
                torrent_hash = find_torrent_hash_by_name(tracking.torrent_name, retries=5, delay=1.0)
                if torrent_hash:
                    update_hash(db, tracking.id, torrent_hash)
                else:
                    if is_within_missing_torrent_grace_period(tracking):
                        logging.info(
                            "download_queue_worker: %s awaiting qbit hash resolution within grace period",
                            item.video_code,
                        )
                        continue
                    # No hash and not in qbit — check if tracking already recorded completion
                    if tracking.status == "completed":
                        mark_done(db, item.id, tracking.torrent_name)
                        logging.info("download_queue_worker: %s not in qbit but tracking completed → done", item.video_code)
                    else:
                        if item.torrent_url:
                            mark_failed_with_candidate(db, item.id, _MISSING_TORRENT_ERROR, item.torrent_url)
                        else:
                            mark_failed(db, item.id, _MISSING_TORRENT_ERROR)
                        update_tracking_status(db, tracking.id, "error")
                        logging.warning(
                            "download_queue_worker: %s missing from qbit before completion → failed",
                            item.video_code,
                        )
                    continue

            progress = get_torrent_progress(torrent_hash)
            if progress is None:
                # Torrent removed from qbit (e.g. auto-removed after seeding) — check tracking
                if tracking.status == "completed":
                    mark_done(db, item.id, tracking.torrent_name)
                    logging.info("download_queue_worker: %s torrent gone from qbit, tracking completed → done", item.video_code)
                else:
                    if item.torrent_url:
                        mark_failed_with_candidate(db, item.id, _MISSING_TORRENT_ERROR, item.torrent_url)
                    else:
                        mark_failed(db, item.id, _MISSING_TORRENT_ERROR)
                    update_tracking_status(db, tracking.id, "error")
                    logging.warning(
                        "download_queue_worker: %s torrent %s gone from qbit before completion → failed",
                        item.video_code,
                        torrent_hash,
                    )
                continue

            logging.debug("download_queue_worker: %s progress %.1f%%", item.video_code, progress * 100)
            if progress >= 1.0:
                mark_done(db, item.id, tracking.torrent_name)
                logging.info("download_queue_worker: %s download complete → done", item.video_code)
                continue

            if _has_exceeded_download_time_limit(tracking, limit_minutes):
                try:
                    delete_torrent(torrent_hash)
                except RuntimeError as exc:
                    logging.warning(
                        "download_queue_worker: failed deleting timed-out torrent %s for %s: %s",
                        torrent_hash,
                        item.video_code,
                        exc,
                    )
                error = _get_time_limit_error(limit_minutes)
                if item.torrent_url:
                    mark_failed_with_candidate(db, item.id, error, item.torrent_url)
                else:
                    mark_failed(db, item.id, error)
                update_tracking_status(db, tracking.id, "error")
                logging.warning(
                    "download_queue_worker: %s exceeded download time limit (%s min) → failed",
                    item.video_code,
                    limit_minutes,
                )
    finally:
        db.close()


def _process_one() -> None:
    """Pick next pending item and process it synchronously. Called from executor."""

    db = SessionLocal()
    try:
        item = get_next_pending(db)
        if item is None:
            return

        mark_processing(db, item.id)
        video_code = item.video_code

        candidates = _fetch_nyaa_candidates(video_code)
        if not candidates:
            logging.info("download_queue_worker: no nyaa results for %s — skipping", video_code)
            mark_skipped(db, item.id)
            return

        candidates = sorted(candidates, key=_candidate_sort_key, reverse=True)
        failed_urls = set(get_failed_torrent_urls(item))
        selected = next((candidate for candidate in candidates if candidate.torrent_url not in failed_urls), None)
        if selected is None:
            logging.info("download_queue_worker: all torrent candidates failed for %s", video_code)
            mark_failed(db, item.id, _ALL_CANDIDATES_FAILED)
            return

        torrent_url = selected.torrent_url
        category, tags = _build_qbit_labels(item.content_id)
        save_path = item.save_path.strip() if item.save_path and item.save_path.strip() else _get_monitor_save_path(db, item.content_id)

        try:
            if save_path:
                _send_to_qbit(torrent_url, category, tags, save_path)
            else:
                _send_to_qbit(torrent_url, category, tags)
        except RuntimeError as exc:
            logging.warning("download_queue_worker: qbit send failed for %s: %s", video_code, exc)
            mark_failed_with_candidate(db, item.id, str(exc), torrent_url)
            return

        set_torrent_url(db, item.id, torrent_url)

        torrent_name = Path(torrent_url).stem
        tracking = insert_tracking(db, item.content_id or video_code, torrent_name, video_code)

        # Try to resolve the qbit hash so the completion poller can track progress
        torrent_hash = _find_hash(torrent_name, retries=5, delay=1.0)
        if torrent_hash:
            from ..crud.torrent_tracking import update_hash

            update_hash(db, tracking.id, torrent_hash)
            logging.info("download_queue_worker: sent %s → %s (hash %s)", video_code, torrent_name, torrent_hash)
        else:
            logging.warning("download_queue_worker: sent %s but could not resolve qbit hash — will retry in poller", video_code)

        # Item stays 'processing'; completion poller will mark it done at 100%
    finally:
        db.close()


async def download_queue_worker() -> None:
    """Asyncio background task: drip-feeds download_queue to qBittorrent."""

    loop = asyncio.get_running_loop()

    while True:
        try:
            settings = await loop.run_in_executor(None, get_settings)
            base_delay = settings.queue_base_delay_seconds
            jitter = settings.queue_jitter_seconds
            window_start = settings.queue_window_start_hour
            window_end = settings.queue_window_end_hour

            if not _is_in_window(window_start, window_end):
                await asyncio.sleep(_WINDOW_POLL)
                continue

            # Check if there's anything to do before blocking
            db = SessionLocal()
            try:
                item = get_next_pending(db)
            finally:
                db.close()

            # Poll existing processing items before picking up new ones
            await loop.run_in_executor(None, _poll_processing_items)

            if item is None:
                await asyncio.sleep(_IDLE_SLEEP)
                continue

            await loop.run_in_executor(None, _process_one)

            sleep_time = max(1.0, base_delay + random.uniform(-jitter, jitter))
            # logging.debug("download_queue_worker: sleeping %.1fs before next item", sleep_time)
            await asyncio.sleep(sleep_time)

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logging.error("download_queue_worker error: %s", exc)
            await asyncio.sleep(5)
