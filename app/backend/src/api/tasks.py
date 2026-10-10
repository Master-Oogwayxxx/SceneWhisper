import asyncio
import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud.file import File as FileCRUD
from ..crud.setting import get_settings
from ..crud.task import (
    delete_tasks_by_ids,
    delete_tasks_by_status,
    get_file_badge_tasks,
    get_overview_stats,
    get_tasks_by_status,
    get_tasks_by_status_paginated,
    get_tasks_paginated,
    has_completed_split,
    has_completed_subtitles,
)
from ..models.models import File, OverviewStatsResponse, ReorderCustomRequest, StatsResponse, Task, TaskResponse, TaskStatus, TaskType
from ..models.notification import NotificationType
from ..notification_service import emit_notification
from ..schemas.db_helper import db_session
from ..task_manager import TaskManager
from ..utils import find_pyscenedetect_splits, generate_filename_id, is_ignored, is_pyscenedetect_split, utc_isoformat

router = APIRouter(prefix="/api")

task_manager = TaskManager()


class MergeTaskRequest(BaseModel):
    file_ids: list[str]


class ReorderTasksRequest(BaseModel):
    task_ids: list[str]
    position: str  # "top" or "bottom"


class BulkPauseRequest(BaseModel):
    task_ids: list[str]


@router.post("/tasks/global-pause")
async def global_pause():
    """Pause all queued and processing tasks globally."""
    await task_manager.pause_all()
    return {"status": "success", "message": "All tasks paused"}


@router.post("/tasks/global-unpause")
async def global_unpause():
    """Resume all tasks that were paused globally."""
    await task_manager.unpause_all()
    return {"status": "success", "message": "All tasks resumed"}


@router.get("/tasks/global-pause-status")
async def global_pause_status():
    """Get current global pause state."""
    return {"is_globally_paused": task_manager.is_globally_paused}


@router.get("/stats", response_model=StatsResponse)
async def get_stats():
    """Get processing statistics"""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, task_manager.get_stats)


@router.get("/stats/overview", response_model=OverviewStatsResponse)
async def get_overview_stats_route():
    """Get comprehensive overview statistics"""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, get_overview_stats)


@router.get("/tasks", response_model=TaskResponse)
async def get_tasks(
    skip: int = 0,
    limit: int = 20,
    status: str | None = None,
    search: str | None = None,
    file_id: str | None = None,
    task_type: list[TaskType] | None = Query(None),
    date_range: list[str] | None = Query(None),
    subtitle_language: list[str] | None = Query(None),
    scene_detector: list[str] | None = Query(None),
    directory_id: list[str] | None = Query(None),
    directory_exclude: bool = False,
):
    """Get tasks with optional status filter, search by filename, and file_id filter"""
    loop = asyncio.get_running_loop()
    if status:
        tasks, total = await loop.run_in_executor(
            None,
            lambda: get_tasks_by_status_paginated(
                TaskStatus(status),
                skip,
                limit,
                search,
                file_id,
                task_type,
                date_range,
                subtitle_language,
                scene_detector,
                directory_id,
                directory_exclude,
            ),
        )
        return {"tasks": tasks, "skip": skip, "limit": limit, "total": total}
    else:
        tasks, total = await loop.run_in_executor(
            None,
            lambda: get_tasks_paginated(
                skip,
                limit,
                search,
                file_id,
                task_type,
                date_range,
                subtitle_language,
                scene_detector,
                directory_id,
                directory_exclude,
            ),
        )
        return {"tasks": tasks, "skip": skip, "limit": limit, "total": total}


