import asyncio
import json
import logging
import os
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

from ..crud.directory_monitor import get_all_directory_monitors, update_directory_monitor
from ..crud.file import File as FileCRUD
from ..crud.notification import cleanup_old_notifications
from ..crud.setting import get_settings
from ..models.models import DirectoryMonitor, File, Task, TaskStatus, TaskType
from ..schemas.db_helper import close_db, get_db
from ..schemas.file import FileRecord
from ..schemas.task import TaskRecord
from ..utils import calculate_next_run, find_pyscenedetect_splits, generate_filename_id, get_video_duration, is_ignored, is_pyscenedetect_split, utc_isoformat


_POLL_INTERVAL = 60  # seconds — check monitors every minute
_CLEANUP_INTERVAL = 3600  # seconds — cleanup old notifications every hour
# Bounded executor prevents thread pool exhaustion when network mounts hang past the 45s timeout.
# Hung threads can't be cancelled; capping workers limits how many can accumulate.
_SCAN_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="monitor_scan")
_UNCENSORED_FILENAME_RE = re.compile(
    r"(?:^|[-_.\s])(?:RM|UN|UC|UNCENSORED|R18)(?=$|[-_.\s])|reduc(?:ed|ing)[-_.\s]*mosaic",
    re.IGNORECASE,
)
_MONITOR_TASK_TYPE_ORDER = {
    TaskType.SCENE: 0,
    TaskType.SPLIT: 0,
    TaskType.SUBTITLE: 1,
    TaskType.REMUX: 2,
    TaskType.ANALYZE_FRAME_PACING: 3,
    TaskType.NVENC_FRAME_PACING: 3,
}
_SCENE_SPLIT_SHORT_VIDEO_MAX_SECONDS = 60 * 60


def _matches_split_scope(path: str, split_scope: str) -> bool:
    if split_scope == "both":
        return True
    is_uncensored = bool(_UNCENSORED_FILENAME_RE.search(Path(path).stem))
    return is_uncensored if split_scope == "uncensored" else not is_uncensored


def _duration_to_seconds(duration: str | int | float | None) -> float | None:
    if duration is None:
        return None
    if isinstance(duration, (int, float)):
        return float(duration) if duration > 0 else None

    parts = str(duration).strip().split(":")
    try:
        if len(parts) == 3:
            hours, minutes, seconds = parts
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
        if len(parts) == 2:
            minutes, seconds = parts
            return int(minutes) * 60 + float(seconds)
        return float(parts[0])
    except (TypeError, ValueError):
        return None


def _short_scene_split_path(path: Path) -> Path:
    return path.with_name(f"{path.stem}-001{path.suffix}")


def _mark_short_scene_split_completed(file_id: str, task_type: TaskType) -> str | None:
    """Rename <=60-minute Scene/Split candidates to -001 and record them as done."""
    db = get_db()
    try:
        record = db.query(FileRecord).filter(FileRecord.id == file_id).first()
        if not record:
            return None

        duration = record.duration
        seconds = _duration_to_seconds(duration)
        old_path = Path(record.path)
        if seconds is None and old_path.exists():
            probed_duration = get_video_duration(str(old_path))
            probed_seconds = _duration_to_seconds(probed_duration)
            if probed_seconds is not None:
                duration = str(probed_duration)
                seconds = probed_seconds
                record.duration = duration

        if seconds is None or seconds > _SCENE_SPLIT_SHORT_VIDEO_MAX_SECONDS:
            return None

        if is_pyscenedetect_split(old_path):
            return "short video already marked as split"

        new_path = _short_scene_split_path(old_path)
        if old_path.exists():
            if new_path.exists():
                return f"short video rename target already exists: {new_path.name}"
            old_path.rename(new_path)

        record.name = new_path.name
        record.path = str(new_path)
        record.status = "done"

        completed_type = TaskType.SPLIT if task_type == TaskType.ALL else task_type
        now = datetime.utcnow()
        db.add(
            TaskRecord(
                id=str(uuid.uuid4()),
                file_id=file_id,
                type=completed_type,
                status=TaskStatus.COMPLETED,
                progress=100.0,
                scene_progress=100.0 if completed_type == TaskType.SCENE else 0.0,
                split_progress=100.0 if completed_type == TaskType.SPLIT else 0.0,
                created_at=now,
                started_at=now,
                completed_at=now,
                scene_count=1 if completed_type == TaskType.SCENE else 0,
                split_count=1 if completed_type == TaskType.SPLIT else 0,
            )
        )
        db.commit()
        return "short video marked completed and renamed with -001 suffix"
    except Exception:
        db.rollback()
        raise
    finally:
        close_db(db)


