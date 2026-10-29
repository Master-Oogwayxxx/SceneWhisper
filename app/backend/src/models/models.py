from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class TaskStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ProcessingStage(str, Enum):
    SCENE_DETECTION = "scene_detection"
    VIDEO_SPLITTING = "video_splitting"
    VIDEO_REENCODING = "video_reencoding"
    VIDEO_FRAME_PACING_ANALYSIS = "video_frame_pacing_analysis"
    VIDEO_FRAME_PACING_REPAIR = "video_frame_pacing_repair"
    VIDEO_REMUXING = "video_remuxing"
    VIDEO_MERGING = "video_merging"
    SUBTITLE_GENERATION = "subtitle_generation"
    COMPLETED = "completed"


class File(BaseModel):
    id: str
    name: str
    path: str
    size: int
    duration: Optional[str] = None
    format: str
    parent_id: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    codec: Optional[str] = None
    bitrate: Optional[int] = None
    file_type: Optional[str] = None
    last_scanned_at: Optional[str] = None
    child_ids: Optional[str] = None
    has_scenes: Optional[bool] = None
    has_split: Optional[bool] = None
    has_subtitle: Optional[bool] = None
    queue_disabled: bool = False
    split_disabled: bool = False
    subtitle_disabled: bool = False
    is_deleted: bool = False


class FileQueryParams(BaseModel):
    page: int = 1
    limit: int = 30
    search: Optional[str] = None
    type: Optional[str] = None
    format: Optional[str] = None
    date_range: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    directory_id: Optional[str] = None
    directory_exclude: bool = False
    sort_by: str = "created_at"
    sort_dir: str = "desc"
    has_scenes: Optional[bool] = None
    has_split: Optional[bool] = None
    has_subtitle: Optional[bool] = None
    has_no_scenes: Optional[bool] = None
    has_no_split: Optional[bool] = None
    has_no_subtitle: Optional[bool] = None
    scene_count: int | None = None
    status: Optional[str] = None
    queue_disabled: Optional[bool] = None
    split_disabled: Optional[bool] = None
    subtitle_disabled: Optional[bool] = None
    no_number_suffix: Optional[bool] = None
    new_videos: Optional[bool] = None
    content_tag: Literal["censored", "uncensored", "subtitled"] | None = None
    resolution: Optional[str] = None
    file_size_operator: Optional[str] = None
    file_size_bytes: Optional[int] = None


class Directory(BaseModel):
    id: str
    name: str
    path: str
    files: list[File]
    subdirectories: list["Directory"]


Directory.model_rebuild()


class TaskType(str, Enum):
    SCENE = "scene"
    SPLIT = "split"
    SUBTITLE = "subtitle"
    ALL = "all"
    MERGE = "merge"
    ANALYZE_FRAME_PACING = "analyze_frame_pacing"
    NVENC_FRAME_PACING = "nvenc_frame_pacing"
    REMUX = "remux"


class ScheduleInterval(str, Enum):
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"


class Schedule(BaseModel):
    interval: ScheduleInterval
    time: Optional[str] = None
    dayOfWeek: Optional[int] = None
    timeZone: Optional[str] = None


