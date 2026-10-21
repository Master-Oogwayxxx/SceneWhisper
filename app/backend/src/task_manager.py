import asyncio
import json
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict

from .crud.directory import Directory
from .crud.deleted_file import record_deleted_file
from .crud.file import File as FileCRUD
from .crud.scene import Scene as SceneCRUD
from .crud.setting import get_settings
from .crud.task import bulk_update_queue_positions, create_task, delete_task, get_all_tasks, get_task, get_task_stats, update_task
from .models.models import File, ProcessingStage, Task, TaskStatus, TaskType
from .models.notification import NotificationType
from .notification_service import emit_notification
from .schemas.db_helper import close_db, get_db
from .schemas.file import FileRecord
from .schemas.task import TaskRecord
from .utils import _elapsed_seconds_since_start, _in_hour_window, _local_timezone, _seconds_until, _stage_elapsed_seconds, extract_normalized_video_code, get_scenes, utc_isoformat

_PROCESSING_DAY_KEYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
_NO_SCENES_ERROR = "Scene detection returned no scenes"
_SOURCE_FILE_NOT_FOUND_ERRORS = {
    "Source file not found",
    "Source File Not Found",
}
_PROGRESS_PERSIST_INTERVAL_SECONDS = 1.0
_PROGRESS_PERSIST_DELTA = 1.0


def _should_delete_failed_task(error: str | None) -> bool:
    return error == _NO_SCENES_ERROR or error in _SOURCE_FILE_NOT_FOUND_ERRORS


def _processing_window_for_day(settings, day_index: int) -> tuple[int, int]:
    raw_windows = getattr(settings, "processing_hours_windows", None)
    if raw_windows:
        try:
            windows = json.loads(raw_windows) if isinstance(raw_windows, str) else raw_windows
            day_window = windows.get(_PROCESSING_DAY_KEYS[day_index], {})
            return int(day_window.get("start", settings.processing_hours_start)), int(day_window.get("end", settings.processing_hours_end))
        except (TypeError, ValueError, AttributeError, json.JSONDecodeError):
            logging.warning("Invalid processing_hours_windows setting; falling back to global processing hours.")
    return settings.processing_hours_start, settings.processing_hours_end


def _processing_allowed_now(settings, now: datetime) -> bool:
    day_flags = [
        settings.processing_mon,
        settings.processing_tue,
        settings.processing_wed,
        settings.processing_thu,
        settings.processing_fri,
        settings.processing_sat,
        settings.processing_sun,
    ]
    if not any(day_flags):
        return False

    today = now.weekday()
    current_hour = now.hour
    start, end = _processing_window_for_day(settings, today)
    if day_flags[today] and _in_hour_window(current_hour, start, end):
        return True

    previous_day = (today - 1) % 7
    previous_start, previous_end = _processing_window_for_day(settings, previous_day)
    return (
        day_flags[previous_day]
        and previous_start > previous_end
        and current_hour <= previous_end
    )


_STAGE_LABELS: dict[ProcessingStage, str] = {
    ProcessingStage.SCENE_DETECTION: "scene detection",
    ProcessingStage.VIDEO_SPLITTING: "video splitting",
    ProcessingStage.VIDEO_REENCODING: "video re-encoding",
    ProcessingStage.VIDEO_FRAME_PACING_ANALYSIS: "frame pacing analysis",
    ProcessingStage.VIDEO_FRAME_PACING_REPAIR: "frame pacing repair",
    ProcessingStage.VIDEO_REMUXING: "video remuxing",
    ProcessingStage.VIDEO_MERGING: "video merging",
    ProcessingStage.SUBTITLE_GENERATION: "subtitle generation",
}

DETECTOR_FALLBACK_ORDER = ["content", "adaptive", "threshold"]

# Short task metadata reads/writes are latency-sensitive for monitor runs and
# API responsiveness. Keep them off asyncio's shared default executor so slow
# filesystem work elsewhere cannot starve task queue bookkeeping.
_TASK_DB_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="task_db")