def _calculate_monitor_next_run(monitor: DirectoryMonitor):
    default_timezone = "UTC" if monitor.schedule.time and not monitor.schedule.timeZone else None
    return calculate_next_run(monitor.schedule.model_dump(), default_timezone=default_timezone)


def _run_wal_checkpoint() -> None:
    """TRUNCATE WAL checkpoint: drain all WAL frames and zero the WAL file.

    PASSIVE skips frames while any reader holds an open snapshot, so the WAL
    grows unboundedly overnight.  TRUNCATE blocks until all current readers
    finish their transactions, then checkpoints every frame and truncates the
    WAL file to zero length — keeping read latency flat regardless of how many
    tasks ran overnight.
    """
    db = get_db()
    try:
        result = db.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))
        row = result.fetchone()
        if row:
            busy, log_frames, checkpointed = row
            if busy:
                logging.warning(f"WAL checkpoint: {log_frames - checkpointed} frames not checkpointed (busy readers)")
            else:
                logging.debug(f"WAL checkpoint: {checkpointed}/{log_frames} frames checkpointed, WAL truncated")
        db.commit()
    except Exception as e:
        logging.warning(f"WAL checkpoint failed: {e}")
    finally:
        close_db(db)


def _parse_utc_timestamp(ts: str) -> datetime:
    """Parse ISO timestamp (Z or +00:00 format), always returns timezone-aware UTC."""
    normalized = ts.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def monitor_scheduler(task_manager) -> None:
    """Background task that periodically checks and triggers directory monitors at scheduled times."""
    loop = asyncio.get_running_loop()
    last_cleanup = datetime.utcnow()

    while True:
        try:
            # Get all active monitors (blocking I/O, offload to executor)
            monitors = await loop.run_in_executor(None, get_all_directory_monitors)

            for monitor in monitors:
                if not monitor.isActive:
                    continue

                # Check if monitor should run now (nextRun time has passed).
                # If nextRun is None (e.g. legacy record or failed previous update),
                # treat the monitor as overdue and run it immediately.
                should_run = False
                if not monitor.nextRun:
                    logging.warning(
                        f"Monitor {monitor.directoryName} has no nextRun set — running now and computing schedule"
                    )
                    should_run = True
                else:
                    if isinstance(monitor.nextRun, str):
                        next_run_time = _parse_utc_timestamp(monitor.nextRun)
                    else:
                        next_run_time = monitor.nextRun if monitor.nextRun.tzinfo else monitor.nextRun.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) >= next_run_time:
                        should_run = True

                if should_run:
                    logging.info(f"Triggering scheduled monitor: {monitor.directoryName} (nextRun={monitor.nextRun})")
                    await run_monitor(task_manager, monitor, loop)

            # Periodically clean up old notifications and run a WAL checkpoint
            now = datetime.utcnow()
            if (now - last_cleanup).total_seconds() >= _CLEANUP_INTERVAL:
                await loop.run_in_executor(None, cleanup_old_notifications, 30)
                await loop.run_in_executor(None, _run_wal_checkpoint)
                last_cleanup = now

            # Wait before checking again
            await asyncio.sleep(_POLL_INTERVAL)

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logging.error(f"Error in monitor scheduler: {e}", exc_info=True)
            await asyncio.sleep(_POLL_INTERVAL)


