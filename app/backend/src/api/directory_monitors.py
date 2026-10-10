import asyncio

from fastapi import APIRouter, Depends, HTTPException, Response

from ..crud.directory_monitor import (
    create_directory_monitor,
    delete_directory_monitor,
    get_all_directory_monitors,
    get_directory_monitor,
    update_directory_monitor,
)
from ..models.models import DirectoryMonitor, MonitorRunResponse
from ..task_manager import TaskManager
from ..api.tasks import task_manager as _task_manager_singleton
from ..utils import calculate_next_run, utc_isoformat
from ..workers.monitor_scheduler import run_monitor

router = APIRouter(prefix="/api")


def calculate_directory_monitor_next_run(monitor: DirectoryMonitor):
    default_timezone = "UTC" if monitor.schedule.time and not monitor.schedule.timeZone else None
    return calculate_next_run(monitor.schedule.model_dump(), default_timezone=default_timezone)


def get_task_manager() -> TaskManager:
    return _task_manager_singleton


@router.get("/directory-monitors", response_model=list[DirectoryMonitor])
async def list_monitors():
    """Return all directory monitors from the database."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, get_all_directory_monitors)


@router.post("/directory-monitors", response_model=DirectoryMonitor)
async def create_monitor(monitor: DirectoryMonitor):
    """Persist a new directory monitor, computing nextRun server-side."""
    try:
        next_run = calculate_directory_monitor_next_run(monitor)
        monitor = monitor.model_copy(update={"nextRun": utc_isoformat(next_run)})
        return create_directory_monitor(monitor)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/directory-monitors/{monitor_id}", response_model=DirectoryMonitor)
async def update_monitor(monitor_id: str, monitor: DirectoryMonitor):
    """Update monitor; always recomputes nextRun server-side from the current schedule."""
    try:
        if monitor.id != monitor_id:
            raise HTTPException(status_code=400, detail="ID in path does not match ID in payload")

        next_run = calculate_directory_monitor_next_run(monitor)
        monitor = monitor.model_copy(update={"nextRun": utc_isoformat(next_run)})

        updated_monitor = update_directory_monitor(monitor)
        if not updated_monitor:
            raise HTTPException(status_code=404, detail="Directory monitor not found")

        return updated_monitor
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/directory-monitors/{monitor_id}", status_code=204)
async def delete_monitor(monitor_id: str):
    """Remove a directory monitor from the database."""
    # False means missing row or DB failure; crud logs errors for the latter
    deleted = delete_directory_monitor(monitor_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="Directory monitor not found")

    return Response(status_code=204)


@router.post("/directory-monitors/{monitor_id}/run", status_code=202, response_model=MonitorRunResponse)
async def run_monitor_now(monitor_id: str, task_manager: TaskManager = Depends(get_task_manager)):
    """Immediately trigger a monitor run outside its schedule."""
    loop = asyncio.get_running_loop()
    monitor = await loop.run_in_executor(None, get_directory_monitor, monitor_id)
    if not monitor:
        raise HTTPException(status_code=404, detail="Directory monitor not found")
    if not monitor.isActive:
        raise HTTPException(status_code=409, detail="Disabled directory monitor cannot be run")

    queued, skipped = await run_monitor(task_manager, monitor, loop)
    return {"status": "queued", "queued": queued, "skipped": skipped}