class DirectoryMonitor(BaseModel):
    id: str
    directoryId: str
    directoryName: str
    directoryPath: str
    taskType: TaskType
    taskTypes: list[TaskType] = Field(default_factory=list)
    subtitleLanguage: Optional[str] = None
    schedule: Schedule
    isActive: bool
    deleteVideoAfterCompletion: bool = False
    fillMissingSubtitles: bool = False
    splitScope: Literal["both", "uncensored", "censored"] = "both"
    framePacingScope: Literal["all", "split"] = "all"
    framePacingResolution: Literal["all", "sd", "720p", "1080p", "1440p", "4k"] = "all"
    framePacingResolutions: list[Literal["sd", "720p", "1080p", "1440p", "4k"]] = Field(default_factory=list)
    nvencOverwriteOriginal: bool = False
    lastRun: Optional[str] = None
    nextRun: Optional[str] = None
    createdAt: str

    @model_validator(mode="after")
    def normalize_task_types(self):
        if not self.taskTypes:
            self.taskTypes = [TaskType.SPLIT, TaskType.SUBTITLE] if self.taskType == TaskType.ALL else [self.taskType]
        else:
            seen: set[TaskType] = set()
            normalized: list[TaskType] = []
            for task_type in self.taskTypes:
                if task_type in seen:
                    continue
                if task_type == TaskType.ALL:
                    for expanded_type in (TaskType.SPLIT, TaskType.SUBTITLE):
                        if expanded_type not in seen:
                            normalized.append(expanded_type)
                            seen.add(expanded_type)
                    continue
                if task_type == TaskType.SCENE:
                    normalized = [existing for existing in normalized if existing != TaskType.SPLIT]
                    seen.discard(TaskType.SPLIT)
                elif task_type == TaskType.SPLIT:
                    normalized = [existing for existing in normalized if existing != TaskType.SCENE]
                    seen.discard(TaskType.SCENE)
                elif task_type == TaskType.ANALYZE_FRAME_PACING:
                    normalized = [existing for existing in normalized if existing != TaskType.NVENC_FRAME_PACING]
                    seen.discard(TaskType.NVENC_FRAME_PACING)
                elif task_type == TaskType.NVENC_FRAME_PACING:
                    normalized = [existing for existing in normalized if existing != TaskType.ANALYZE_FRAME_PACING]
                    seen.discard(TaskType.ANALYZE_FRAME_PACING)
                normalized.append(task_type)
                seen.add(task_type)
            self.taskTypes = normalized
            self.taskType = self.taskTypes[0]
        if not self.framePacingResolutions and self.framePacingResolution not in ("all", "4k"):
            self.framePacingResolutions = [self.framePacingResolution]
        elif self.framePacingResolutions:
            seen_resolutions: set[str] = set()
            self.framePacingResolutions = [
                resolution
                for resolution in self.framePacingResolutions
                if resolution != "4k" and not (resolution in seen_resolutions or seen_resolutions.add(resolution))
            ]
            self.framePacingResolution = "all"
        return self


class ActressDownloadMonitorCriteria(BaseModel):
    search: str = ""
    sortBy: str = "date"
    sortDir: str = "desc"
    hasImage: Optional[bool] = None
    fileExists: Optional[bool] = None
    localFileState: Optional[str] = None
    uncensored: Optional[bool] = None
    censored: Optional[bool] = None
    subtitled: Optional[bool] = None
    resolution: Optional[str] = None
    releaseYear: Optional[int] = None


class ActressDownloadMonitor(BaseModel):
    id: str
    actressId: int
    actressName: str
    schedule: Schedule
    isActive: bool
    criteria: ActressDownloadMonitorCriteria = ActressDownloadMonitorCriteria()
    maxItemsPerRun: int = 25
    savePath: Optional[str] = None
    lastRun: Optional[str] = None
    nextRun: Optional[str] = None
    lastQueued: int = 0
    lastSkipped: int = 0
    lastError: Optional[str] = None
    createdAt: str


class MonitorRunResponse(BaseModel):
    status: str
    queued: int
    skipped: int


class ScraperSource(BaseModel):
    id: str
    name: str
    url: str
    urls: list[str] = Field(default_factory=list)
    urlActressNameReversed: list[bool] = Field(default_factory=list)
    schedule: Schedule
    isActive: bool
    lastRun: Optional[str] = None
    nextRun: Optional[str] = None
    lastFound: int = 0
    lastNew: int = 0
    lastPagesScraped: int = 0
    lastWebsiteStats: list[dict] = Field(default_factory=list)
    lastError: Optional[str] = None
    createdAt: str


class ScrapedVideo(BaseModel):
    id: str
    sourceId: str
    videoCode: str
    title: Optional[str] = None
    url: Optional[str] = None
    uncensored: Optional[bool] = None
    censored: Optional[bool] = None
    subtitled: Optional[bool] = None
    opened: bool = False
    openedAt: Optional[str] = None
    fileExists: bool = False
    scrapedAt: str
    firstSeenAt: str