def _load_video_candidates(
    directory_path: str,
    task_type: TaskType,
    cancel: threading.Event | None = None,
    split_scope: str = "both",
    frame_pacing_scope: str = "all",
    frame_pacing_resolutions: list[str] | tuple[str, ...] | str | None = None,
) -> tuple[list[str], list[str], list[str]]:
    """Walk directory, bulk-query the DB, and classify each video as to-queue or skip.

    Uses 4-5 bulk queries for the whole directory instead of up to 5 queries per
    file, preventing thousands of session open/close cycles on large directories.
    """
    _s = get_settings()
    _raw = _s.ignore_patterns
    patterns = json.loads(_raw) if isinstance(_raw, str) else (_raw or [])

    video_extensions = {".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv"}

    # Phase 1: collect all candidate paths via os.walk
    all_paths: list[str] = []
    for root, _, filenames in os.walk(directory_path):
        if cancel and cancel.is_set():
            logging.debug(f"Directory scan cancelled at {root}")
            break
        for filename in filenames:
            if Path(filename).suffix.lower() not in video_extensions:
                continue
            if is_ignored(filename, patterns):
                continue
            video_path = os.path.join(root, filename)
            if task_type in (TaskType.SPLIT, TaskType.ALL) and not _matches_split_scope(video_path, split_scope):
                continue
            all_paths.append(video_path)

    if not all_paths:
        return [], [], []

    if isinstance(frame_pacing_resolutions, str):
        if frame_pacing_resolutions in ("", "all"):
            selected_frame_pacing_resolutions: set[str] = set()
        else:
            try:
                parsed_resolutions = json.loads(frame_pacing_resolutions)
            except ValueError:
                parsed_resolutions = [frame_pacing_resolutions]
            selected_frame_pacing_resolutions = set(parsed_resolutions) if isinstance(parsed_resolutions, list) else set()
    else:
        selected_frame_pacing_resolutions = set(frame_pacing_resolutions or [])
    selected_frame_pacing_resolutions.discard("all")
    selected_frame_pacing_resolutions.discard("4k")

    # Phase 2: generate file IDs for all paths
    id_for: dict[str, str] = {p: generate_filename_id(Path(p).name, p) for p in all_paths}
    all_ids = list(id_for.values())

    # Phase 3: bulk DB queries — one session, SQLite 999-var limit respected
    def _bulk(query_fn) -> set[str]:
        results: set[str] = set()
        for i in range(0, len(all_ids), 900):
            results.update(query_fn(all_ids[i : i + 900]))
        return results

    db = get_db()
    try:
        split_disabled_ids: set[str] = set()
        if task_type in (TaskType.SPLIT, TaskType.ALL):
            split_disabled_ids = _bulk(
                lambda ids: {r.id for r in db.query(FileRecord.id).filter(
                    FileRecord.id.in_(ids), FileRecord.split_disabled == True  # noqa: E712
                ).all()}
            )
        subtitle_disabled_ids: set[str] = set()
        if task_type in (TaskType.SUBTITLE, TaskType.ALL):
            subtitle_disabled_ids = _bulk(
                lambda ids: {r.id for r in db.query(FileRecord.id).filter(
                    FileRecord.id.in_(ids), FileRecord.subtitle_disabled == True  # noqa: E712
                ).all()}
            )
        queue_disabled_ids = _bulk(
            lambda ids: {r.id for r in db.query(FileRecord.id).filter(
                FileRecord.id.in_(ids), FileRecord.queue_disabled == True  # noqa: E712
            ).all()}
        )
        active_ids = _bulk(
            lambda ids: {r.file_id for r in db.query(TaskRecord.file_id).filter(
                TaskRecord.file_id.in_(ids),
                TaskRecord.type == task_type,
                TaskRecord.status.notin_([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]),
            ).all()}
        )
        failed_ids = _bulk(
            lambda ids: {r.file_id for r in db.query(TaskRecord.file_id).filter(
                TaskRecord.file_id.in_(ids),
                TaskRecord.type == task_type,
                TaskRecord.status.in_([TaskStatus.CANCELLED, TaskStatus.FAILED]),
            ).all()}
        )
        split_done_ids: set[str] = set()
        if task_type in (TaskType.SCENE, TaskType.SPLIT, TaskType.ALL):
            split_done_ids = _bulk(
                lambda ids: {r.file_id for r in db.query(TaskRecord.file_id).filter(
                    TaskRecord.file_id.in_(ids),
                    TaskRecord.type.in_([TaskType.SPLIT, TaskType.ALL]),
                    TaskRecord.status == TaskStatus.COMPLETED,
                    TaskRecord.split_count > 0,
                ).all()}
            )
        subtitle_done_ids: set[str] = set()
        if task_type in (TaskType.SUBTITLE, TaskType.ALL):
            subtitle_done_ids = _bulk(
                lambda ids: {r.file_id for r in db.query(TaskRecord.file_id).filter(
                    TaskRecord.file_id.in_(ids),
                    TaskRecord.type.in_([TaskType.SUBTITLE, TaskType.ALL]),
                    TaskRecord.status == TaskStatus.COMPLETED,
                    TaskRecord.subtitle_progress >= 100.0,
                ).all()}
            )
        frame_pacing_done_ids: set[str] = set()
        frame_pacing_resolution_ids: set[str] | None = None
        frame_pacing_4k_ids: set[str] = set()
        frame_pacing_split_ids: set[str] = set()
        if task_type in (TaskType.ANALYZE_FRAME_PACING, TaskType.NVENC_FRAME_PACING) and frame_pacing_scope == "split":
            frame_pacing_split_ids = _bulk(
                lambda ids: {r.id for r in db.query(FileRecord.id).filter(
                    FileRecord.id.in_(ids),
                    FileRecord.parent_id.isnot(None),
                ).all()}
            )
        if task_type in (TaskType.SPLIT, TaskType.ALL, TaskType.ANALYZE_FRAME_PACING, TaskType.NVENC_FRAME_PACING) and selected_frame_pacing_resolutions:
            def _resolution_bucket(width: int | None, height: int | None) -> str | None:
                if width is None and height is None:
                    return None
                if (width is not None and width >= 3840) or (height is not None and height >= 2160):
                    return "4k"
                if height is not None and height >= 1440:
                    return "1440p"
                if height is not None and height >= 1080:
                    return "1080p"
                if height is not None and height >= 720:
                    return "720p"
                return "sd"

            frame_pacing_resolution_ids = _bulk(
                lambda ids: {
                    r.id
                    for r in db.query(FileRecord.id, FileRecord.width, FileRecord.height).filter(FileRecord.id.in_(ids)).all()
                    if _resolution_bucket(r.width, r.height) in selected_frame_pacing_resolutions
                }
            )
        if task_type in (TaskType.ANALYZE_FRAME_PACING, TaskType.NVENC_FRAME_PACING):
            frame_pacing_done_ids = _bulk(
                lambda ids: {r.file_id for r in db.query(TaskRecord.file_id).filter(
                    TaskRecord.file_id.in_(ids),
                    TaskRecord.type == task_type,
                    TaskRecord.status == TaskStatus.COMPLETED,
                ).all()}
            )
            frame_pacing_4k_ids = _bulk(
                lambda ids: {
                    r.id
                    for r in db.query(FileRecord.id, FileRecord.width, FileRecord.height).filter(FileRecord.id.in_(ids)).all()
                    if (r.width is not None and r.width >= 3840) or (r.height is not None and r.height >= 2160)
                }
            )
    finally:
        close_db(db)

    # Phase 4: classify each path using in-memory sets (no DB access)
    to_queue: list[str] = []
    skipped_paths: list[str] = []
    skip_reasons: list[str] = []

    for video_path in all_paths:
        path = Path(video_path)
        file_id = id_for[video_path]
        reason: str | None = None

        if file_id in queue_disabled_ids:
            reason = "queue_disabled=True"
        elif file_id in split_disabled_ids:
            reason = "split_disabled=True"
        elif file_id in subtitle_disabled_ids:
            reason = "subtitle_disabled=True"
        elif file_id in active_ids:
            reason = "active task already queued or processing"
        elif file_id in failed_ids:
            reason = "previously failed or cancelled"
        elif (
            task_type in (TaskType.ANALYZE_FRAME_PACING, TaskType.NVENC_FRAME_PACING)
            and frame_pacing_scope == "split"
            and file_id not in frame_pacing_split_ids
            and not is_pyscenedetect_split(path)
        ):
            reason = "not a split video"
        elif file_id in frame_pacing_done_ids:
            reason = "frame pacing already completed"
        elif file_id in frame_pacing_4k_ids:
            reason = "4K videos are not eligible for frame pacing repair"
        elif frame_pacing_resolution_ids is not None and file_id not in frame_pacing_resolution_ids:
            reason = f"resolution does not match {', '.join(sorted(selected_frame_pacing_resolutions))}"
        else:
            splits_done = False
            if task_type in (TaskType.SCENE, TaskType.SPLIT):
                short_video_reason = _mark_short_scene_split_completed(file_id, task_type)
                if short_video_reason:
                    reason = short_video_reason
                    splits_done = True
                elif file_id in split_done_ids:
                    reason = "already split (DB record)"
                    splits_done = True
                elif is_pyscenedetect_split(path):
                    reason = "file itself is a PySceneDetect split file"
                elif find_pyscenedetect_splits(path):
                    reason = "split files exist on disk"
                    splits_done = True
            elif task_type == TaskType.ALL:
                short_video_reason = _mark_short_scene_split_completed(file_id, task_type)
                if short_video_reason:
                    reason = short_video_reason
                    splits_done = True
                elif is_pyscenedetect_split(path):
                    reason = "file itself is a PySceneDetect split file"
                else:
                    splits_done = file_id in split_done_ids or bool(find_pyscenedetect_splits(path))

            # For ALL task type, only skip on subtitle completion if splits are also done.
            # A file with subtitles but no splits still needs to be queued for splitting.
            if reason is None and task_type in (TaskType.SUBTITLE, TaskType.ALL):
                subtitles_done_db = file_id in subtitle_done_ids
                subtitles_done_disk = bool(list(path.parent.glob(f"{path.stem}-*.srt")))
                if task_type == TaskType.ALL:
                    if splits_done and subtitles_done_db:
                        reason = "already split and has subtitles (DB record)"
                    elif splits_done and subtitles_done_disk:
                        reason = "split and subtitle files exist on disk"
                elif subtitles_done_db:
                    reason = "already has subtitles (DB record)"
                elif subtitles_done_disk:
                    reason = "subtitle files exist on disk"

        if reason:
            skipped_paths.append(video_path)
            skip_reasons.append(reason)
        else:
            to_queue.append(video_path)

    logging.info(
        f"_load_video_candidates: {len(to_queue)} to queue, {len(skipped_paths)} skipped "
        f"(active={len(active_ids)}, failed={len(failed_ids)}, split_done={len(split_done_ids)}, "
        f"subtitle_done={len(subtitle_done_ids)}, frame_pacing_done={len(frame_pacing_done_ids)}, "
        f"queue_disabled={len(queue_disabled_ids)}, "
        f"split_disabled={len(split_disabled_ids)}, subtitle_disabled={len(subtitle_disabled_ids)})"
    )
    return to_queue, skipped_paths, skip_reasons