@router.get("/tasks/file-badges", response_model=list[Task])
async def get_file_badges():
    """Return active tasks plus the newest terminal task for each file."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, get_file_badge_tasks)


@router.post("/tasks/add_video")
async def add_task_video(task: Task, db: Session = Depends(db_session)):
    """Add video to queue"""
    path = Path(task.file.path)

    loop = asyncio.get_running_loop()
    _s = await loop.run_in_executor(None, get_settings)
    _raw = _s.ignore_patterns
    _patterns: list[str] = json.loads(_raw) if isinstance(_raw, str) else (_raw or [])
    if _patterns and is_ignored(path.name, _patterns):
        raise HTTPException(status_code=422, detail=f"{path.name} matches an ignore pattern and cannot be queued.")

    try:
        # Generate task ID; use existing file ID or generate new one
        task_id = str(uuid.uuid4())
        file_id = task.file.id or generate_filename_id(task.file.name, task.file.path)

        file_crud = FileCRUD(db)
        if task.type in [TaskType.SPLIT, TaskType.ALL] and file_crud.is_task_type_disabled(file_id, "split"):
            raise HTTPException(status_code=422, detail="File is disabled from split and cannot be processed.")
        if task.type in [TaskType.SUBTITLE, TaskType.ALL] and file_crud.is_task_type_disabled(file_id, "subtitle"):
            raise HTTPException(status_code=422, detail="File is disabled from subtitle and cannot be processed.")

        # Check for existing outputs unless the relevant overwrite flag is set.
        if task.type == TaskType.SCENE or task.type == TaskType.SPLIT or task.type == TaskType.ALL:
            if not task.overwrite_split and not task.bypass_split_guard:
                if has_completed_split(file_id):
                    raise HTTPException(status_code=409, detail=f"Video {task.file.name} has already been split. Please use a different video or enable overwrite.")

                # Check if file itself is a split file
                if is_pyscenedetect_split(path):
                    await emit_notification(
                        type=NotificationType.TASK_FAILED,
                        title=f"Cannot queue task: {task.file.name}",
                        message="File might be a split video. Please enable overwrite.",
                        file_id=file_id,
                    )

                    raise HTTPException(status_code=422, detail=f"{path.name} is a split file and cannot be queued.")

                existing_splits = find_pyscenedetect_splits(path)

                if existing_splits:
                    await emit_notification(
                        type=NotificationType.TASK_FAILED,
                        title=f"Cannot queue task: {task.file.name}",
                        message="Split files detected on disk. Please use a different video or enable overwrite.",
                        file_id=file_id,
                    )
                    raise HTTPException(status_code=409, detail=(f"Video {task.file.name} has split files on disk. Please use a different video or enable overwrite."))

        if task.type == TaskType.SUBTITLE or task.type == TaskType.ALL:
            if not task.overwrite_subtitles:
                if has_completed_subtitles(file_id):
                    raise HTTPException(status_code=409, detail=f"Video {task.file.name} already has subtitles. Please use a different video or enable overwrite.")

                # Fallback: check filesystem for orphaned subtitle files (in case DB record was deleted)
                existing_srt_files = list(path.parent.glob(f"{path.stem}.srt"))
                if existing_srt_files:
                    await emit_notification(
                        type=NotificationType.TASK_FAILED,
                        title=f"Cannot queue task: {task.file.name}",
                        message="Subtitle files detected on disk. Please use a different video or enable overwrite.",
                        file_id=file_id,
                    )

                    raise HTTPException(status_code=409, detail=f"Video {task.file.name} has subtitle files on disk. Please use a different video or enable overwrite.")

        file = File(
            id=file_id,
            name=task.file.name,
            path=task.file.path,
            size=task.file.size,
            duration=task.file.duration,
            format=task.file.format,
        )

        video_task = Task(
            id=task_id,
            file=file,
            type=task.type,
            subtitleLanguage=task.subtitleLanguage if task.type in [TaskType.SUBTITLE, TaskType.ALL] else None,
            status=TaskStatus.QUEUED,
            createdAt=task.createdAt,
            overwrite_scenes=task.overwrite_scenes,
            overwrite_split=task.overwrite_split,
            bypass_split_guard=task.bypass_split_guard,
            overwrite_subtitles=task.overwrite_subtitles,
            scene_detector=task.scene_detector,
            delete_video_after_completion=task.delete_video_after_completion,
            nvenc_overwrite_original=task.nvenc_overwrite_original,
        )

        queued, existing_task = await task_manager.add_task(video_task)

        if not queued and not existing_task:
            return {
                "message": f"{path.name} is empty (0 B) and was not added to the queue",
                "duplicate": False,
                "empty_file": True,
                "tasks": [],
            }

        if not queued and existing_task:
            if existing_task.status == TaskStatus.PAUSED:
                message = f"A paused task already exists for {path.name}"
            else:
                message = f"An active {existing_task.status.value} task already exists for {path.name}"
            return {
                "message": message,
                "duplicate": True,
                "existing_status": existing_task.status.value,
                "tasks": [existing_task],
            }

        return {"message": f"Added {path} to queue", "duplicate": False, "tasks": [video_task]}

    except HTTPException:
        raise

    except Exception as e:
        logging.error(f"Error adding task: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to add task for {path}: {str(e)}")


@router.post("/tasks/reorder")
async def reorder_tasks(body: ReorderTasksRequest):
    """Move queued tasks to the top or bottom of the processing queue."""
    if body.position not in ("top", "bottom"):
        raise HTTPException(status_code=400, detail="position must be 'top' or 'bottom'")
    if not body.task_ids:
        raise HTTPException(status_code=400, detail="task_ids must not be empty")
    await task_manager.reorder_queue(body.task_ids, body.position)
    return {"message": f"Moved {len(body.task_ids)} task(s) to {body.position}"}


@router.post("/tasks/bulk-pause")
async def bulk_pause_tasks_endpoint(body: BulkPauseRequest):
    """Pause multiple tasks in one request, emitting a single notification."""
    paused = []
    for task_id in body.task_ids:
        task = task_manager.get_task(task_id)
        if not task or task.status not in [TaskStatus.QUEUED, TaskStatus.PROCESSING]:
            continue
        success = await task_manager.pause_task(task_id)
        if success:
            updated = task_manager.get_task(task_id)
            if updated:
                paused.append(updated)

    if paused:
        await task_manager._emit_notification_tracked(
            type=NotificationType.TASK_PAUSED,
            title="Tasks paused",
            message=f"{len(paused)} task(s) paused",
        )

    return {"paused_count": len(paused), "tasks": paused}


@router.post("/tasks/bulk-unpause")
async def bulk_unpause_tasks_endpoint(body: BulkPauseRequest):
    """Unpause multiple tasks in one request, emitting a single notification."""
    unpaused = []
    for task_id in body.task_ids:
        task = task_manager.get_task(task_id)
        if not task or task.status != TaskStatus.PAUSED:
            continue
        success = await task_manager.unpause_task(task_id)
        if success:
            updated = task_manager.get_task(task_id)
            if updated:
                unpaused.append(updated)

    if unpaused:
        await task_manager._emit_notification_tracked(
            type=NotificationType.TASK_UNPAUSED,
            title="Tasks resumed",
            message=f"{len(unpaused)} task(s) back in queue",
        )

    return {"unpaused_count": len(unpaused), "tasks": unpaused}


@router.post("/tasks/reorder-custom")
async def reorder_tasks_custom(body: ReorderCustomRequest):
    """Set custom queue order for tasks (drag-and-drop)."""
    if not body.task_ids:
        raise HTTPException(status_code=400, detail="task_ids required")
    await task_manager.reorder_queue_custom(body.task_ids)
    return {"message": f"Reordered {len(body.task_ids)} task(s)"}


@router.get("/tasks/{task_id}")
async def get_task(task_id: str):
    """Get specific task"""
    task = task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: str):
    """Cancel a task"""
    task = task_manager.get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if await task_manager.cancel_task(task_id):
        return {"message": "Task cancelled", "task": task}

    return {"message": "Failed to cancel task", "task": task}


@router.post("/tasks/{task_id}/pause")
async def pause_task_endpoint(task_id: str):
    """Pause a task (queued or processing)"""
    task = task_manager.get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status not in [TaskStatus.QUEUED, TaskStatus.PROCESSING]:
        raise HTTPException(status_code=400, detail=f"Cannot pause task in {task.status} state")

    success = await task_manager.pause_task(task_id)

    if success:
        updated_task = task_manager.get_task(task_id)

        # Emit notification (throttled via semaphore to prevent event loop flooding)
        stage_display = updated_task.currentStage if updated_task.currentStage else "Unknown stage"
        await task_manager._emit_notification_tracked(
            type=NotificationType.TASK_PAUSED,
            title=f"Task paused: {updated_task.file.name if updated_task.file else 'Unknown'}",
            message=stage_display,
            task_id=task_id,
            file_id=updated_task.file.id if updated_task.file else None,
        )

        return {"message": "Task paused", "task": updated_task}

    raise HTTPException(status_code=500, detail="Failed to pause task")


@router.post("/tasks/{task_id}/unpause")
async def unpause_task_endpoint(task_id: str):
    """Unpause a task (paused → queued)"""
    task = task_manager.get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status != TaskStatus.PAUSED:
        raise HTTPException(status_code=400, detail=f"Cannot unpause task in {task.status} state")

    success = await task_manager.unpause_task(task_id)

    if success:
        updated_task = task_manager.get_task(task_id)

        # Emit notification (throttled via semaphore to prevent event loop flooding)
        stage_display = updated_task.currentStage if updated_task.currentStage else "Ready to process"
        await task_manager._emit_notification_tracked(
            type=NotificationType.TASK_UNPAUSED,
            title=f"Task resumed: {updated_task.file.name if updated_task.file else 'Unknown'}",
            message=f"Back to {stage_display}",
            task_id=task_id,
            file_id=updated_task.file.id if updated_task.file else None,
        )

        return {"message": "Task unpaused", "task": updated_task}

    raise HTTPException(status_code=500, detail="Failed to unpause task")


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    """Delete a task"""
    task = task_manager.get_task(task_id)

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task_manager.delete_task(task_id)

    return {"message": "Task deleted", "task": task}


@router.post("/tasks/merge")
async def create_merge_task(body: MergeTaskRequest, db: Session = Depends(db_session)):
    """Merge multiple videos into one"""
    try:
        if len(body.file_ids) < 2:
            raise HTTPException(status_code=400, detail="At least 2 files required for merge")

        file_crud = FileCRUD(db)
        paths = []
        for fid in body.file_ids:
            record = file_crud.get_file_metadata(file_id=fid)
            if not record:
                raise HTTPException(status_code=404, detail=f"File {fid} not found")
            if not Path(record.path).exists():
                raise HTTPException(status_code=404, detail=f"File {record.path} not on disk")
            paths.append(record.path)

        task_id = str(uuid.uuid4())

        merge_task = Task(
            id=task_id,
            file=None,
            type=TaskType.MERGE,
            status=TaskStatus.QUEUED,
            createdAt=utc_isoformat(datetime.utcnow()),
        )

        merge_task.merge_input_paths = json.dumps(paths)

        await task_manager.add_task(merge_task)

        return {"message": f"Merge task created for {len(paths)} files", "task": merge_task}

    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error creating merge task: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create merge task: {str(e)}")


@router.delete("/tasks")
async def delete_tasks_by_status_route(
    status: str = Query(..., description="Task status to clear"),
) -> dict:
    """
    Delete all tasks with a given status.

    Supported statuses: queued, processing, completed, failed, cancelled
    """
    valid_statuses = {"queued", "processing", "completed", "failed", "cancelled"}
    if status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(valid_statuses))}",
        )

    try:
        # For 'processing' tasks, collect IDs first, cancel, then delete by ID
        # (cancel_task changes status to CANCELLED, so delete_tasks_by_status("processing") would miss them)
        if status == "processing":
            active_tasks = get_tasks_by_status(TaskStatus(status))
            task_ids = [t.id for t in active_tasks]
            for task_id in task_ids:
                success = await task_manager.cancel_task(task_id)
                if not success:
                    logging.warning(f"Task {task_id} could not be cancelled (may have already completed)")
                task_manager.tasks_db.pop(task_id, None)
            deleted_count = delete_tasks_by_ids(task_ids)
            return {"deleted": deleted_count}

        # For 'queued' tasks, remove from TaskManager queue
        if status == "queued":
            await task_manager.clear_queue()

        deleted_count = delete_tasks_by_status(TaskStatus(status))
        # Evict deleted tasks from in-memory store
        for task_id in list(task_manager.tasks_db.keys()):
            task = task_manager.tasks_db.get(task_id)
            if task and task.status == TaskStatus(status):
                task_manager.tasks_db.pop(task_id, None)
        return {"deleted": deleted_count}
    except Exception as e:
        logging.error(f"Error clearing {status} tasks: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear {status} tasks")