class ScraperOpenedVideosRequest(BaseModel):
    ids: list[str]


class ScrapedVideosResponse(BaseModel):
    items: list[ScrapedVideo]
    total: int
    skip: int
    limit: int


class ScraperRunResponse(BaseModel):
    status: str
    found: int
    created: int
    updated: int
    pagesScraped: int


class ScraperRunRequest(BaseModel):
    urls: list[str] | None = None


class Task(BaseModel):
    id: str
    file: Optional[File] = None
    type: TaskType
    status: TaskStatus
    currentStage: Optional[ProcessingStage] = None
    scene_progress: float = 0.0
    split_progress: float = 0.0
    subtitle_progress: float = 0.0
    merge_progress: float = 0.0
    subtitleLanguage: Optional[str] = None
    scheduledFor: Optional[str] = None
    createdAt: str
    startedAt: Optional[str] = None
    stageStartedAt: Optional[str] = None
    completedAt: Optional[str] = None
    pausedAt: Optional[str] = None
    elapsedSeconds: Optional[int] = None
    scene_elapsed_seconds: Optional[int] = None
    split_elapsed_seconds: Optional[int] = None
    subtitle_elapsed_seconds: Optional[int] = None
    scene_count: int = 0
    split_count: int = 0
    error: Optional[str] = None
    overwrite_scenes: Optional[bool] = False
    overwrite_split: Optional[bool] = False
    bypass_split_guard: Optional[bool] = False
    overwrite_subtitles: Optional[bool] = False
    scene_detector: Optional[str] = None
    delete_video_after_completion: Optional[bool] = False
    nvenc_overwrite_original: Optional[bool] = False
    merge_input_paths: Optional[str] = None


class DirectoryRequest(BaseModel):
    directory_path: str


class VideoRequest(BaseModel):
    video_path: str


class ReorderCustomRequest(BaseModel):
    """Request to set custom queue order for tasks."""
    task_ids: list[str]


class TaskResponse(BaseModel):
    tasks: list[Task]
    skip: int
    limit: int
    total: int


class StatsResponse(BaseModel):
    total: int
    queued: int
    processing: int
    completed: int
    failed: int
    cancelled: int
    paused: int


class TaskTypeStats(BaseModel):
    scene: int
    split: int
    subtitle: int
    all: int
    merge: int
    analyze_frame_pacing: int
    nvenc_frame_pacing: int
    remux: int


class ProcessingStats(BaseModel):
    total: int
    queued: int
    processing: int
    completed: int
    failed: int
    cancelled: int
    by_type: TaskTypeStats
    success_rate: float
    error_rate: float
    avg_elapsed_seconds: Optional[float]
    min_elapsed_seconds: Optional[int]
    max_elapsed_seconds: Optional[int]
    total_scenes_generated: int
    total_splits_generated: int


class FileCoverageStats(BaseModel):
    total_files: int
    with_scenes: int
    with_split: int
    with_subtitle: int
    pct_with_scenes: float
    pct_with_split: float
    pct_with_subtitle: float


class StorageStats(BaseModel):
    total_bytes: int
    avg_bytes: int
    max_bytes: int
    zero_byte_files: int
    video_files: int
    by_format: dict[str, int]
    by_codec: dict[str, int]
    res_4k: int
    res_1080p: int
    res_720p: int
    res_sd: int
    known_duration_files: int
    missing_duration_files: int
    total_duration_seconds: float
    avg_duration_seconds: Optional[float]
    min_duration_seconds: Optional[float]
    max_duration_seconds: Optional[float]
    avg_bitrate_mbps: Optional[float]


class SceneStats(BaseModel):
    total_scenes: int
    avg_scenes_per_file: float
    avg_scene_duration_seconds: float
    min_scene_duration_seconds: Optional[float]
    max_scene_duration_seconds: Optional[float]