def _ensure_file_record(video_path: str, directory_id: str | None) -> File:
    """Return a file model for a video path, creating a file row when possible."""
    path = Path(video_path)
    file_id = generate_filename_id(path.name, video_path)
    fallback_size = 0
    try:
        fallback_size = path.stat().st_size
    except OSError:
        pass

    if not path.exists():
        return File(
            id=file_id,
            name=path.name,
            path=video_path,
            size=fallback_size,
            duration=None,
            format=path.suffix.lstrip(".") or "",
        )

    db = get_db()
    try:
        file_crud = FileCRUD(db)
        existing_id = db.query(FileRecord.id).filter(FileRecord.id == file_id).scalar()
        if isinstance(existing_id, str) and existing_id:
            return File(
                id=existing_id,
                name=path.name,
                path=video_path,
                size=fallback_size,
                duration=None,
                format=path.suffix.lstrip(".") or None,
            )

        created = file_crud.create_file_metadata(
            name=path.name,
            path=video_path,
            size=fallback_size,
            file_type="video",
            format=path.suffix.lstrip(".") or None,
            directory_id=directory_id,
            status="unprocessed",
        )
        return File(
            id=created.id,
            name=created.name,
            path=created.path,
            size=created.size,
            duration=created.duration,
            format=created.format or path.suffix.lstrip(".") or "",
        )
    finally:
        close_db(db)


