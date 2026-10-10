"""REST endpoints for saved file filter presets."""

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..crud import file_filter as file_filter_crud

router = APIRouter(prefix="/api/settings/file-filters", tags=["file-filters"])


class FileFilterSnapshot(BaseModel):
    """Filter dialog state persisted in a preset."""

    type: list[str] = Field(default_factory=list)
    format: list[str] = Field(default_factory=list)
    dateRange: list[str] = Field(default_factory=list)
    hasScenes: bool = False
    hasSplit: bool = False
    hasSubtitle: bool = False
    hasNoScenes: bool = False
    hasNoSplit: bool = False
    hasNoSubtitle: bool = False
    sceneCount: int | None = None
    statusFilter: list[str] = Field(default_factory=list)
    queueDisabled: bool = False
    queueDisabledNo: bool = False
    splitDisabled: bool = False
    splitDisabledNo: bool = False
    subtitleDisabled: bool = False
    subtitleDisabledNo: bool = False
    noNumberSuffix: bool = False
    newVideos: bool = False
    contentTag: str | None = None
    resolutionFilter: list[str] = Field(default_factory=list)
    fileSizeOperator: str = "gte"
    fileSizeValue: float | None = None
    selectedDirectoryIds: list[str] = Field(default_factory=list)
    directoryExclude: bool = False
    selectedDirectoryId: str | None = None
    isGroupedView: bool = False


class FileFilterPreset(BaseModel):
    """Saved preset record returned by the API."""

    id: str
    name: str
    created_at: str
    filters: FileFilterSnapshot
    isDefault: bool = False


class CreateFileFilterBody(BaseModel):
    """Request body for creating a saved filter preset."""

    name: str
    filters: FileFilterSnapshot


class UpdateFileFilterBody(BaseModel):
    """Request body for updating a saved filter preset."""

    name: str | None = None
    filters: FileFilterSnapshot | None = None
    isDefault: bool | None = None


@router.get("")
async def list_file_filters():
    """List all saved file filter presets."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, file_filter_crud.list_file_filters)


@router.post("")
async def create_file_filter(body: CreateFileFilterBody):
    """Save a new named file filter preset."""
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(
            None,
            file_filter_crud.create_file_filter,
            body.name,
            body.filters.model_dump(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{preset_id}")
async def update_file_filter(preset_id: str, body: UpdateFileFilterBody):
    """Update an existing saved file filter preset."""
    if body.name is None and body.filters is None and body.isDefault is None:
        raise HTTPException(status_code=400, detail="no fields to update")

    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(
            None,
            lambda: file_filter_crud.update_file_filter(
                preset_id,
                name=body.name,
                filters=body.filters.model_dump() if body.filters else None,
                is_default=body.isDefault,
            ),
        )
    except ValueError as exc:
        status = 404 if "not found" in str(exc) else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@router.delete("/{preset_id}")
async def delete_file_filter(preset_id: str):
    """Delete a saved file filter preset."""
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, file_filter_crud.delete_file_filter, preset_id)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
