import asyncio
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ..crud.actress_download_monitor import (
    create_actress_download_monitor,
    delete_actress_download_monitor,
    get_actress_download_monitor,
    get_all_actress_download_monitors,
    update_actress_download_monitor,
)
from ..models.models import ActressDownloadMonitor, MonitorRunResponse
from ..schemas.db_helper import db_session
from ..utils import calculate_next_run, utc_isoformat
from ..workers.actress_download_monitor_scheduler import run_actress_download_monitor

router = APIRouter(prefix="/api/r18", tags=["r18"])


@router.get("/actress-download-monitors", response_model=list[ActressDownloadMonitor])
async def list_actress_download_monitors(db: Session = Depends(db_session)):
    return get_all_actress_download_monitors(db)


@router.post("/actress-download-monitors", response_model=ActressDownloadMonitor)
async def create_monitor(monitor: ActressDownloadMonitor, db: Session = Depends(db_session)):
    try:
        next_run = calculate_next_run(monitor.schedule.model_dump())
        now = utc_isoformat(datetime.utcnow())
        monitor = monitor.model_copy(
            update={
                "id": monitor.id or str(uuid4()),
                "nextRun": utc_isoformat(next_run),
                "createdAt": monitor.createdAt or now,
            }
        )
        return create_actress_download_monitor(db, monitor)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/actress-download-monitors/{monitor_id}", response_model=ActressDownloadMonitor)
async def update_monitor(monitor_id: str, monitor: ActressDownloadMonitor, db: Session = Depends(db_session)):
    if monitor.id != monitor_id:
        raise HTTPException(status_code=400, detail="ID in path does not match ID in payload")
    try:
        next_run = calculate_next_run(monitor.schedule.model_dump())
        monitor = monitor.model_copy(update={"nextRun": utc_isoformat(next_run)})
        updated = update_actress_download_monitor(db, monitor)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail="Actress download monitor not found")
    return updated


@router.delete("/actress-download-monitors/{monitor_id}", status_code=204)
async def delete_monitor(monitor_id: str, db: Session = Depends(db_session)):
    if not delete_actress_download_monitor(db, monitor_id):
        raise HTTPException(status_code=404, detail="Actress download monitor not found")
    return Response(status_code=204)


@router.post("/actress-download-monitors/{monitor_id}/run", status_code=202, response_model=MonitorRunResponse)
async def run_monitor_now(monitor_id: str, db: Session = Depends(db_session)):
    monitor = get_actress_download_monitor(db, monitor_id)
    if not monitor:
        raise HTTPException(status_code=404, detail="Actress download monitor not found")

    loop = asyncio.get_running_loop()
    queued, skipped = await loop.run_in_executor(None, lambda: run_actress_download_monitor(db, monitor))
    return MonitorRunResponse(status="queued", queued=queued, skipped=skipped)
