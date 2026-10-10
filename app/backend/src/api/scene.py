import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..crud.file import File as FileCRUD
from ..crud.scene import Scene as SceneCRUD
from ..crud.task import has_active_split_task
from ..models.models import File, Task, TaskStatus, TaskType
from ..utils import utc_isoformat
from ..schemas.db_helper import db_session
from .tasks import task_manager


class SceneUpdate(BaseModel):
    start_timecode: str
    end_timecode: str
    queue_task: bool = True


class SceneCreate(BaseModel):
    file_id: str
    start_timecode: str
    end_timecode: str


router = APIRouter(prefix="/api/scenes")


@router.get("/file/{file_id}")
def get_scenes_for_file(file_id: str, db: Session = Depends(db_session)):
    """Return all scenes for a file ordered by scene number."""
    service = SceneCRUD(db)
    return service.get_scenes_for_file(file_id)


@router.get("/file/{file_id}/count")
def get_scene_count(file_id: str, db: Session = Depends(db_session)):
    """Return the number of detected scenes for a file."""
    service = SceneCRUD(db)
    return {"file_id": file_id, "count": service.scene_count_for_file(file_id)}


@router.get("/{scene_id}")
def get_scene(scene_id: str, db: Session = Depends(db_session)):
    """Return a single scene by ID."""
    service = SceneCRUD(db)
    scene = service.get_scene(scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    return scene


@router.post("")
async def create_scene(body: SceneCreate, db: Session = Depends(db_session)):
    """Create a new scene for a file."""
    service = SceneCRUD(db)
    scene = service.create_scene_simple(body.file_id, body.start_timecode, body.end_timecode)
    if not scene:
        raise HTTPException(status_code=400, detail="Failed to create scene")
    return scene


@router.put("/{scene_id}")
async def update_scene(scene_id: str, body: SceneUpdate, db: Session = Depends(db_session)):
    """Update a scene's start/end timecodes and optionally re-queue a SPLIT task if not already active."""
    service = SceneCRUD(db)
    scene = service.update_scene(scene_id, body.start_timecode, body.end_timecode)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    if body.queue_task and not has_active_split_task(scene.file_id):
        file_record = FileCRUD(db).get_file_metadata(file_id=scene.file_id)
        if file_record:
            file_model = File(
                id=file_record.id,
                name=file_record.name,
                path=file_record.path,
                size=file_record.size or 0,
                format=file_record.format or "",
            )
            split_task = Task(
                id=str(uuid.uuid4()),
                file=file_model,
                type=TaskType.SPLIT,
                status=TaskStatus.QUEUED,
                createdAt=utc_isoformat(datetime.utcnow()),
                overwrite_scenes=False,
                overwrite_split=True,
            )
            await task_manager.add_task(split_task)

    return scene


@router.delete("/{scene_id}")
async def delete_scene(scene_id: str, db: Session = Depends(db_session)):
    """Delete a single scene by ID."""
    service = SceneCRUD(db)
    deleted = service.delete_scene(scene_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Scene not found")
    return {"scene_id": scene_id, "deleted": True}


@router.delete("/file/{file_id}")
async def delete_scenes_for_file(file_id: str, db: Session = Depends(db_session)):
    """Delete all scenes for a file."""
    service = SceneCRUD(db)
    deleted = service.delete_scenes_for_file(file_id)
    return {"file_id": file_id, "deleted": deleted}