def _format_timecode_to_3_decimals(timecode_str: str) -> str:
    """Convert PySceneDetect timecode format (HH:MM:SS.cc) to frontend format (HH:MM:SS.mmm)."""
    parts = timecode_str.split(":")
    h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
    seconds_total = h * 3600 + m * 60 + s
    h_out = int(seconds_total // 3600)
    m_out = int((seconds_total % 3600) // 60)
    s_out = seconds_total % 60
    return f"{h_out:02d}:{m_out:02d}:{s_out:06.3f}"


def _parse_duration_seconds(duration: str | int | float | None) -> float | None:
    if duration is None:
        return None
    if isinstance(duration, (int, float)):
        return float(duration)
    try:
        parts = [float(part) for part in duration.split(":")]
    except (AttributeError, ValueError):
        return None
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return hours * 3600 + minutes * 60 + seconds
    if len(parts) == 2:
        minutes, seconds = parts
        return minutes * 60 + seconds
    if len(parts) == 1:
        return parts[0]
    return None


def _scene_fps_from_file(file: "File | None", fallback: float = 30.0) -> float:
    """Return a safe positive FPS value for rebuilding cached scenes."""
    fps = getattr(file, "fps", None) if file else None
    try:
        if fps is not None and float(fps) > 0:
            return float(fps)
    except (TypeError, ValueError):
        pass
    return fallback


class TaskManager:
    def __init__(self):
        self.tasks_db: Dict[str, Task] = {}
        self.task_queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        self.is_processing = False
        self._cancel_events: Dict[str, threading.Event] = {}
        self._progress_snapshots: dict[str, tuple[int, datetime]] = {}
        # {task_id: (last_elapsed_seconds, time_of_last_change)}
        self._persisted_progress: dict[str, tuple[float, ProcessingStage, float]] = {}
        self._processing_tasks: dict[str, asyncio.Task] = {}
        self._downstream_processing_lock = asyncio.Lock()
        self._scene_detection_condition = asyncio.Condition()
        self._active_scene_detections = 0
        self._paused_tasks: set[str] = set()  # track tasks paused mid-processing
        self._pending_notifications: set[asyncio.Task] = set()  # track notification tasks to prevent memory leak
        self._notification_semaphore: asyncio.Semaphore = asyncio.Semaphore(20)  # cap concurrent notification tasks
        self.is_globally_paused: bool = False
        self._globally_paused_task_ids: set[str] = set()

    def _refresh_processing_state(self) -> None:
        self.is_processing = any(not task.done() for task in self._processing_tasks.values())

    async def _acquire_scene_detection_slot(self, limit: int) -> None:
        """Reserve a detector slot before exposing a task as processing."""
        effective_limit = max(1, min(3, int(limit or 1)))
        async with self._scene_detection_condition:
            await self._scene_detection_condition.wait_for(
                lambda: self._active_scene_detections < effective_limit
            )
            self._active_scene_detections += 1

    async def _release_scene_detection_slot(self) -> None:
        async with self._scene_detection_condition:
            self._active_scene_detections -= 1
            self._scene_detection_condition.notify_all()

    async def _emit_notification_tracked(
        self,
        type: "NotificationType",
        title: str,
        message: str,
        task_id: str | None = None,
        file_id: str | None = None,
    ) -> None:
        """Emit notification and track the task to prevent memory leaks.

        A semaphore caps concurrent notification tasks so bulk runs with many
        files cannot flood the event loop or WebSocket send buffers.
        """
        sem = self._notification_semaphore

        async def _guarded():
            async with sem:
                await emit_notification(type, title, message, task_id, file_id)

        task = asyncio.create_task(_guarded())
        self._pending_notifications.add(task)
        task.add_done_callback(self._pending_notifications.discard)

    async def _maybe_queue_subtitle_task(self, merged_file: "File", *, had_subtitles: bool) -> None:
        """Queue a SUBTITLE task for the merged file when original inputs had subtitles."""
        if not had_subtitles:
            return
        subtitle_task = Task(
            id=str(uuid.uuid4()),
            file=merged_file,
            type=TaskType.SUBTITLE,
            status=TaskStatus.QUEUED,
            createdAt=datetime.now(timezone.utc).isoformat(),
        )
        logging.info(f"[TaskManager] Queuing SUBTITLE task {subtitle_task.id} for merged file {merged_file.name}")
        await self.add_task(subtitle_task)

    def get_task(self, task_id: str) -> Task | None:
        """Get a specific task"""
        if task_id in self.tasks_db:
            return self.tasks_db[task_id]

        return get_task(task_id)

    def get_all_tasks(self) -> list[Task]:
        """Get all tasks"""
        return get_all_tasks()

    def delete_task(self, task_id: str) -> bool:
        """Delete a task"""
        # First, always attempt to delete from the database
        # This ensures even tasks that might not be in memory are deleted
        db_deleted = delete_task(task_id)

        # Then remove from in-memory cache if present
        if task_id in self.tasks_db:
            del self.tasks_db[task_id]
            return True

        # If we successfully deleted from DB but weren't in memory, return True anyway
        return db_deleted

    async def cancel_task(self, task_id: str, reason: str = "") -> bool:
        """Cancel a task"""
        task = self.tasks_db.get(task_id)
        if task:
            was_processing = task.status == TaskStatus.PROCESSING
            task.status = TaskStatus.CANCELLED
            if reason:
                task.error = f"Auto-cancelled: {reason}"
            elif was_processing and task.currentStage and task.currentStage != ProcessingStage.COMPLETED:
                stage_label = _STAGE_LABELS.get(task.currentStage)
                if stage_label:
                    task.error = f"Cancelled during {stage_label}"
            task.completedAt = utc_isoformat(datetime.utcnow())

            _loop = asyncio.get_running_loop()
            await _loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)

            file_name = task.file.name if task.file else "merge task"
            file_id = task.file.id if task.file else None
            await self._emit_notification_tracked(
                NotificationType.TASK_CANCELLED,
                "Task Cancelled",
                f"'{file_name}' was cancelled",
                task_id=task.id,
                file_id=file_id,
            )

            await self._cleanup_created_files(task_id, [])

            if task_id in self._cancel_events:
                self._cancel_events[task_id].set()

            # Cancel the asyncio task directly so run_in_executor is interrupted
            processing_task = self._processing_tasks.get(task_id)
            if processing_task and not processing_task.done():
                processing_task.cancel()

            # Clean up watchdog snapshot
            self._progress_snapshots.pop(task_id, None)
            # Evict from memory; for PROCESSING tasks process_video's
            # CancelledError handler will also pop (safe — .pop uses a default).
            self.tasks_db.pop(task_id, None)

            return True

        # If task is not in memory, try to find it in DB
        db_task = get_task(task_id)
        if db_task:
            db_task.status = TaskStatus.CANCELLED
            if reason:
                db_task.error = f"Auto-cancelled: {reason}"
            db_task.completedAt = utc_isoformat(datetime.utcnow())
            _loop = asyncio.get_running_loop()
            await _loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, db_task)

            file_name = db_task.file.name if db_task.file else "merge task"
            file_id = db_task.file.id if db_task.file else None
            await self._emit_notification_tracked(
                NotificationType.TASK_CANCELLED,
                "Task Cancelled",
                f"'{file_name}' was cancelled",
                task_id=db_task.id,
                file_id=file_id,
            )

            return True

        return False

    async def pause_task(self, task_id: str) -> bool:
        """
        Pause a task. If processing, signal graceful stop and update status.
        If queued, just update status to PAUSED.
        Returns True if successful, False otherwise.
        """
        try:
            task = self.get_task(task_id)
            if not task:
                return False

            # Validate task can be paused
            if task.status not in [TaskStatus.QUEUED, TaskStatus.PROCESSING]:
                return False

            original_status = task.status

            # Update in-memory task first
            task.status = TaskStatus.PAUSED
            task.pausedAt = utc_isoformat(datetime.utcnow())

            # Persist to DB
            _loop = asyncio.get_running_loop()
            await _loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)

            if original_status == TaskStatus.PROCESSING:
                self._paused_tasks.add(task_id)

                # Signal the cancel event so blocking executor work (detect_scenes) exits
                if task_id in self._cancel_events:
                    self._cancel_events[task_id].set()

                # Cancel the running asyncio task; CancelledError handler preserves PAUSED state
                processing_task = self._processing_tasks.get(task_id)
                if processing_task and not processing_task.done():
                    processing_task.cancel()

            logging.info(f"Task {task_id} paused successfully")
            return True

        except Exception as e:
            logging.error(f"Failed to pause task {task_id}: {e}")
            return False

    async def unpause_task(self, task_id: str) -> bool:
        """
        Unpause a paused task (paused → queued).
        Re-adds task to queue for processing.
        Returns True if successful, False otherwise.
        """
        try:
            task = self.get_task(task_id)
            if not task:
                return False

            # Validate task can be unpaused
            if task.status != TaskStatus.PAUSED:
                return False

            # Update in-memory task first
            task.status = TaskStatus.QUEUED
            task.pausedAt = None

            # Persist to DB
            _loop = asyncio.get_running_loop()
            await _loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)

            # Clear paused tracking so process_video doesn't bail out early
            self._paused_tasks.discard(task_id)

            # Re-add task to queue for processing
            await self._enqueue_with_priority(task_id)
            logging.info(f"Task {task_id} unpaused and re-queued successfully")
            return True

        except Exception as e:
            logging.error(f"Failed to unpause task {task_id}: {e}")
            return False

    async def pause_all(self) -> None:
        """
        Pause all active (QUEUED or PROCESSING) tasks globally.

        - Set is_globally_paused flag to True
        - Iterate through all tasks with QUEUED or PROCESSING status
        - Pause each matching task and track its ID in _globally_paused_task_ids
        - Send single "tasks_paused_all" notification to all clients
        """
        self.is_globally_paused = True
        self._globally_paused_task_ids.clear()

        try:
            for task in list(self.tasks_db.values()):
                if task.status in (TaskStatus.QUEUED, TaskStatus.PROCESSING):
                    success = await self.pause_task(task.id)
                    if success:
                        self._globally_paused_task_ids.add(task.id)

            # Send single notification for all paused tasks
            await emit_notification(
                NotificationType.TASK_PAUSED,
                "All Tasks Paused",
                f"Paused {len(self._globally_paused_task_ids)} active tasks",
            )
            logging.info(f"[pause_all] Paused {len(self._globally_paused_task_ids)} tasks globally")
        except Exception as e:
            logging.error(f"[pause_all] Error pausing all tasks: {e}")

    async def unpause_all(self) -> None:
        """
        Unpause all tasks that were paused by pause_all.

        - Set is_globally_paused flag to False
        - For each task ID in _globally_paused_task_ids:
          - Try to call unpause_task, silently skip if task no longer exists or ID not found
        - Clear _globally_paused_task_ids
        - Send single "tasks_unpaused_all" notification to all clients
        """
        self.is_globally_paused = False
        unpaused_count = 0

        try:
            for task_id in list(self._globally_paused_task_ids):
                try:
                    success = await self.unpause_task(task_id)
                    if success:
                        unpaused_count += 1
                except Exception:
                    # Silently skip if task no longer exists or ID is not found
                    pass

            self._globally_paused_task_ids.clear()

            # Send single notification for all unpaused tasks
            await emit_notification(
                NotificationType.TASK_UNPAUSED,
                "All Tasks Resumed",
                f"Resumed {unpaused_count} tasks",
            )
            logging.info(f"[unpause_all] Resumed {unpaused_count} tasks globally")
        except Exception as e:
            logging.error(f"[unpause_all] Error unpausing all tasks: {e}")

    async def reorder_queue(self, task_ids: list[str], position: str) -> None:
        """Move specified queued task IDs to the top or bottom of the in-memory queue."""
        try:
            all_entries: list[tuple] = []
            while True:
                try:
                    entry = self.task_queue.get_nowait()
                    self.task_queue.task_done()
                    all_entries.append(entry)
                except asyncio.QueueEmpty:
                    break

            target_set = set(task_ids)
            others = [e for e in all_entries if e[2] not in target_set]
            targets = [e for e in all_entries if e[2] in target_set]

            # Override rank for explicit position: -1 = before all type-ranked, len+1 = after all
            max_rank = len(all_entries) + 1
            if position == "top":
                repositioned = [(-1, e[1], e[2]) for e in targets]
                ordered = repositioned + others
            else:
                repositioned = [(max_rank, e[1], e[2]) for e in targets]
                ordered = others + repositioned

            for entry in ordered:
                await self.task_queue.put(entry)

            ordered_ids = [e[2] for e in ordered]
            _loop = asyncio.get_running_loop()
            await _loop.run_in_executor(_TASK_DB_EXECUTOR, bulk_update_queue_positions, ordered_ids)

            logging.info(f"[reorder_queue] Moved {len(targets)} tasks to {position}")
        except Exception as e:
            logging.error(f"Error reordering queue: {e}")

    async def reorder_queue_custom(self, task_ids: list[str]) -> None:
        """Set queue_position for tasks in exact order given."""
        _loop = asyncio.get_running_loop()
        await _loop.run_in_executor(_TASK_DB_EXECUTOR, bulk_update_queue_positions, task_ids)

    async def shutdown(self) -> None:
        """Gracefully shutdown TaskManager by awaiting all pending notifications."""
        if self._pending_notifications:
            logging.info(f"Waiting for {len(self._pending_notifications)} pending notifications...")
            await asyncio.gather(*self._pending_notifications, return_exceptions=True)
            self._pending_notifications.clear()

    async def clear_queue(self) -> None:
        """
        Remove all tasks with QUEUED status from the in-memory queue.
        Non-QUEUED tasks are preserved and re-added.
        """
        try:
            cleared_count = 0
            entries_to_readd: list[tuple] = []

            while True:
                try:
                    entry = self.task_queue.get_nowait()
                    self.task_queue.task_done()
                    task_id = entry[2]

                    task = self.tasks_db.get(task_id)
                    if task and task.status != TaskStatus.QUEUED:
                        entries_to_readd.append(entry)
                    elif not task:
                        entries_to_readd.append(entry)
                    else:
                        cleared_count += 1
                except asyncio.QueueEmpty:
                    break

            for entry in entries_to_readd:
                await self.task_queue.put(entry)

            logging.info(f"Cleared {cleared_count} queued tasks from TaskManager queue")
        except Exception as e:
            logging.error(f"Error clearing queue: {e}")

    def get_stats(self) -> dict:
        """Get processing statistics"""
        return get_task_stats()

    async def _cleanup_created_files(self, task_id: str, created_files: list[Path]) -> None:
        """Delete all files tracked in created_files, logging each deletion.

        Each unlink runs in the executor so a hung network mount cannot block
        the event loop during cancel/fail cleanup.
        """
        loop = asyncio.get_running_loop()

        async def _unlink(p: Path) -> None:
            try:
                await loop.run_in_executor(None, lambda: p.unlink(missing_ok=True))
                logging.info(f"[Task {task_id}] Deleted partial file: {p}")
            except Exception as e:
                logging.warning(f"[Task {task_id}] Could not delete partial file {p}: {e}")

        await asyncio.gather(*[_unlink(p) for p in created_files])

    async def _cleanup_partial_split_outputs(
        self,
        task_id: str,
        source_path: str | Path,
        scene_count: int,
        created_files: list[Path],
    ) -> None:
        """Delete partial split segments and remove them from created_files.

        Args:
            task_id: Task identifier for cleanup logging.
            source_path: Original video path used as the split prefix.
            scene_count: Number of expected split outputs.
            created_files: Mutable list of paths eligible for failure cleanup.
        """
        from .processor import split_output_paths

        split_paths = {Path(p) for p in split_output_paths(source_path, scene_count)}
        if not split_paths:
            return
        created_files[:] = [p for p in created_files if Path(p) not in split_paths]
        await self._cleanup_created_files(task_id, list(split_paths))

    def _track_new_split_files(self, task: Task, scenes: list):
        """Track newly created split video files"""
        try:
            # Get directory and file information
            parent_dir = Path(task.file.path).parent
            video_name = Path(task.file.path).stem

            # Track each new split file
            for i, scene in enumerate(scenes):
                segment_filename = f"{video_name}-{i + 1:03}.mp4"
                segment_path = parent_dir / segment_filename

                logging.info(f"Checking for split segment: {segment_path.exists()} at {segment_path}")
                if segment_path.exists():
                    # Create file metadata for this segment
                    db = get_db()
                    try:
                        file_crud = FileCRUD(db)

                        # Assuming scene is a tuple of (start_timecode_obj, end_timecode_obj)
                        start_tc, end_tc = scene
                        # Calculate duration in seconds using the objects
                        duration_seconds = end_tc.get_seconds() - start_tc.get_seconds()

                        # Format as HH:MM:SS
                        duration_formatted = f"{int(duration_seconds // 3600):02}:{int((duration_seconds % 3600) // 60):02}:{int(duration_seconds % 60):02}"

                        logging.info(f"Tracking new split file: {segment_path} with duration {duration_formatted}")

                        file_metadata = file_crud.get_or_create_file_metadata(
                            name=segment_filename,
                            path=str(segment_path),
                            size=segment_path.stat().st_size,
                            file_type="video",
                            duration=duration_formatted,
                            format=".mp4",
                            directory_id=self._get_directory_id_for_path(str(parent_dir)),
                        )

                        # Set parent relationship for the split segment
                        file_crud.set_parent_for_file(file_metadata.id, task.file.id)
                    finally:
                        close_db(db)

        except Exception as e:
            logging.error(f"Error tracking split files for task {task.id}: {e}")
            # Continue with task completion despite errors in file tracking

    def _track_new_subtitle_files(self, task: Task):
        """Track newly created subtitle files"""
        try:
            parent_dir = Path(task.file.path).parent
            video_name = Path(task.file.path).stem

            db = get_db()
            try:
                scene_crud = SceneCRUD(db)
                db_scenes = scene_crud.get_scenes_for_file(task.file.id)
            finally:
                close_db(db)

            if db_scenes:
                candidates = [(f"{video_name}-{i + 1:03}.srt", parent_dir / f"{video_name}-{i + 1:03}.srt") for i in range(len(db_scenes))]
            else:
                # No split segments — subtitle was generated for the original file
                srt_name = f"{video_name}.srt"
                candidates = [(srt_name, parent_dir / srt_name)]

            for subtitle_filename, subtitle_path in candidates:
                if subtitle_path.exists():
                    db = get_db()
                    try:
                        file_crud = FileCRUD(db)
                        file_metadata = file_crud.get_or_create_file_metadata(
                            name=subtitle_filename,
                            path=str(subtitle_path),
                            size=subtitle_path.stat().st_size,
                            file_type="subtitle",
                            format=".srt",
                            directory_id=self._get_directory_id_for_path(str(parent_dir)),
                        )
                        file_crud.set_parent_for_file(file_metadata.id, task.file.id)
                    finally:
                        close_db(db)

        except Exception as e:
            logging.error(f"Error tracking subtitle files for task {task.id}: {e}")
            # Continue with task completion despite errors in file tracking

    def _track_nvenc_output_file(self, task: Task, output_path: str, overwrite_original: bool) -> None:
        """Register NVENC task output immediately so it appears without a rescan."""
        try:
            from .utils import get_video_metadata

            output_file = Path(output_path)
            if not output_file.exists():
                logging.warning(f"NVENC output missing when tracking task {task.id}: {output_path}")
                return

            metadata = get_video_metadata(output_path)
            db = get_db()
            try:
                file_crud = FileCRUD(db)
                directory_id = self._get_directory_id_for_path(str(output_file.parent))
                synced_record, _ = file_crud.sync_file_metadata(
                    name=output_file.name,
                    path=output_path,
                    size=output_file.stat().st_size,
                    file_type="video",
                    duration=metadata.get("duration"),
                    format=output_file.suffix or ".mp4",
                    directory_id=directory_id,
                    width=metadata.get("width"),
                    height=metadata.get("height"),
                    fps=metadata.get("fps"),
                    codec=metadata.get("codec"),
                    bitrate=metadata.get("bitrate"),
                )

                if not overwrite_original and task.file:
                    file_crud.set_parent_for_file(synced_record.id, task.file.id)

                logging.info(
                    f"[Task {task.id}] Registered NVENC output: {output_path} "
                    f"(overwrite_original={overwrite_original}, duration={metadata.get('duration')}, codec={metadata.get('codec')})"
                )
            finally:
                close_db(db)
        except Exception as e:
            logging.error(f"Error tracking NVENC output for task {task.id}: {e}")
            # Continue with task completion despite errors in file tracking

    def _track_remux_output_file(self, task: Task, output_path: str) -> None:
        """Refresh remuxed video metadata immediately so it appears without a rescan."""
        try:
            from .utils import get_video_metadata

            output_file = Path(output_path)
            if not output_file.exists():
                logging.warning(f"Remux output missing when tracking task {task.id}: {output_path}")
                return

            metadata = get_video_metadata(output_path)
            db = get_db()
            try:
                file_crud = FileCRUD(db)
                synced_record, _ = file_crud.sync_file_metadata(
                    name=output_file.name,
                    path=output_path,
                    size=output_file.stat().st_size,
                    file_type="video",
                    duration=metadata.get("duration"),
                    format=output_file.suffix or ".mp4",
                    directory_id=self._get_directory_id_for_path(str(output_file.parent)),
                    width=metadata.get("width"),
                    height=metadata.get("height"),
                    fps=metadata.get("fps"),
                    codec=metadata.get("codec"),
                    bitrate=metadata.get("bitrate"),
                )
                if task.file:
                    task.file.size = synced_record.size
                    task.file.duration = synced_record.duration
                    task.file.format = synced_record.format
                    task.file.width = synced_record.width
                    task.file.height = synced_record.height
                    task.file.fps = synced_record.fps
                    task.file.codec = synced_record.codec
                    task.file.bitrate = synced_record.bitrate

                logging.info(f"[Task {task.id}] Refreshed remuxed file metadata: {output_path}")
            finally:
                close_db(db)
        except Exception as e:
            logging.error(f"Error tracking remux output for task {task.id}: {e}")

    def _get_directory_id_for_path(self, path: str) -> str:
        """Get directory ID for a given path"""
        try:
            db = get_db()
            try:
                # Get or create directory record
                directory_crud = Directory(db)
                directory_record = directory_crud.get_or_create_directory(name=Path(path).name or "root", path=path)
                return directory_record.id
            finally:
                close_db(db)
        except Exception as e:
            logging.error(f"Error getting directory ID for path {path}: {e}")
            return "unknown_directory"

    async def update_task_progress(self, task_id: str, progress: float, stage: ProcessingStage):
        """Update task progress for the given stage."""
        if task_id in self.tasks_db:
            loop = asyncio.get_running_loop()
            task = self.tasks_db[task_id]
            previous_stage = task.currentStage
            if stage == ProcessingStage.SCENE_DETECTION:
                task.scene_progress = progress
                if progress >= 100.0:
                    task.scene_elapsed_seconds = _stage_elapsed_seconds(task, datetime.utcnow())
            elif stage == ProcessingStage.VIDEO_SPLITTING:
                task.split_progress = progress
                if progress >= 100.0:
                    task.split_elapsed_seconds = _stage_elapsed_seconds(task, datetime.utcnow())
            elif stage == ProcessingStage.VIDEO_REMUXING:
                task.split_progress = progress
                if progress >= 100.0:
                    task.split_elapsed_seconds = _stage_elapsed_seconds(task, datetime.utcnow())
            elif stage == ProcessingStage.VIDEO_FRAME_PACING_ANALYSIS:
                task.split_progress = progress
                if progress >= 100.0:
                    task.split_elapsed_seconds = _stage_elapsed_seconds(task, datetime.utcnow())
            elif stage == ProcessingStage.VIDEO_FRAME_PACING_REPAIR:
                task.split_progress = progress
                if progress >= 100.0:
                    task.split_elapsed_seconds = _stage_elapsed_seconds(task, datetime.utcnow())
            elif stage == ProcessingStage.VIDEO_MERGING:
                task.merge_progress = progress
            elif stage == ProcessingStage.SUBTITLE_GENERATION:
                task.subtitle_progress = progress
                if progress >= 100.0:
                    task.subtitle_elapsed_seconds = _stage_elapsed_seconds(task, datetime.utcnow())
            if stage:
                task.currentStage = stage
            task.elapsedSeconds = _elapsed_seconds_since_start(task, datetime.utcnow())
            now = time.monotonic()
            last_persisted = self._persisted_progress.get(task_id)
            should_persist = (
                last_persisted is None
                or previous_stage != stage
                or progress >= 100.0
                or abs(progress - last_persisted[2]) >= _PROGRESS_PERSIST_DELTA
                or now - last_persisted[0] >= _PROGRESS_PERSIST_INTERVAL_SECONDS
            )
            if should_persist:
                self._persisted_progress[task_id] = (now, stage, progress)
                await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)
                if progress >= 100.0:
                    self._persisted_progress.pop(task_id, None)

    async def _watchdog_loop(self):
        """Periodically auto-cancel tasks that time out or stall."""
        while True:
            await asyncio.sleep(60)
            try:
                # Clean up snapshots for tasks no longer PROCESSING
                stale_task_ids = [tid for tid, _ in list(self._progress_snapshots.items()) if tid not in self.tasks_db or self.tasks_db[tid].status != TaskStatus.PROCESSING]
                for tid in stale_task_ids:
                    self._progress_snapshots.pop(tid, None)

                settings = await asyncio.get_running_loop().run_in_executor(_TASK_DB_EXECUTOR, get_settings)
                stall_secs = settings.task_stall_minutes * 60
                now = datetime.now(timezone.utc)

                for task_id, task in list(self.tasks_db.items()):
                    if task.status != TaskStatus.PROCESSING:
                        continue

                    # Stage-elapsed for timeout check, total elapsed for stall detection
                    if task.stageStartedAt:
                        stage_str = task.stageStartedAt
                        if stage_str.endswith("Z"):
                            stage_str = stage_str[:-1] + "+00:00"
                        stage_elapsed = (now - datetime.fromisoformat(stage_str)).total_seconds()
                    else:
                        stage_elapsed = task.elapsedSeconds or 0
                    # Per-type timeout with global fallback
                    type_timeout = {
                        TaskType.SCENE: settings.scene_timeout_minutes,
                        TaskType.SPLIT: settings.split_timeout_minutes,
                        TaskType.SUBTITLE: settings.subtitle_timeout_minutes,
                    }.get(task.type)
                    timeout_secs = (type_timeout or settings.task_timeout_minutes) * 60

                    # Hard timeout check (per-stage)
                    if stage_elapsed >= timeout_secs:
                        await self.cancel_task(task_id, reason=f"stage timed out after {type_timeout or settings.task_timeout_minutes} min")
                        continue

                    # Stall check: key off stage-specific progress (not elapsedSeconds,
                    # which is wall-clock time and always increases even when frozen).
                    stall_key = (
                        task.currentStage,
                        round(
                            {
                                ProcessingStage.SCENE_DETECTION: task.scene_progress,
                                ProcessingStage.VIDEO_SPLITTING: task.split_progress,
                                ProcessingStage.VIDEO_REENCODING: task.split_progress,
                                ProcessingStage.VIDEO_FRAME_PACING_REPAIR: task.split_progress,
                                ProcessingStage.VIDEO_REMUXING: task.split_progress,
                                ProcessingStage.VIDEO_MERGING: task.merge_progress,
                                ProcessingStage.SUBTITLE_GENERATION: task.subtitle_progress,
                            }.get(task.currentStage)
                            or 0.0,
                            1,
                        ),
                    )
                    if task_id in self._progress_snapshots:
                        last_key, snapshot_time = self._progress_snapshots[task_id]
                        if stall_key != last_key:
                            self._progress_snapshots[task_id] = (stall_key, now)
                        elif (now - snapshot_time).total_seconds() >= stall_secs:
                            await self.cancel_task(task_id, reason=f"no progress for {settings.task_stall_minutes} min")
                    else:
                        self._progress_snapshots[task_id] = (stall_key, now)
            except Exception as e:
                logging.error("[watchdog] error: %s", e, exc_info=True)

    def _rank_for_task(self, task_id: str, priority_order: list[str]) -> int:
        """Return the queue priority rank for a task (lower = processed first)."""
        task = self.tasks_db.get(task_id)
        if not task:
            return len(priority_order)
        try:
            return priority_order.index(task.type.value)
        except ValueError:
            return len(priority_order)

    async def _enqueue_with_priority(self, task_id: str) -> None:
        """Put task_id into the priority queue with rank derived from current settings."""
        loop = asyncio.get_running_loop()
        settings = await loop.run_in_executor(_TASK_DB_EXECUTOR, get_settings)
        raw = settings.task_type_priority
        priority_order: list[str] = json.loads(raw) if raw else ["all", "merge", "subtitle", "split", "scene", "analyze_frame_pacing", "nvenc_frame_pacing", "remux"]
        rank = self._rank_for_task(task_id, priority_order)
        await self.task_queue.put((rank, time.monotonic(), task_id))

    async def rerank_queue(self, priority_order: list[str]) -> None:
        """Drain the queue and re-enqueue all tasks with updated priority ranks."""
        entries: list[tuple] = []
        while True:
            try:
                entries.append(self.task_queue.get_nowait())
                self.task_queue.task_done()
            except asyncio.QueueEmpty:
                break
        for _, t, task_id in entries:
            rank = self._rank_for_task(task_id, priority_order)
            await self.task_queue.put((rank, t, task_id))
        logging.info(f"[rerank_queue] Re-ranked {len(entries)} queued tasks")

    async def _emit_duplicate_task_notification(self, existing_task: Task) -> None:
        """Notify the user when a new task request matches an already-active task."""
        file_name = existing_task.file.name if existing_task.file else "merge task"
        file_id = existing_task.file.id if existing_task.file else None
        task_type = existing_task.type.value

        if existing_task.status == TaskStatus.PAUSED:
            title = "Paused task already exists"
            message = (
                f"'{file_name}' already has a paused {task_type} task. "
                "Unpause it to resume processing."
            )
        elif existing_task.status == TaskStatus.QUEUED:
            title = "Task already queued"
            message = f"'{file_name}' already has a queued {task_type} task."
        elif existing_task.status == TaskStatus.PROCESSING:
            title = "Task already processing"
            message = f"'{file_name}' is already being processed ({task_type})."
        else:
            title = "Task already exists"
            message = (
                f"'{file_name}' already has an active {task_type} task "
                f"({existing_task.status.value})."
            )

        await self._emit_notification_tracked(
            NotificationType.TASK_ALREADY_EXISTS,
            title,
            message,
            task_id=existing_task.id,
            file_id=file_id,
        )

    async def _emit_empty_file_notification(self, task: Task) -> None:
        """Notify the user when an empty source file is rejected before queueing."""
        file_name = task.file.name if task.file else "unknown file"
        file_id = task.file.id if task.file else None

        await self._emit_notification_tracked(
            NotificationType.TASK_FAILED,
            "Empty file not queued",
            f"'{file_name}' is empty (0 B) and was not added to the task queue.",
            file_id=file_id,
        )

    async def add_task(self, task: Task) -> tuple[bool, Task | None]:
        """Add a task to the queue.

        Returns:
            A tuple of (queued, existing_task). ``queued`` is True when the task
            was newly queued. When False, ``existing_task`` is the active
            duplicate, or None when the request was rejected before persistence.
        """
        logging.info(f"[add_task] Adding task {task.id} to queue (type={task.type})")

        if task.file and task.file.size <= 0:
            logging.info(
                f"[add_task] Skipping task {task.id} for empty file {task.file.name} (size={task.file.size})"
            )
            await self._emit_empty_file_notification(task)
            return False, None

        loop = asyncio.get_running_loop()
        saved_task = await loop.run_in_executor(_TASK_DB_EXECUTOR, create_task, task)

        # create_task returns an existing task when a QUEUED/PROCESSING/PAUSED task
        # already exists for the same file+type.  Using the phantom new ID would
        # produce a task that has no DB record — all update_task calls silently
        # no-op — leaving the real DB task stuck as QUEUED forever.
        if saved_task and saved_task.id != task.id:
            logging.info(
                f"[add_task] Duplicate detected for {task.file.name if task.file else 'merge task'}: existing task {saved_task.id} already active (status={saved_task.status}), skipping re-queue"
            )
            await self._emit_duplicate_task_notification(saved_task)
            return False, saved_task

        self.tasks_db[task.id] = task

        if self.is_globally_paused:
            task.status = TaskStatus.PAUSED
            task.pausedAt = utc_isoformat(datetime.utcnow())
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)
            self._globally_paused_task_ids.add(task.id)
            logging.info(f"[add_task] Globally paused — task {task.id} added as PAUSED")
        else:
            await self._enqueue_with_priority(task.id)
            logging.info(f"[add_task] Task {task.id} queued. Queue size: {self.task_queue.qsize()}")

        file_name = task.file.name if task.file else "merge task"
        file_id = task.file.id if task.file else None
        await self._emit_notification_tracked(
            NotificationType.TASK_QUEUED,
            "Task Queued",
            f"'{file_name}' added to queue with task type: ({task.type.value})",
            task_id=task.id,
            file_id=file_id,
        )
        return True, None

    async def task_processor(self):
        """Background task processor"""
        loop = asyncio.get_running_loop()
        while True:
            task_id: str | None = None
            try:
                logging.info(f"[task_processor] Waiting for next task... Queue size: {self.task_queue.qsize()}")
                _entry = await self.task_queue.get()
                task_id = _entry[2]
                logging.info(f"[task_processor] Dequeued task: {task_id}, Queue size after: {self.task_queue.qsize()}")

                # Load task from DB if not in memory
                if task_id not in self.tasks_db:
                    logging.info(f"[task_processor] Task {task_id} not in memory, loading from DB")
                    db_task = await loop.run_in_executor(_TASK_DB_EXECUTOR, get_task, task_id)
                    if db_task:
                        self.tasks_db[task_id] = db_task
                        logging.info(f"[task_processor] Loaded task {task_id} from DB, status={db_task.status}")
                    else:
                        logging.warning(f"[task_processor] Task {task_id} not found in DB, skipping")
                        self.task_queue.task_done()
                        continue
                else:
                    logging.info(f"[task_processor] Task {task_id} in memory, status={self.tasks_db[task_id].status}")

                task = self.tasks_db[task_id]
                if task.status != TaskStatus.QUEUED:
                    logging.info(f"[task_processor] Task {task_id} has status={task.status}, skipping")
                    self.task_queue.task_done()
                    if task.status != TaskStatus.PAUSED:
                        self.tasks_db.pop(task_id, None)
                    continue

                if self.is_globally_paused:
                    logging.info(f"[task_processor] Globally paused, re-enqueuing task {task_id}")
                    await self._enqueue_with_priority(task_id)
                    self.task_queue.task_done()
                    await asyncio.sleep(1)
                    continue

                settings = await loop.run_in_executor(_TASK_DB_EXECUTOR, get_settings)
                logging.info(f"[task_processor] Task {task_id} is QUEUED. processing_hours_enabled={settings.processing_hours_enabled}")

                if settings.processing_hours_enabled:
                    day_flags = [
                        settings.processing_mon,
                        settings.processing_tue,
                        settings.processing_wed,
                        settings.processing_thu,
                        settings.processing_fri,
                        settings.processing_sat,
                        settings.processing_sun,
                    ]
                    now = datetime.now(_local_timezone())
                    today = now.weekday()
                    current_hour = now.hour
                    start, end = _processing_window_for_day(settings, today)

                    if not any(day_flags):
                        await self._enqueue_with_priority(task_id)
                        self.task_queue.task_done()
                        logging.warning("No processing days enabled. Sleeping until settings change.")
                        while True:
                            await asyncio.sleep(5)
                            current_settings = await loop.run_in_executor(_TASK_DB_EXECUTOR, get_settings)
                            if not current_settings.processing_hours_enabled:
                                break
                            current_day_flags = [
                                current_settings.processing_mon,
                                current_settings.processing_tue,
                                current_settings.processing_wed,
                                current_settings.processing_thu,
                                current_settings.processing_fri,
                                current_settings.processing_sat,
                                current_settings.processing_sun,
                            ]
                            if any(current_day_flags):
                                break
                        continue

                    today_allowed = day_flags[today]
                    in_window = _processing_allowed_now(settings, now)

                    if not in_window:
                        await self._enqueue_with_priority(task_id)
                        self.task_queue.task_done()

                        if today_allowed and current_hour < start:
                            logging.info(f"Outside hour window ({start}–{end}). Waiting for window or settings change.")
                        else:
                            next_day = next(i for i in range(1, 8) if day_flags[(today + i) % 7])
                            next_start, _ = _processing_window_for_day(settings, (today + next_day) % 7)
                            logging.info(f"Outside processing window. Waiting until day {(today + next_day) % 7} at {next_start}h or settings change.")

                        while True:
                            await asyncio.sleep(5)
                            current_settings = await loop.run_in_executor(_TASK_DB_EXECUTOR, get_settings)
                            if not current_settings.processing_hours_enabled:
                                break
                            recheck_now = datetime.now(_local_timezone())
                            if _processing_allowed_now(current_settings, recheck_now):
                                break
                        continue

                logging.info(f"[task_processor] Starting process_video for task {task_id}")
                self.is_processing = True
                processing_task = asyncio.ensure_future(self.process_video(task_id))
                self._processing_tasks[task_id] = processing_task
                try:
                    await processing_task
                except asyncio.CancelledError:
                    logging.info(f"[task_processor] process_video task cancelled for {task_id}")
                finally:
                    self._processing_tasks.pop(task_id, None)
                    self.task_queue.task_done()
                    self._refresh_processing_state()
                logging.info(f"[task_processor] Completed process_video for task {task_id}")

                # Small delay to allow other tasks to run
                await asyncio.sleep(0.1)

            except asyncio.CancelledError:
                logging.info("[task_processor] Processor shutdown requested")
                self._refresh_processing_state()
                raise
            except Exception as e:
                logging.error(f"Task processor error: {e}", exc_info=True)
                self._refresh_processing_state()
                # Re-enqueue the task if it was dequeued but lost due to the exception.
                # Without this, the task disappears from the queue and the processor
                # blocks at task_queue.get() indefinitely.
                if task_id and task_id in self.tasks_db:
                    logging.warning(f"[task_processor] Re-enqueuing task {task_id} after error to prevent queue loss")
                    try:
                        await self._enqueue_with_priority(task_id)
                        self.task_queue.task_done()
                    except Exception as re_enqueue_err:
                        logging.error(f"[task_processor] Failed to re-enqueue task {task_id}: {re_enqueue_err}")
                await asyncio.sleep(1)

    async def process_video(self, task_id: str):
        """Process a single video"""
        from scenedetect import FrameTimecode

        from .processor import SplitVideoFfmpegError, detect_scenes, generate_subtitles, merge_subtitles, merge_videos, normalize_nvenc_frame_pacing, reencode_video, remux_video, save_subtitles, split_video

        loop = asyncio.get_running_loop()
        created_files: list[Path] = []
        task = self.tasks_db[task_id]
        downstream_lock_acquired = False
        scene_detection_slot_acquired = False

        # Check if task was paused during processing
        if task_id in self._paused_tasks:
            self._paused_tasks.discard(task_id)
            logging.info(f"[Task {task_id}] Task was paused, stopping processing")
            return

        # Check if file still exists before processing (skip for merge tasks).
        # Offloaded to executor — Path.exists() blocks on hung network mounts.
        file_missing = task.file and not await loop.run_in_executor(None, Path(task.file.path).exists)
        if file_missing:
            logging.info(f"[Task {task_id}] Source file not found: {task.file.path}")
            task.status = TaskStatus.FAILED
            task.error = "Source file not found"
            finished_at = datetime.utcnow()
            task.completedAt = utc_isoformat(finished_at)
            task.elapsedSeconds = _elapsed_seconds_since_start(task, finished_at)
            await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)
            deleted = await loop.run_in_executor(_TASK_DB_EXECUTOR, delete_task, task_id)
            if deleted:
                logging.info(f"[Task {task_id}] Deleted terminal task after source-file-not-found cleanup")
            else:
                logging.warning(f"[Task {task_id}] Terminal task was not found for source-file-not-found cleanup")
            self.tasks_db.pop(task_id, None)
            return

        if task.type == TaskType.SPLIT and task.file and task.file.size == 0:
            task.status = TaskStatus.CANCELLED
            task.currentStage = ProcessingStage.COMPLETED
            task.error = "File size is 0 bytes"
            finished_at = datetime.utcnow()
            task.completedAt = utc_isoformat(finished_at)
            task.elapsedSeconds = _elapsed_seconds_since_start(task, finished_at)
            await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)
            await self._emit_notification_tracked(
                NotificationType.TASK_CANCELLED,
                "Task Cancelled",
                f"'{task.file.name}' was cancelled: {task.error}",
                task_id=task.id,
                file_id=task.file.id,
            )
            self.tasks_db.pop(task_id, None)
            return

        try:
            # Load settings from DB for this task
            settings = await loop.run_in_executor(_TASK_DB_EXECUTOR, get_settings)

            if task.type != TaskType.SCENE:
                await self._downstream_processing_lock.acquire()
                downstream_lock_acquired = True

            if task.type in (TaskType.SCENE, TaskType.SPLIT, TaskType.ALL):
                await self._acquire_scene_detection_slot(
                    getattr(settings, "scene_detection_concurrency", 1)
                )
                scene_detection_slot_acquired = True

            cancel_event = threading.Event()
            self._cancel_events[task_id] = cancel_event

            task.status = TaskStatus.PROCESSING
            task.startedAt = utc_isoformat(datetime.utcnow())
            scenes: list = []

            file_name = task.file.name if task.file else "merge task"
            file_id = task.file.id if task.file else None
            await self._emit_notification_tracked(
                NotificationType.TASK_STARTED,
                "Task Started",
                f"Processing '{file_name}'",
                task_id=task.id,
                file_id=file_id,
            )

            if task.type in (TaskType.ANALYZE_FRAME_PACING, TaskType.NVENC_FRAME_PACING):
                needs_frame_pacing_repair = task.type == TaskType.NVENC_FRAME_PACING
                if task.type == TaskType.ANALYZE_FRAME_PACING:
                    from .api.tools import FramePacingAnalysis, _stream_frame_pacing_analysis

                    task.currentStage = ProcessingStage.VIDEO_FRAME_PACING_ANALYSIS
                    task.stageStartedAt = utc_isoformat(datetime.utcnow())
                    await self.update_task_progress(task_id, 0.0, ProcessingStage.VIDEO_FRAME_PACING_ANALYSIS)

                    def _analyze_with_progress() -> FramePacingAnalysis:
                        import json as json_module

                        latest_analysis: FramePacingAnalysis | None = None
                        for raw_event in _stream_frame_pacing_analysis(task.file.id):
                            event = json_module.loads(raw_event.decode("utf-8"))
                            if event.get("event") == "progress":
                                progress = float(event.get("progress") or 0)
                                asyncio.run_coroutine_threadsafe(
                                    self.update_task_progress(task_id, progress, ProcessingStage.VIDEO_FRAME_PACING_ANALYSIS),
                                    loop,
                                ).result()
                            elif event.get("event") == "result":
                                latest_analysis = FramePacingAnalysis(**{key: value for key, value in event.items() if key != "event"})
                        if latest_analysis is None:
                            raise ValueError("Frame pacing analysis finished without a result")
                        return latest_analysis

                    analysis = await loop.run_in_executor(None, _analyze_with_progress)
                    await self.update_task_progress(task_id, 100.0, ProcessingStage.VIDEO_FRAME_PACING_ANALYSIS)

                    if analysis.status == "error":
                        raise ValueError(analysis.message or "Frame pacing analysis failed")

                    needs_frame_pacing_repair = analysis.status in ("suspect", "severe")
                    if not needs_frame_pacing_repair:
                        logging.info(
                            "[Task %s] Frame pacing repair skipped after analysis: status=%s score=%s",
                            task_id,
                            analysis.status,
                            analysis.score,
                        )
                        await self._emit_notification_tracked(
                            NotificationType.STAGE_COMPLETED,
                            "Frame Pacing Analysis Complete",
                            f"'{task.file.name}' does not need repair ({analysis.status}, score {analysis.score})",
                            task_id=task.id,
                            file_id=task.file.id if task.file else None,
                        )
                    else:
                        await self._emit_notification_tracked(
                            NotificationType.STAGE_COMPLETED,
                            "Frame Pacing Analysis Complete",
                            f"'{task.file.name}' needs repair ({analysis.status}, score {analysis.score})",
                            task_id=task.id,
                            file_id=task.file.id if task.file else None,
                        )

                if needs_frame_pacing_repair:
                    task.currentStage = ProcessingStage.VIDEO_FRAME_PACING_REPAIR
                    task.stageStartedAt = utc_isoformat(datetime.utcnow())

                    async def _nvenc_progress(pct: float):
                        await self.update_task_progress(task_id, round(pct, 2), ProcessingStage.VIDEO_FRAME_PACING_REPAIR)

                    nvenc_output_path = await normalize_nvenc_frame_pacing(
                        task.file.path,
                        progress_callback=_nvenc_progress,
                        cancel_event=cancel_event,
                        created_files=created_files,
                        overwrite_original=bool(task.nvenc_overwrite_original),
                    )
                    await self.update_task_progress(task_id, 100.0, ProcessingStage.VIDEO_FRAME_PACING_REPAIR)
                    await loop.run_in_executor(
                        None,
                        self._track_nvenc_output_file,
                        task,
                        nvenc_output_path,
                        bool(task.nvenc_overwrite_original),
                    )

            elif task.type == TaskType.REMUX:
                task.currentStage = ProcessingStage.VIDEO_REMUXING
                task.stageStartedAt = utc_isoformat(datetime.utcnow())

                async def _remux_progress(pct: float):
                    await self.update_task_progress(task_id, round(pct, 2), ProcessingStage.VIDEO_REMUXING)

                remux_output_path = await remux_video(
                    task.file.path,
                    progress_callback=_remux_progress,
                    cancel_event=cancel_event,
                )
                await self.update_task_progress(task_id, 100.0, ProcessingStage.VIDEO_REMUXING)
                await loop.run_in_executor(None, self._track_remux_output_file, task, remux_output_path)

            elif task.type == TaskType.MERGE:
                merge_input_paths = sorted(json.loads(task.merge_input_paths or "[]"))
                if not merge_input_paths:
                    raise ValueError("No input paths for merge task")

                first_path = Path(merge_input_paths[0])
                output_name = first_path.name
                output_path = str(first_path.parent / output_name)

                task.currentStage = ProcessingStage.VIDEO_MERGING
                task.stageStartedAt = utc_isoformat(datetime.utcnow())
                await self.update_task_progress(task_id, 0.0, ProcessingStage.VIDEO_MERGING)

                async def _merge_progress(pct: float):
                    await self.update_task_progress(task_id, round(pct, 2), ProcessingStage.VIDEO_MERGING)

                try:
                    await merge_videos(
                        input_paths=merge_input_paths,
                        output_path=output_path,
                        progress_callback=_merge_progress,
                        cancel_event=cancel_event,
                        created_files=created_files,
                    )
                except asyncio.CancelledError:
                    logging.info(f"[Task {task_id}] Video merge cancelled")
                    raise

                await self.update_task_progress(task_id, 100.0, ProcessingStage.VIDEO_MERGING)

                def _track_merge_output():
                    from .utils import get_video_metadata

                    db = get_db()
                    try:
                        file_crud = FileCRUD(db)
                        output_file = Path(output_path)

                        # Collect subtitle info before deleting any records
                        subtitle_inputs: list[tuple[str, float]] = []
                        all_have_subtitles = True
                        for input_path in merge_input_paths:
                            input_record = file_crud.get_file_metadata(path=input_path)
                            srt_child = None
                            if input_record:
                                for child in file_crud.get_children_of_file(input_record.id):
                                    if child.file_type == "subtitle":
                                        srt_child = child
                                        break
                            if srt_child and Path(srt_child.path).exists():
                                duration = float(input_record.duration or 0)
                                subtitle_inputs.append((srt_child.path, duration))
                            else:
                                all_have_subtitles = False

                        # Merge subtitle files if every input has one
                        merged_srt_path: str | None = None
                        if all_have_subtitles and subtitle_inputs:
                            merged_srt_path = str(Path(output_path).with_suffix(".srt"))
                            try:
                                merge_subtitles(subtitle_inputs, merged_srt_path, created_files)
                                logging.info(f"[Task {task_id}] Merged {len(subtitle_inputs)} subtitle files → {merged_srt_path}")
                            except Exception as e:
                                logging.warning(f"[Task {task_id}] Subtitle merge failed, skipping: {e}")
                                merged_srt_path = None

                        # Delete all input file records from DB; delete from disk only if not the output path
                        for input_path in merge_input_paths:
                            try:
                                input_record = file_crud.get_file_metadata(path=input_path)
                                if input_record:
                                    children = file_crud.get_children_of_file(input_record.id)
                                    for child in children:
                                        if child.file_type == "subtitle":
                                            try:
                                                Path(child.path).unlink(missing_ok=True)
                                                file_crud.delete_by_id(child.id)
                                                logging.info(f"[Task {task_id}] Deleted subtitle file: {child.path}")
                                            except Exception as e:
                                                logging.warning(f"[Task {task_id}] Error deleting subtitle {child.path}: {e}")
                                if input_path != output_path:
                                    Path(input_path).unlink(missing_ok=True)
                                file_crud.delete_by_path(input_path)
                                logging.info(f"[Task {task_id}] Deleted input file record: {input_path}")
                            except Exception as e:
                                logging.warning(f"[Task {task_id}] Error deleting input file {input_path}: {e}")

                        # Create fresh record for the merged output
                        metadata = get_video_metadata(output_path)
                        file_metadata = file_crud.create_file_metadata(
                            name=output_file.name,
                            path=output_path,
                            size=output_file.stat().st_size,
                            file_type="video",
                            format=".mp4",
                            directory_id=self._get_directory_id_for_path(str(output_file.parent)),
                            duration=metadata.get("duration"),
                            width=metadata.get("width"),
                            height=metadata.get("height"),
                            fps=metadata.get("fps"),
                            codec=metadata.get("codec"),
                            bitrate=metadata.get("bitrate"),
                        )
                        logging.info(
                            f"[Task {task_id}] Created merged file record: {output_path} (duration={metadata.get('duration')}, resolution={metadata.get('width')}x{metadata.get('height')}, codec={metadata.get('codec')})"
                        )

                        # Register merged subtitle and link it to the output video
                        if merged_srt_path:
                            srt_file = Path(merged_srt_path)
                            srt_record = file_crud.create_file_metadata(
                                name=srt_file.name,
                                path=merged_srt_path,
                                size=srt_file.stat().st_size,
                                file_type="subtitle",
                                format=".srt",
                                directory_id=self._get_directory_id_for_path(str(srt_file.parent)),
                                status="done",
                            )
                            file_crud.set_parent_for_file(srt_record.id, file_metadata.id)
                            logging.info(f"[Task {task_id}] Registered merged subtitle: {merged_srt_path}")

                        return {
                            "id": file_metadata.id,
                            "name": file_metadata.name,
                            "path": file_metadata.path,
                            "size": file_metadata.size,
                            "duration": file_metadata.duration,
                            "format": file_metadata.format,
                            "width": file_metadata.width,
                            "height": file_metadata.height,
                            "fps": file_metadata.fps,
                            "codec": file_metadata.codec,
                            "bitrate": file_metadata.bitrate,
                            # True only if inputs had subtitles but merge didn't produce one;
                            # triggers _maybe_queue_subtitle_task to regenerate.
                            "had_subtitles": bool(subtitle_inputs) and merged_srt_path is None,
                        }
                    finally:
                        close_db(db)

                merged_file_data = await loop.run_in_executor(None, _track_merge_output)
                had_subtitles = merged_file_data.get("had_subtitles", False) if merged_file_data else False

                if merged_file_data:
                    task.file = File(
                        id=merged_file_data["id"],
                        name=merged_file_data["name"],
                        path=merged_file_data["path"],
                        size=merged_file_data["size"],
                        duration=merged_file_data["duration"],
                        format=merged_file_data["format"],
                        width=merged_file_data["width"],
                        height=merged_file_data["height"],
                        fps=merged_file_data["fps"],
                        codec=merged_file_data["codec"],
                        bitrate=merged_file_data["bitrate"],
                    )
                    logging.info(f"[Task {task_id}] Assigned merged file: {task.file.name}")
                else:
                    logging.error(f"[Task {task_id}] Failed to get merged file data")
                    raise ValueError("Merged file data is missing")

                await self._emit_notification_tracked(
                    NotificationType.STAGE_COMPLETED,
                    "Video Merge Complete",
                    f"Merged {len(merge_input_paths)} videos",
                    task_id=task.id,
                    file_id=task.file.id if task.file else None,
                )

                # Merge tasks complete immediately after merging
                logging.info(f"[Task {task_id}] Merge complete, marking task as finished")

            elif task.type in (TaskType.SCENE, TaskType.SPLIT, TaskType.ALL):
                # Merge tasks skip scene/split/subtitle processing
                if not task.file:
                    raise ValueError("Task file is required for scene detection")

                def _get_existing_scenes():
                    db = get_db()
                    try:
                        scene_crud = SceneCRUD(db)
                        return scene_crud.get_scenes_for_file(task.file.id)
                    finally:
                        close_db(db)

                existing_scenes = await loop.run_in_executor(None, _get_existing_scenes)

                task.__setattr__("currentStage", ProcessingStage.SCENE_DETECTION)
                task.stageStartedAt = utc_isoformat(datetime.utcnow())

                await self.update_task_progress(task_id, 0.0, ProcessingStage.SCENE_DETECTION)

                if existing_scenes and task.overwrite_scenes is not True:
                    scenes = [
                        (
                            FrameTimecode(timecode=s.start_timecode, fps=_scene_fps_from_file(task.file)),
                            FrameTimecode(timecode=s.end_timecode, fps=_scene_fps_from_file(task.file)),
                        )
                        for s in existing_scenes
                    ]
                    logging.info(f"[Task {task_id}] Using {len(scenes)} cached scenes from DB")
                else:
                    logging.info(f"[Task {task_id}] Starting scene detection for: {task.file.path}")

                    async def _scene_progress(pct: float):
                        await self.update_task_progress(task_id, round(pct, 2), ProcessingStage.SCENE_DETECTION)

                    effective_detector = task.scene_detector or settings.scene_detector
                    tried: list[str] = []
                    last_error: Exception | None = None

                    try:
                        scenes = await detect_scenes(
                            task.file.path,
                            detector=effective_detector,
                            content_threshold=settings.scene_content_threshold,
                            adaptive_threshold=settings.scene_adaptive_threshold,
                            black_threshold=settings.scene_black_threshold,
                            white_threshold=settings.scene_white_threshold,
                            min_scene_len=settings.min_scene_length_frames,
                            progress_callback=_scene_progress,
                            cancel_event=cancel_event,
                        )
                        tried.append(effective_detector)
                    except asyncio.CancelledError:
                        logging.info(f"[Task {task_id}] Scene detection cancelled")
                        raise
                    except Exception as e:
                        logging.warning(f"[Task {task_id}] Detector '{effective_detector}' failed: {e}")
                        last_error = e
                        tried.append(effective_detector)

                    # Fallback: on exception (any task type) or ≤1 scenes (SPLIT/ALL only)
                    needs_fallback = last_error is not None or (task.type in (TaskType.SPLIT, TaskType.ALL) and len(scenes) <= 1)
                    if needs_fallback:
                        for fallback in DETECTOR_FALLBACK_ORDER:
                            if fallback in tried:
                                continue
                            logging.info(f"[Task {task_id}] Retrying with detector '{fallback}' (got {len(scenes)} scenes)")
                            try:
                                scenes = await detect_scenes(
                                    task.file.path,
                                    detector=fallback,
                                    content_threshold=settings.scene_content_threshold,
                                    adaptive_threshold=settings.scene_adaptive_threshold,
                                    black_threshold=settings.scene_black_threshold,
                                    white_threshold=settings.scene_white_threshold,
                                    min_scene_len=settings.min_scene_length_frames,
                                    progress_callback=_scene_progress,
                                    cancel_event=cancel_event,
                                )
                                tried.append(fallback)
                            except asyncio.CancelledError:
                                logging.info(f"[Task {task_id}] Scene detection cancelled")
                                raise
                            except Exception as e:
                                logging.warning(f"[Task {task_id}] Detector '{fallback}' failed: {e}")
                                last_error = e
                                tried.append(fallback)
                                continue
                            # SCENE tasks accept ≥1 scene; SPLIT/ALL need >1
                            sufficient = len(scenes) >= 1 if task.type == TaskType.SCENE else len(scenes) > 1
                            if sufficient:
                                logging.info(f"[Task {task_id}] Detector '{fallback}' found {len(scenes)} scenes")
                                task.scene_detector = fallback
                                last_error = None
                                file_name = task.file.name if task.file else "video"
                                file_id = task.file.id if task.file else None
                                await self._emit_notification_tracked(
                                    NotificationType.STAGE_COMPLETED,
                                    "Detector Switched",
                                    f"Switched to '{fallback}' detector, found {len(scenes)} scenes",
                                    task_id=task.id,
                                    file_id=file_id,
                                )
                                break

                    if last_error is not None and not scenes:
                        raise last_error

                    if not scenes:
                        raise ValueError(_NO_SCENES_ERROR)

                    # Persist scenes to DB
                    def _save_scenes_to_db():
                        db = get_db()
                        try:
                            scene_crud = SceneCRUD(db)
                            if task.overwrite_scenes:
                                scene_crud.delete_scenes_for_file(task.file.id)
                            scene_crud.bulk_create_scenes(
                                [
                                    {
                                        "file_id": task.file.id,
                                        "normalized_video_code": extract_normalized_video_code(task.file.name),
                                        "scene_number": i + 1,
                                        "start_frame": start_tc.get_frames(),
                                        "end_frame": end_tc.get_frames(),
                                        "start_timecode": _format_timecode_to_3_decimals(str(start_tc)),
                                        "end_timecode": _format_timecode_to_3_decimals(str(end_tc)),
                                        "start_seconds": start_tc.get_seconds(),
                                        "end_seconds": end_tc.get_seconds(),
                                        "duration_seconds": end_tc.get_seconds() - start_tc.get_seconds(),
                                    }
                                    for i, (start_tc, end_tc) in enumerate(scenes)
                                ]
                            )
                            logging.info(f"[Task {task_id}] Saved {len(scenes)} scenes to DB")
                        finally:
                            close_db(db)

                    await loop.run_in_executor(None, _save_scenes_to_db)

                logging.info(f"[Task {task_id}] Detected {len(scenes)} scenes")

                await self.update_task_progress(task_id, 100.0, ProcessingStage.SCENE_DETECTION)
                task.scene_count = len(scenes)
                task.scene_elapsed_seconds = _stage_elapsed_seconds(task, datetime.utcnow())
                await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)

                await self._emit_notification_tracked(
                    NotificationType.STAGE_COMPLETED,
                    "Scene Detection Complete",
                    f"{len(scenes)} scenes detected",
                    task_id=task.id,
                    file_id=task.file.id,
                )

                await self._release_scene_detection_slot()
                scene_detection_slot_acquired = False

            if task.type in (TaskType.SPLIT, TaskType.ALL) and len(scenes) <= 1:
                raise ValueError(f"Scene detection found only {len(scenes)} scene(s); at least 2 required to split")

            if task.type in (TaskType.SPLIT, TaskType.ALL):
                split_min_duration = getattr(settings, "split_min_video_duration_seconds", 0) or 0
                video_duration = _parse_duration_seconds(task.file.duration if task.file else None)
                if split_min_duration > 0 and video_duration is not None and video_duration < split_min_duration:
                    raise ValueError(
                        f"Video duration {video_duration:.0f}s is below the split threshold of {split_min_duration}s"
                    )

                logging.info(f"[Task {task_id}] Starting video splitting for: {task.file.path}")

                task.currentStage = ProcessingStage.VIDEO_SPLITTING
                task.stageStartedAt = utc_isoformat(datetime.utcnow())

                async def _split_progress_direct(pct: float):
                    await self.update_task_progress(task_id, round(pct, 2), ProcessingStage.VIDEO_SPLITTING)

                async def _reencode_progress(pct: float):
                    scaled = round(pct * 0.5, 2)
                    await self.update_task_progress(task_id, scaled, ProcessingStage.VIDEO_SPLITTING)

                async def _split_progress_after_reencode(pct: float):
                    scaled = round(50 + pct * 0.5, 2)
                    await self.update_task_progress(task_id, scaled, ProcessingStage.VIDEO_SPLITTING)

                split_failed_error = None

                try:
                    await split_video(
                        task.file.path,
                        scenes,
                        max_concurrent=settings.split_concurrency,
                        progress_callback=_split_progress_direct,
                        cancel_event=cancel_event,
                        created_files=created_files,
                        overwrite_existing=bool(task.overwrite_split),
                    )
                except asyncio.CancelledError:
                    logging.info(f"[Task {task_id}] Video splitting cancelled")
                    raise
                except SplitVideoFfmpegError as e:
                    split_failed_error = e
                    logging.warning(f"[Task {task_id}] split_video failed, attempting video reencoding fallback: {e}")
                    await self._cleanup_partial_split_outputs(task_id, task.file.path, len(scenes), created_files)

                    await self._emit_notification_tracked(
                        NotificationType.STAGE_COMPLETED,
                        "Attempting Fallback",
                        "Initial split failed. Re-encoding video...",
                        task_id=task.id,
                        file_id=task.file.id,
                    )

                    try:
                        try:
                            logging.info(f"[Task {task_id}] Starting video re-encoding for fallback")
                            task.currentStage = ProcessingStage.VIDEO_REENCODING
                            task.stageStartedAt = utc_isoformat(datetime.utcnow())
                            await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)
                            encoder_used = await reencode_video(
                                task.file.path,
                                progress_callback=_reencode_progress,
                                cancel_event=cancel_event,
                                require_gpu=bool(settings.split_gpu_required),
                            )
                            logging.info(f"[Task {task_id}] Video re-encoding completed successfully using {encoder_used}")

                        except Exception as reencode_error:
                            logging.error(f"[Task {task_id}] reencode_video failed: {reencode_error}")
                            raise

                        logging.info(f"[Task {task_id}] Retrying video split with re-encoded file")

                        await self._emit_notification_tracked(
                            NotificationType.STAGE_COMPLETED,
                            "Re-encoding Complete",
                            (
                                "Video re-encoded using h264_nvenc. Retrying video split..."
                                if encoder_used == "h264_nvenc"
                                else "Video re-encoded using libx264 (CPU fallback). Retrying video split..."
                            ),
                            task_id=task.id,
                            file_id=task.file.id,
                        )

                        # Reset stage timer so retry split gets its own full timeout window
                        task.currentStage = ProcessingStage.VIDEO_SPLITTING
                        task.stageStartedAt = utc_isoformat(datetime.utcnow())
                        await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)

                        await split_video(
                            str(task.file.path),
                            scenes,
                            max_concurrent=settings.split_concurrency,
                            progress_callback=_split_progress_after_reencode,
                            cancel_event=cancel_event,
                            created_files=created_files,
                            overwrite_existing=bool(task.overwrite_split),
                        )

                        logging.info(f"[Task {task_id}] Video splitting succeeded with re-encoded file")

                    except asyncio.CancelledError:
                        logging.info(f"[Task {task_id}] Video splitting with video reencoding cancelled")
                        raise
                    except Exception as retry_error:
                        raise Exception(f"Video splitting failed even after video reencoding: {retry_error}") from split_failed_error

                await self.update_task_progress(task_id, 100.0, ProcessingStage.VIDEO_SPLITTING)
                task.split_count = len(scenes)
                task.split_elapsed_seconds = _stage_elapsed_seconds(task, datetime.utcnow())
                await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)

                await self._emit_notification_tracked(
                    NotificationType.STAGE_COMPLETED,
                    "Video Splitting Complete",
                    f"{len(scenes)} segments created",
                    task_id=task.id,
                    file_id=task.file.id,
                )

            file_path = Path(task.file.path)
            all_task_has_split_outputs = task.type == TaskType.ALL and bool(scenes)
            should_generate_subtitle = (task.type == TaskType.SUBTITLE or task.type == TaskType.ALL) and "-SUB" not in file_path.stem and (task.type == TaskType.SUBTITLE or all_task_has_split_outputs)
            if should_generate_subtitle:
                task.currentStage = ProcessingStage.SUBTITLE_GENERATION
                task.stageStartedAt = utc_isoformat(datetime.utcnow())

                # For standalone SUBTITLE tasks, scenes was never populated — load from DB
                if task.type == TaskType.SUBTITLE and not scenes:

                    def _load_scenes_for_subtitle():
                        db = get_db()
                        try:
                            scene_crud = SceneCRUD(db)
                            return scene_crud.get_scenes_for_file(task.file.id)
                        finally:
                            close_db(db)

                    db_scenes = await loop.run_in_executor(None, _load_scenes_for_subtitle)
                    if db_scenes:
                        from scenedetect import FrameTimecode

                        scenes = [
                            (
                                FrameTimecode(timecode=s.start_timecode, fps=_scene_fps_from_file(task.file)),
                                FrameTimecode(timecode=s.end_timecode, fps=_scene_fps_from_file(task.file)),
                            )
                            for s in db_scenes
                        ]
                        logging.info(f"[Task {task_id}] Loaded {len(scenes)} scenes from DB for subtitle task")
                    else:
                        logging.info(f"[Task {task_id}] No scenes in DB; will generate subtitle for original file")

                logging.info(f"[Task {task_id}] Starting subtitle generation")

                try:
                    if scenes:
                        subtitle_sem = asyncio.Semaphore(settings.subtitle_concurrency)
                        seg_progress = [0.0] * len(scenes)
                        last_reported = [0.0]  # throttle concurrent progress writes

                        async def _subtitle_one(i: int):
                            async with subtitle_sem:
                                if cancel_event.is_set():
                                    raise asyncio.CancelledError()

                                suffix = f"{i + 1:03}"
                                filename = f"{Path(task.file.path).stem}-{suffix}.mp4"
                                target_path = Path(task.file.path).parent / filename

                                async def _seg_progress(pct: float):
                                    seg_progress[i] = pct
                                    overall = round(sum(seg_progress) / len(scenes), 2)
                                    if overall > last_reported[0]:
                                        last_reported[0] = overall
                                        await self.update_task_progress(task_id, overall, ProcessingStage.SUBTITLE_GENERATION)

                                subtitles = await generate_subtitles(
                                    target_path,
                                    task.subtitleLanguage,
                                    progress_callback=_seg_progress,
                                    cancel_event=cancel_event,
                                    require_gpu=bool(settings.subtitle_gpu_required),
                                )
                                logging.info(f"[Task {task_id}] Saving subtitle for segment {i + 1}")
                                await loop.run_in_executor(None, save_subtitles, str(target_path), subtitles, created_files)

                        await asyncio.gather(
                            *[_subtitle_one(i) for i in range(len(scenes))],
                            return_exceptions=False,
                        )
                    elif task.type == TaskType.SUBTITLE:
                        # No split segments exist — subtitle the original file directly
                        async def _subtitle_progress(pct: float):
                            await self.update_task_progress(task_id, round(pct, 2), ProcessingStage.SUBTITLE_GENERATION)

                        subtitles = await generate_subtitles(
                            task.file.path,
                            task.subtitleLanguage,
                            progress_callback=_subtitle_progress,
                            cancel_event=cancel_event,
                            require_gpu=bool(settings.subtitle_gpu_required),
                        )
                        logging.info(f"[Task {task_id}] Saving subtitle for original file")
                        await loop.run_in_executor(None, save_subtitles, task.file.path, subtitles, created_files)
                except asyncio.CancelledError:
                    logging.info(f"[Task {task_id}] Subtitle generation cancelled")
                    raise

                await self.update_task_progress(task_id, 100.0, ProcessingStage.SUBTITLE_GENERATION)
                task.subtitle_elapsed_seconds = _stage_elapsed_seconds(task, datetime.utcnow())

                await self._emit_notification_tracked(
                    NotificationType.STAGE_COMPLETED,
                    "Subtitle Generation Complete",
                    f"Subtitles generated for '{task.file.name}'",
                    task_id=task.id,
                    file_id=task.file.id,
                )
            else:
                # Record reason for skipping subtitle generation
                skip_reason = None
                if task.type == TaskType.ALL and not all_task_has_split_outputs:
                    skip_reason = "ALL task has no split outputs available for subtitle generation"
                elif "-SUB" in file_path.stem:
                    skip_reason = "File is a merged output (contains '-SUB' in stem)"
                elif task.type not in (TaskType.SUBTITLE, TaskType.ALL):
                    skip_reason = f"Task type '{task.type.value}' does not trigger subtitle generation"

                if skip_reason:
                    logging.info(f"[Task {task_id}] Skipping subtitle generation for '{task.file.name}': {skip_reason}")

            # Track newly created files after task completion
            if task.type == TaskType.SPLIT or task.type == TaskType.ALL:
                await loop.run_in_executor(None, self._track_new_split_files, task, scenes)

            if task.type == TaskType.SUBTITLE or task.type == TaskType.ALL:
                await loop.run_in_executor(None, self._track_new_subtitle_files, task)

            task.status = TaskStatus.COMPLETED
            task.currentStage = ProcessingStage.COMPLETED
            finished_at = datetime.utcnow()
            task.completedAt = utc_isoformat(finished_at)
            task.elapsedSeconds = _elapsed_seconds_since_start(task, finished_at)

            file_name = task.file.name if task.file else "merge task"
            file_id = task.file.id if task.file else None
            await self._emit_notification_tracked(
                NotificationType.TASK_COMPLETED,
                "Task Completed",
                f"'{file_name}' finished in {task.elapsedSeconds}s",
                task_id=task.id,
                file_id=file_id,
            )

            # Improved error handling for final state update
            task_update_ok = False
            try:
                await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)
                task_update_ok = True
                if task.type == TaskType.MERGE and task.file:
                    await self._maybe_queue_subtitle_task(task.file, had_subtitles=had_subtitles)
            except Exception as update_error:
                logging.error(f"[Task {task_id}] Failed to update completed task in DB: {update_error}")
                self._refresh_processing_state()

            self._cancel_events.pop(task_id, None)
            self._progress_snapshots.pop(task_id, None)
            self.tasks_db.pop(task_id, None)
            logging.info(f"[Task {task_id}] Completed successfully")

            if task_update_ok and task.delete_video_after_completion and task.file:
                try:
                    file_id = task.file.id
                    file_path = task.file.path

                    def _delete_source_file():
                        source_path = Path(file_path)
                        source_path.unlink(missing_ok=True)
                        db = get_db()
                        try:
                            file_record = db.query(FileRecord).filter(FileRecord.id == file_id).first()
                            if file_record:
                                record_deleted_file(db, file_record, reason="delete_video_after_completion", source="task_manager")
                                file_record.is_deleted = True
                                db.commit()
                        finally:
                            close_db(db)
                        logging.info(f"[Task {task_id}] Deleted source video: {file_path}")

                    await loop.run_in_executor(None, _delete_source_file)
                except Exception as e:
                    logging.error(f"[Task {task_id}] Failed to delete source video: {e}", exc_info=True)

        except asyncio.CancelledError:
            logging.info(f"[Task {task_id}] Task cancelled")
            if task.status == TaskStatus.PAUSED:
                # Task was paused mid-processing — keep PAUSED status, leave in tasks_db
                logging.info(f"[Task {task_id}] Task was paused, preserving PAUSED state")
                try:
                    await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)
                except Exception as update_error:
                    logging.error(f"[Task {task_id}] Failed to persist paused task in DB: {update_error}")
                self._cancel_events.pop(task_id, None)
                self._progress_snapshots.pop(task_id, None)
                self._refresh_processing_state()
                return
            elif task.status != TaskStatus.CANCELLED:
                cancelled_stage = task.currentStage
                task.status = TaskStatus.CANCELLED
                task.currentStage = ProcessingStage.COMPLETED
                stage_label = _STAGE_LABELS.get(cancelled_stage)
                task.error = f"Cancelled during {stage_label}" if stage_label else None
                finished_at = datetime.utcnow()

                file_name = task.file.name if task.file else "merge task"
                file_id = task.file.id if task.file else None
                await self._emit_notification_tracked(
                    NotificationType.TASK_CANCELLED,
                    "Task Cancelled",
                    f"'{file_name}' was cancelled",
                    task_id=task.id,
                    file_id=file_id,
                )
                task.completedAt = utc_isoformat(finished_at)
                task.elapsedSeconds = _elapsed_seconds_since_start(task, finished_at)
                try:
                    await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)
                except Exception as update_error:
                    logging.error(f"[Task {task_id}] Failed to update cancelled task in DB: {update_error}")

            await self._cleanup_created_files(task_id, created_files)
            if _should_delete_failed_task(task.error):
                deleted = await loop.run_in_executor(_TASK_DB_EXECUTOR, delete_task, task_id)
                if deleted:
                    logging.info(f"[Task {task_id}] Deleted terminal task after ignored-error cleanup: {task.error}")
                else:
                    logging.warning(f"[Task {task_id}] Terminal task was not found for ignored-error cleanup: {task.error}")
            self._cancel_events.pop(task_id, None)
            self._progress_snapshots.pop(task_id, None)
            self.tasks_db.pop(task_id, None)
            self._refresh_processing_state()

        except Exception as e:
            logging.error(f"[Task {task_id}] Error: {str(e)}", exc_info=True)

            # Improved error handling for failed state update
            try:
                task.status = TaskStatus.FAILED
                task.error = str(e)  # Use direct assignment instead of __setattr__
                finished_at = datetime.utcnow()
                task.completedAt = utc_isoformat(finished_at)
                task.elapsedSeconds = _elapsed_seconds_since_start(task, finished_at)
                await loop.run_in_executor(_TASK_DB_EXECUTOR, update_task, task)

                file_name = task.file.name if task.file else "merge task"
                file_id = task.file.id if task.file else None
                await self._emit_notification_tracked(
                    NotificationType.TASK_FAILED,
                    "Task Failed",
                    f"'{file_name}': {str(e)}",
                    task_id=task.id,
                    file_id=file_id,
                )
            except Exception as update_error:
                logging.error(f"[Task {task_id}] Failed to update failed task in DB: {update_error}")
                # Continue with error reporting - task may still be processed

            await self._cleanup_created_files(task_id, created_files)
            if _should_delete_failed_task(task.error):
                deleted = await loop.run_in_executor(_TASK_DB_EXECUTOR, delete_task, task_id)
                if deleted:
                    logging.info(f"[Task {task_id}] Deleted terminal task after ignored-error cleanup: {task.error}")
                else:
                    logging.warning(f"[Task {task_id}] Terminal task was not found for ignored-error cleanup: {task.error}")
            self._cancel_events.pop(task_id, None)
            self._progress_snapshots.pop(task_id, None)
            self.tasks_db.pop(task_id, None)

            # Ensure we release the processing lock
            self._refresh_processing_state()
        finally:
            if scene_detection_slot_acquired:
                await self._release_scene_detection_slot()
            if downstream_lock_acquired:
                self._downstream_processing_lock.release()