def _is_monitor_task_disabled(file_id: str | None, task_type: TaskType) -> str | None:
    """Return the disabled reason that should prevent monitor queueing."""
    if not file_id:
        return None

    db = get_db()
    try:
        record = (
            db.query(
                FileRecord.queue_disabled,
                FileRecord.split_disabled,
                FileRecord.subtitle_disabled,
            )
            .filter(FileRecord.id == file_id)
            .first()
        )
        if not record:
            return None
        if record.queue_disabled:
            return "queue_disabled=True"
        if task_type in (TaskType.SPLIT, TaskType.ALL) and record.split_disabled:
            return "split_disabled=True"
        if task_type in (TaskType.SUBTITLE, TaskType.ALL) and record.subtitle_disabled:
            return "subtitle_disabled=True"
        return None
    finally:
        close_db(db)


def _monitor_task_types(monitor: DirectoryMonitor) -> list[TaskType]:
    task_types = getattr(monitor, "taskTypes", None)
    if not isinstance(task_types, (list, tuple, set)):
        task_types = [monitor.taskType]
    normalized: list[TaskType] = []
    seen: set[TaskType] = set()
    for task_type in task_types:
        candidate = task_type if isinstance(task_type, TaskType) else TaskType(task_type)
        if candidate not in seen:
            normalized.append(candidate)
            seen.add(candidate)
    normalized = normalized or [monitor.taskType]
    return sorted(normalized, key=lambda task_type: _MONITOR_TASK_TYPE_ORDER.get(task_type, len(_MONITOR_TASK_TYPE_ORDER)))