class DirectoryStats(BaseModel):
    total_directories: int
    top_directories: list[dict]
    total_monitors: int
    active_monitors: int
    monitors_by_schedule: dict[str, int]


class OverviewStatsResponse(BaseModel):
    processing: ProcessingStats
    coverage: FileCoverageStats
    storage: StorageStats
    scenes: SceneStats
    directories: DirectoryStats


class LogEntry(BaseModel):
    id: int
    created_at: str
    level: str
    logger_name: str
    module: str
    message: str
    task_id: Optional[str] = None
    exc_text: Optional[str] = None


class LogsResponse(BaseModel):
    items: list[LogEntry]
    total: int


class BookmarkMatchedFile(BaseModel):
    id: str
    name: str
    path: str
    size: int
    created_at: Optional[datetime] = None
    modified_at: Optional[datetime] = None
    duration: Optional[str] = None
    format: Optional[str] = None
    file_type: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    codec: Optional[str] = None
    bitrate: Optional[int] = None
    is_deleted: bool = False


class BookmarkVideoCheckItem(BaseModel):
    title: str
    url: str
    video_code: str
    bookmark_path: Optional[str] = None
    file_exists: bool = False
    matched_files: list[BookmarkMatchedFile] = Field(default_factory=list)


class BookmarkVideoCheckRequest(BaseModel):
    items: list[BookmarkVideoCheckItem]
    directory_ids: list[str] = Field(default_factory=list)
    local_match_traits: bool = True
    local_match_resolution: bool = False


class BookmarkVideoCheckResponse(BaseModel):
    items: list[BookmarkVideoCheckItem]
    total: int
    existing: int


class ActressSummary(BaseModel):
    id: int
    name_romaji: Optional[str] = None
    name_kanji: Optional[str] = None
    name_kana: Optional[str] = None
    image_url: Optional[str] = None
    display_name: Optional[str] = None


class ActressWork(BaseModel):
    content_id: str
    dvd_id: Optional[str] = None
    video_code: Optional[str] = None
    title_en: Optional[str] = None
    title_ja: Optional[str] = None
    release_date: Optional[str] = None
    image_url: Optional[str] = None
    file_exists: bool = False
    is_uncensored: bool = False
    is_subtitled: bool = False
    resolution: Optional[str] = None
    local_file_state: Optional[str] = None
    is_opened: bool = False
    opened_sites: list[str] = []


class ActressDetail(ActressSummary):
    work_count: int = 0
    recent_works: list[ActressWork] = []


class ActressesResponse(BaseModel):
    items: list[ActressSummary]
    total: int


class ActressWorksResponse(BaseModel):
    items: list[ActressWork]
    total: int


class R18ImportResult(BaseModel):
    actress_count: int
    duration_seconds: float
    imported_at: str
    filename: str


class R18ImportStatus(BaseModel):
    state: str
    phase: Optional[str] = None
    download_bytes: Optional[int] = None
    download_total: Optional[int] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


class TorrentStatus(BaseModel):
    content_id: str
    video_code: str
    torrent_hash: Optional[str] = None
    torrent_name: str
    status: str
    progress: float
    speed: int
    eta: int
    added_at: datetime
    completed_at: Optional[datetime] = None
    seeders: Optional[int] = None
    created_at: Optional[int] = None
    size: Optional[int] = None
    total_size: Optional[int] = None
    save_path: Optional[str] = None
    state: Optional[str] = None


class DownloadQueueStatus(BaseModel):
    id: int
    content_id: str
    video_code: str
    status: str
    error: Optional[str] = None
    torrent_url: Optional[str] = None
    save_path: Optional[str] = None
    added_at: datetime
    processed_at: Optional[datetime] = None
    position: int


class R18Status(BaseModel):
    loaded: bool
    actress_count: int
    imported_at: Optional[str] = None
    import_in_progress: bool = False
    import_state: str = "idle"
    import_phase: Optional[str] = None
    download_bytes: Optional[int] = None
    download_total: Optional[int] = None
    import_error: Optional[str] = None
