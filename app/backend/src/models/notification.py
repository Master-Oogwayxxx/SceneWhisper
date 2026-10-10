from datetime import datetime
from enum import Enum

from pydantic import BaseModel, field_validator


class NotificationType(str, Enum):
    TASK_QUEUED = "task_queued"
    TASK_STARTED = "task_started"
    STAGE_COMPLETED = "stage_completed"
    TASK_COMPLETED = "task_completed"
    TASK_FAILED = "task_failed"
    TASK_CANCELLED = "task_cancelled"
    TASK_PAUSED = "task_paused"
    TASK_UNPAUSED = "task_unpaused"
    TASK_ALREADY_EXISTS = "task_already_exists"
    SCAN_STARTED = "scan_started"
    SCAN_COMPLETED = "scan_completed"
    FILES_FOUND = "files_found"
    SYSTEM_WARNING = "system_warning"
    R18_IMPORT_STARTED = "r18_import_started"
    R18_DOWNLOAD_STARTED = "r18_download_started"
    R18_DOWNLOAD_COMPLETED = "r18_download_completed"
    R18_IMPORTING = "r18_importing"
    R18_IMPORT_COMPLETED = "r18_import_completed"
    R18_IMPORT_FAILED = "r18_import_failed"
    SCRAPER_COMPLETED = "scraper_completed"


class Notification(BaseModel):
    id: str
    type: NotificationType
    title: str
    message: str
    task_id: str | None
    file_id: str | None
    is_read: bool
    created_at: str

    @field_validator("created_at", mode="before")
    @classmethod
    def normalize_utc(cls, v: object) -> str:
        if isinstance(v, datetime):
            return v.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"
        s = str(v)
        if not s.endswith("Z") and "+" not in s and s.count("-") <= 2:
            return s.replace(" ", "T") + "Z"
        return s

    class Config:
        from_attributes = True


class NotificationsResponse(BaseModel):
    notifications: list[Notification]
    total: int
    unread_count: int
    page: int
    limit: int