def _has_srt_on_disk(file_path: str) -> bool:
    """Return True if any .srt file exists alongside this video (original or split siblings)."""
    try:
        path = Path(file_path)
        if path.with_suffix(".srt").exists():
            return True
        if list(path.parent.glob(f"{path.stem}-*.srt")):
            return True
        return False
    except Exception as e:
        logging.warning(f"Disk check failed for {file_path}: {e} — treating as subtitle present")
        return True


async def _fill_missing_subtitles(task_manager, monitor: DirectoryMonitor) -> tuple[int, int]:
    """Second-pass: queue SUBTITLE tasks for split files missing subtitles.

    Bulk-queries the DB in one shot to find candidates, then does per-file
    disk checks only for the small remainder, instead of N×4 round-trips.
    """
    loop = asyncio.get_running_loop()

    def _bulk_find_candidates() -> tuple[list, int]:
        db = get_db()
        try:
            all_records = (
                db.query(FileRecord)
                .filter(
                    FileRecord.directory_id == monitor.directoryId,
                    FileRecord.file_type == "video",
                    FileRecord.is_deleted == False,  # noqa: E712
                    FileRecord.queue_disabled == False,  # noqa: E712
                    FileRecord.split_disabled == False,  # noqa: E712
                    FileRecord.subtitle_disabled == False,  # noqa: E712
                )
                .all()
            )

            split_records = [
                r for r in all_records
                if r.parent_id is not None
                and "-SUB" not in Path(r.path).stem
            ]
            pre_skipped = len(all_records) - len(split_records)

            if not split_records:
                return [], pre_skipped

            record_ids = [r.id for r in split_records]

            def _bulk(query_fn) -> set[str]:
                results: set[str] = set()
                for i in range(0, len(record_ids), 900):
                    results.update(query_fn(record_ids[i : i + 900]))
                return results

            has_subtitle_ids = _bulk(
                lambda ids: {row.parent_id for row in db.query(FileRecord.parent_id).filter(
                    FileRecord.parent_id.in_(ids),
                    FileRecord.file_type == "subtitle",
                ).all()}
            )
            has_active_ids = _bulk(
                lambda ids: {row.file_id for row in db.query(TaskRecord.file_id).filter(
                    TaskRecord.file_id.in_(ids),
                    TaskRecord.type == TaskType.SUBTITLE,
                    TaskRecord.status.notin_([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]),
                ).all()}
            )
            has_failed_ids = _bulk(
                lambda ids: {row.file_id for row in db.query(TaskRecord.file_id).filter(
                    TaskRecord.file_id.in_(ids),
                    TaskRecord.type == TaskType.SUBTITLE,
                    TaskRecord.status.in_([TaskStatus.CANCELLED, TaskStatus.FAILED]),
                ).all()}
            )

            candidates = []
            for r in split_records:
                if r.id in has_subtitle_ids or r.id in has_active_ids or r.id in has_failed_ids:
                    pre_skipped += 1
                else:
                    candidates.append(r)

            return candidates, pre_skipped
        finally:
            close_db(db)

    # Use _SCAN_EXECUTOR (not default pool) — _bulk_find_candidates does DB + disk I/O
    # and can hold a thread for minutes on a slow mount.
    candidates, pre_skipped = await loop.run_in_executor(_SCAN_EXECUTOR, _bulk_find_candidates)

    queued = 0
    skipped = pre_skipped

    for record in candidates:
        # Use _SCAN_EXECUTOR (bounded to 4) so hung network-mount I/O cannot
        # exhaust the default thread pool that DB writes (update_task, get_settings)
        # also rely on.  A full default pool causes a complete event loop freeze.
        has_disk = await loop.run_in_executor(_SCAN_EXECUTOR, _has_srt_on_disk, record.path)
        if has_disk:
            skipped += 1
            continue

        try:
            file = File(
                id=record.id,
                name=record.name,
                path=record.path,
                size=0,
                duration=None,
                format=Path(record.path).suffix.lstrip("."),
            )
            task = Task(
                id=str(uuid.uuid4()),
                file=file,
                type=TaskType.SUBTITLE,
                subtitleLanguage=monitor.subtitleLanguage,
                status=TaskStatus.QUEUED,
                createdAt=utc_isoformat(datetime.utcnow()),
                delete_video_after_completion=False,
            )
            actually_queued, _ = await task_manager.add_task(task)
            if actually_queued:
                queued += 1
                logging.info(f"fill_missing_subtitles: queued SUBTITLE task for {record.name}")
            else:
                skipped += 1
        except Exception as e:
            logging.warning(f"fill_missing_subtitles: failed to queue task for {record.path}: {e}")
            skipped += 1

    logging.info(f"fill_missing_subtitles: queued {queued}, skipped {skipped} for monitor {monitor.directoryName}")
    return queued, skipped


async def run_monitor(task_manager, monitor, loop) -> tuple[int, int]:
    """Run a monitor: scan directory for videos, create tasks, update schedule.

    Returns:
        Tuple of (queued, skipped) counts.
    """
    try:
        queued = 0
        skipped = 0
        for task_type in _monitor_task_types(monitor):
            # All blocking DB reads and filesystem I/O happen in a single executor call.
            # Timeout guards against os.walk hanging on an unresponsive network mount.
            # cancel_event signals the thread to stop walking on timeout so it exits
            # cleanly rather than accumulating indefinitely in the pool.
            cancel_event = threading.Event()
            try:
                to_queue, skipped_paths, skip_reasons = await asyncio.wait_for(
                    loop.run_in_executor(
                        _SCAN_EXECUTOR,
                        _load_video_candidates,
                        monitor.directoryPath,
                        task_type,
                        cancel_event,
                        monitor.splitScope if isinstance(getattr(monitor, "splitScope", None), str) else "both",
                        monitor.framePacingScope if isinstance(getattr(monitor, "framePacingScope", None), str) else "all",
                        monitor.framePacingResolutions if isinstance(getattr(monitor, "framePacingResolutions", None), list) else getattr(monitor, "framePacingResolution", "all"),
                    ),
                    timeout=45.0,
                )
            except asyncio.TimeoutError:
                cancel_event.set()
                logging.warning(f"Monitor {monitor.directoryName}: directory scan timed out after 45s for {task_type.value}, skipping (cancellation signalled; {_SCAN_EXECUTOR._work_queue.qsize()} items queued)")
                continue

            for path_str, reason in zip(skipped_paths, skip_reasons):
                logging.info(f"Skipping {Path(path_str).name} for {task_type.value}: {reason}")

            skipped += len(skipped_paths)
            for video_path in to_queue:
                try:
                    path = Path(video_path)
                    file = _ensure_file_record(video_path, monitor.directoryId)
                    disabled_reason = _is_monitor_task_disabled(file.id, task_type)
                    if disabled_reason:
                        skipped += 1
                        logging.info(f"Skipping {path.name} for {task_type.value}: {disabled_reason}")
                        continue
                    if task_type in (TaskType.SCENE, TaskType.SPLIT, TaskType.ALL):
                        short_video_reason = _mark_short_scene_split_completed(file.id, task_type)
                        if short_video_reason:
                            skipped += 1
                            logging.info(f"Skipping {path.name} for {task_type.value}: {short_video_reason}")
                            continue

                    task = Task(
                        id=str(uuid.uuid4()),
                        file=file,
                        type=task_type,
                        subtitleLanguage=monitor.subtitleLanguage if task_type in [TaskType.SUBTITLE, TaskType.ALL] else None,
                        status=TaskStatus.QUEUED,
                        createdAt=utc_isoformat(datetime.utcnow()),
                        delete_video_after_completion=monitor.deleteVideoAfterCompletion,
                        nvenc_overwrite_original=bool(getattr(monitor, "nvencOverwriteOriginal", False)) if task_type in (TaskType.ANALYZE_FRAME_PACING, TaskType.NVENC_FRAME_PACING) else False,
                    )

                    add_task_result = await task_manager.add_task(task)
                    if isinstance(add_task_result, tuple):
                        actually_queued = bool(add_task_result[0])
                    else:
                        actually_queued = bool(add_task_result)
                    if actually_queued:
                        queued += 1
                        logging.info(f"Created {task_type.value} task for {path.name} from monitor {monitor.directoryName}")
                    else:
                        skipped += 1
                        logging.info(f"Skipping {path.name} for {task_type.value}: duplicate task already active")

                except Exception as e:
                    logging.warning(f"Failed to create {task_type.value} task for {video_path} in monitor {monitor.directoryName}: {e}")

        # Second pass: queue SUBTITLE tasks for videos missing subtitles.
        # Timeout guards against per-file disk checks hanging on a slow mount
        # and holding this coroutine open indefinitely.
        if monitor.fillMissingSubtitles:
            try:
                missing_queued, missing_skipped = await asyncio.wait_for(
                    _fill_missing_subtitles(task_manager, monitor),
                    timeout=120.0,
                )
            except asyncio.TimeoutError:
                logging.warning(
                    f"Monitor {monitor.directoryName}: fill_missing_subtitles timed out after 120s — skipping second pass"
                )
                missing_queued, missing_skipped = 0, 0
            queued += missing_queued
            skipped += missing_skipped

        # Update monitor's lastRun and nextRun
        now = datetime.now(timezone.utc)
        next_run = _calculate_monitor_next_run(monitor)

        updated_monitor = DirectoryMonitor(
            id=monitor.id,
            directoryId=monitor.directoryId,
            directoryName=monitor.directoryName,
            directoryPath=monitor.directoryPath,
            taskType=monitor.taskType,
            taskTypes=_monitor_task_types(monitor),
            subtitleLanguage=monitor.subtitleLanguage,
            schedule=monitor.schedule,
            isActive=monitor.isActive,
            deleteVideoAfterCompletion=monitor.deleteVideoAfterCompletion,
            fillMissingSubtitles=monitor.fillMissingSubtitles,
            splitScope=monitor.splitScope if isinstance(getattr(monitor, "splitScope", None), str) else "both",
            framePacingScope=monitor.framePacingScope if isinstance(getattr(monitor, "framePacingScope", None), str) else "all",
            framePacingResolution="all",
            framePacingResolutions=monitor.framePacingResolutions if isinstance(getattr(monitor, "framePacingResolutions", None), list) else [],
            nvencOverwriteOriginal=bool(getattr(monitor, "nvencOverwriteOriginal", False)),
            lastRun=utc_isoformat(now),
            nextRun=utc_isoformat(next_run),
            createdAt=monitor.createdAt,
        )

        await loop.run_in_executor(None, update_directory_monitor, updated_monitor)
        logging.info(f"Monitor {monitor.directoryName} completed: queued {queued} task(s), skipped {skipped} file(s), next run at {next_run}")

        return queued, skipped

    except Exception as e:
        logging.error(f"Failed to run monitor {monitor.directoryName}: {e}", exc_info=True)
        return 0, 0
