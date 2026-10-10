export interface Directory {
  id: string
  name: string
  path: string
  files: File[]
  subdirectories: Directory[]
  isExpanded?: boolean
}

export interface File {
  id: string
  name: string
  path: string
  created_at: Date
  modified_at: Date
  last_scanned_at?: Date
  size: number
  format: string
  file_type: 'video' | 'subtitle' | 'other'
  duration: string
  parent_id?: string
  child_ids?: string
  width?: number
  height?: number
  fps?: number
  codec?: string
  bitrate?: number
  has_scenes?: boolean
  has_split?: boolean
  has_subtitle?: boolean
  queue_disabled?: boolean
  split_disabled?: boolean
  subtitle_disabled?: boolean
  is_deleted?: boolean
}

export interface FilesResponse {
  files: File[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface GroupedFilesResponse {
  groups: Record<string, File[]>
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface DeletedFile {
  id: number
  file_record_id?: string | null
  name: string
  path: string
  size?: number | null
  file_type?: string | null
  format?: string | null
  sha256?: string | null
  directory_id?: string | null
  deleted_at: string
  original_created_at?: string | null
  original_modified_at?: string | null
  reason: string
  source: string
}

export interface DeletedFilesResponse {
  items: DeletedFile[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface Task {
  id: string
  file?: File

  type: 'scene' | 'split' | 'subtitle' | 'all' | 'merge' | 'analyze_frame_pacing' | 'nvenc_frame_pacing' | 'remux'
  status: TaskStatus
  currentStage?: ProcessingStage

  scene_progress: number
  split_progress: number
  subtitle_progress: number
  merge_progress?: number

  subtitleLanguage?: string
  scheduledFor?: Date

  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  pausedAt?: string | null

  /** Server-measured processing duration in seconds (set when task completes). */
  elapsedSeconds?: number
  /** Per-stage elapsed seconds. */
  scene_elapsed_seconds?: number
  split_elapsed_seconds?: number
  subtitle_elapsed_seconds?: number

  scene_count?: number
  split_count?: number

  error?: string
  overwrite_scenes?: boolean
  overwrite_split?: boolean
  bypass_split_guard?: boolean
  overwrite_subtitles?: boolean
  scene_detector?: string
  delete_video_after_completion?: boolean
  nvenc_overwrite_original?: boolean
  merge_input_paths?: string
}

export type TaskType = 'scene' | 'split' | 'subtitle' | 'all' | 'merge' | 'analyze_frame_pacing' | 'nvenc_frame_pacing' | 'remux'

export interface TaskStats {
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
}

export type TaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused'

export type ProcessingStage = 'scene_detection' | 'video_splitting' | 'video_reencoding' | 'video_frame_pacing_analysis' | 'video_frame_pacing_repair' | 'video_remuxing' | 'video_merging' | 'subtitle_generation' | 'completed'

export interface TasksResponse {
  tasks: Task[]
  skip: number
  limit: number
  total: number
}

export interface GlobalPauseStatus {
  is_globally_paused: boolean
}

export interface DirectoryRequest {
  directory_path: string
}

export interface VideoRequest {
  video_path: string
}

export interface ReorderCustomRequest {
  task_ids: string[]
}

export interface AddTaskResponse {
  message: string
  tasks: Task[]
  duplicate?: boolean
  existing_status?: TaskStatus
}

export interface Stats {
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  cancelled: number
  paused: number
}

export interface TaskTypeStats {
  scene: number
  split: number
  subtitle: number
  all: number
  merge?: number
  analyze_frame_pacing?: number
  nvenc_frame_pacing?: number
  remux?: number
}

export interface ProcessingStats {
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  cancelled: number
  by_type: TaskTypeStats
  success_rate: number
  error_rate: number
  avg_elapsed_seconds: number | null
  min_elapsed_seconds: number | null
  max_elapsed_seconds: number | null
  total_scenes_generated: number
  total_splits_generated: number
}

export interface FileCoverageStats {
  total_files: number
  with_scenes: number
  with_split: number
  with_subtitle: number
  pct_with_scenes: number
  pct_with_split: number
  pct_with_subtitle: number
}

export interface StorageStats {
  total_bytes: number
  avg_bytes: number
  max_bytes: number
  zero_byte_files: number
  video_files: number
  by_format: Record<string, number>
  by_codec: Record<string, number>
  res_4k: number
  res_1080p: number
  res_720p: number
  res_sd: number
  known_duration_files: number
  missing_duration_files: number
  total_duration_seconds: number
  avg_duration_seconds: number | null
  min_duration_seconds: number | null
  max_duration_seconds: number | null
  avg_bitrate_mbps: number | null
}

export interface SceneStats {
  total_scenes: number
  avg_scenes_per_file: number
  avg_scene_duration_seconds: number
  min_scene_duration_seconds: number | null
  max_scene_duration_seconds: number | null
}

export interface DirectoryStat {
  name: string
  path: string
  file_count: number
}

export interface DirectoryStatInfo {
  total_directories: number
  top_directories: DirectoryStat[]
  total_monitors: number
  active_monitors: number
  monitors_by_schedule: Record<string, number>
}

export interface OverviewStats {
  processing: ProcessingStats
  coverage: FileCoverageStats
  storage: StorageStats
  scenes: SceneStats
  directories: DirectoryStatInfo
}

export interface MessageState {
  type: 'success' | 'error'
  text: string
}

export type Page = 'dashboard' | 'tasks' | 'scan' | 'stats'

export interface DirectoryMonitor {
  id: string
  directoryId: string
  directoryName: string
  directoryPath: string
  taskType: TaskType
  taskTypes: TaskType[]
  subtitleLanguage?: string
  schedule: {
    interval: 'hourly' | 'daily' | 'weekly'
    time?: string // HH:MM format for daily/weekly
    dayOfWeek?: number // 0-6 for weekly
    timeZone?: string
  }
  isActive: boolean
  deleteVideoAfterCompletion?: boolean
  fillMissingSubtitles?: boolean
  splitScope?: 'both' | 'uncensored' | 'censored'
  framePacingScope?: 'all' | 'split'
  framePacingResolution?: 'all' | 'sd' | '720p' | '1080p' | '1440p'
  framePacingResolutions?: Array<'sd' | '720p' | '1080p' | '1440p'>
  nvencOverwriteOriginal?: boolean
  lastRun?: Date
  nextRun?: Date
  createdAt: Date
}

export interface ActressDownloadMonitorCriteria {
  search: string
  sortBy: string
  sortDir: string
  fileExists?: boolean | null
  localFileState?: 'present' | 'deleted' | 'missing' | null
  uncensored?: boolean | null
  censored?: boolean | null
  subtitled?: boolean | null
  resolution?: 'sd' | '720p' | '1080p' | '1440p' | '4k' | null
  releaseYear?: number | null
}

export interface ActressDownloadMonitor {
  id: string
  actressId: number
  actressName: string
  schedule: {
    interval: 'hourly' | 'daily' | 'weekly'
    time?: string
    dayOfWeek?: number
  }
  isActive: boolean
  criteria: ActressDownloadMonitorCriteria
  maxItemsPerRun: number
  savePath?: string | null
  lastRun?: Date | null
  nextRun?: Date | null
  lastQueued: number
  lastSkipped: number
  lastError?: string | null
  createdAt: Date
}

export interface ScraperSource {
  id: string
  name: string
  url: string
  urls?: string[]
  urlActressNameReversed?: boolean[]
  schedule: {
    interval: 'hourly' | 'daily' | 'weekly'
    time?: string
    dayOfWeek?: number
    timeZone?: string
  }
  isActive: boolean
  lastRun?: Date | null
  nextRun?: Date | null
  lastFound: number
  lastNew: number
  lastPagesScraped: number
  lastWebsiteStats?: ScraperWebsiteStats[]
  lastError?: string | null
  createdAt: Date
}

export interface ScraperWebsiteStats {
  url: string
  pagesScraped: number
  found: number
  created: number
  updated: number
  blocked?: boolean
}

export interface ScrapedVideo {
  id: string
  sourceId: string
  videoCode: string
  title?: string | null
  url?: string | null
  uncensored?: boolean | null
  censored?: boolean | null
  subtitled?: boolean | null
  opened: boolean
  openedAt?: Date | null
  fileExists: boolean
  scrapedAt: Date
  firstSeenAt: Date
}

export interface ScrapedVideosResponse {
  items: ScrapedVideo[]
  total: number
  skip: number
  limit: number
}

export interface ScraperRunResponse {
  status: string
  found: number
  created: number
  updated: number
  pagesScraped: number
}

export interface Scene {
  id: string
  file_id: string
  scene_number: number
  start_frame: number
  end_frame: number
  start_timecode: string
  end_timecode: string
  start_seconds: number
  end_seconds: number
  duration_seconds: number
  created_at: string
}

export type FileQueryParams = {
  page: number
  limit: number
  search: string
  type?: string | null
  format?: string | null
  dateRange?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  directoryId?: string | null
  directoryExclude?: boolean
  sortBy: string
  sortDir: 'asc' | 'desc'
  hasScenes?: boolean
  hasSplit?: boolean
  hasSubtitle?: boolean
  hasNoScenes?: boolean
  hasNoSplit?: boolean
  hasNoSubtitle?: boolean
  sceneCount?: number | null
  status?: string | null
  queueDisabled?: boolean
  splitDisabled?: boolean
  subtitleDisabled?: boolean
  noNumberSuffix?: boolean
  newVideos?: boolean
  contentTag?: 'censored' | 'uncensored' | 'subtitled' | null
  resolution?: string | null
  fileSizeOperator?: string | null
  fileSizeBytes?: number | null
}

export interface DirectoryRecord {
  id: string
  name: string
  path: string
  parent_id: string | null
}

export interface AppSettings {
  // App Behavior
  default_task_type: 'scene' | 'split' | 'subtitle' | 'all' | 'merge' | 'analyze_frame_pacing' | 'nvenc_frame_pacing' | 'remux'
  default_subtitle_language: string
  default_layout: 'grid' | 'tree'
  show_stats_panel: boolean
  show_actress_work_covers: boolean
  show_actress_work_titles: boolean
  default_sort_field: string
  default_sort_direction: 'asc' | 'desc'
  monitor_sort_field: string
  monitor_sort_direction: 'asc' | 'desc'

  // File filtering
  ignore_patterns: string[]
  selected_scan_directories: string[]
  external_video_targets: ExternalVideoTarget[]
  scraper_templates: ScraperTemplate[]

  // Queue Priority
  task_type_priority: string[]

  // Processing
  scene_detector: 'content' | 'adaptive' | 'threshold'
  scene_content_threshold: number
  scene_adaptive_threshold: number
  scene_black_threshold: number
  scene_white_threshold: number
  min_scene_length_frames: number
  scene_detection_concurrency: number
  frame_pacing_analyzer_concurrency: number
  frame_pacing_analyzer_timeout_minutes: number
  split_min_video_duration_seconds: number
  split_gpu_required: boolean
  subtitle_gpu_required: boolean

  // Advanced
  task_poll_interval_ms: number
  auto_cleanup_on_scan: boolean
  scan_schedule_enabled: boolean
  scan_schedule_time: string | null
  scan_schedule_time_zone: string | null
  scan_schedule_mode: 'all' | 'selected'
  scan_schedule_last_run: string | null
  scan_schedule_next_run: string | null
  scan_schedule_last_error: string | null
  task_timeout_minutes: number
  task_stall_minutes: number
  scene_timeout_minutes: number | null
  split_timeout_minutes: number | null
  subtitle_timeout_minutes: number | null
  split_concurrency: number
  subtitle_concurrency: number
  processing_hours_enabled: boolean
  processing_hours_start: number // 0–23
  processing_hours_end: number // 0–23
  processing_hours_windows: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { start: number; end: number }>
  processing_mon: boolean
  processing_tue: boolean
  processing_wed: boolean
  processing_thu: boolean
  processing_fri: boolean
  processing_sat: boolean
  processing_sun: boolean

  // qBittorrent
  qbittorrent_url: string
  qbittorrent_username: string
  qbittorrent_password: string
  // Bulk Download Queue
  queue_base_delay_seconds: number
  queue_jitter_seconds: number
  queue_window_start_hour: number
  queue_window_end_hour: number
  queue_download_time_limit_minutes: number
  r18_auto_refresh_enabled: boolean
  r18_auto_refresh_time: string | null
  r18_auto_refresh_day_of_week: number | null
  r18_auto_refresh_last_run: string | null
  r18_auto_refresh_next_run: string | null
  r18_auto_refresh_last_error: string | null
}

export interface ExternalVideoTarget {
  label: string
  url_template: string
}

export interface ScraperTemplate {
  label: string
  url_template: string
}

export type NotificationType =
  | 'task_queued'
  | 'task_started'
  | 'stage_completed'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  | 'task_paused'
  | 'task_unpaused'
  | 'task_already_exists'
  | 'scan_started'
  | 'scan_completed'
  | 'files_found'
  | 'system_warning'
  | 'r18_import_started'
  | 'r18_download_started'
  | 'r18_download_completed'
  | 'r18_importing'
  | 'r18_import_completed'
  | 'r18_import_failed'
  | 'scraper_completed'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  message: string
  task_id: string | null
  file_id: string | null
  is_read: boolean
  created_at: string // ISO-8601
}

export interface NotificationsResponse {
  notifications: Notification[]
  total: number
  unread_count: number
  page: number
  limit: number
}

export interface LogEntry {
  id: number
  created_at: string
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
  logger_name: string
  module: string
  message: string
  task_id?: string | null
  exc_text?: string | null
}

export interface LogsResponse {
  items: LogEntry[]
  total: number
}

export interface LogQueryParams {
  level?: string
  task_id?: string
  search?: string
  skip?: number
  limit?: number
}

export type AppTab = 'files' | 'tasks' | 'monitors' | 'stats' | 'logs' | 'actresses' | 'scraper' | 'deleted-history' | 'tools'

export interface BookmarkVideoCheckItem {
    title: string
    url: string
    videoCode: string
    bookmarkPath?: string
    fileExists: boolean
    matchedFiles: File[]
  }

export interface BookmarkVideoCheckResponse {
  items: BookmarkVideoCheckItem[]
  total: number
  existing: number
}

export interface ActressSummary {
  id: number
  name_romaji?: string | null
  name_kanji?: string | null
  name_kana?: string | null
  image_url?: string | null
  display_name?: string | null
}

export interface ActressWork {
  content_id: string
  dvd_id?: string | null
  video_code?: string | null
  title_en?: string | null
  title_ja?: string | null
  release_date?: string | null
  image_url?: string | null
  file_exists?: boolean
  is_uncensored?: boolean
  is_subtitled?: boolean
  resolution?: 'sd' | '720p' | '1080p' | '1440p' | '4k' | null
  local_file_state?: 'present' | 'deleted' | null
  is_opened?: boolean
}

export interface ActressDetail extends ActressSummary {
  work_count: number
  recent_works: ActressWork[]
}

export interface ActressesResponse {
  items: ActressSummary[]
  total: number
}

export interface ActressWorksResponse {
  items: ActressWork[]
  total: number
}

export interface R18ImportResult {
  actress_count: number
  duration_seconds: number
  imported_at: string
  filename: string
}

export interface R18ImportStatus {
  state: string
  phase?: 'downloading' | 'importing' | null
  download_bytes?: number | null
  download_total?: number | null
  error?: string | null
  started_at?: string | null
  finished_at?: string | null
}

export interface R18Status {
  loaded: boolean
  actress_count: number
  imported_at?: string | null
  import_in_progress: boolean
  import_state: string
  import_phase?: 'downloading' | 'importing' | null
  download_bytes?: number | null
  download_total?: number | null
  import_error?: string | null
}

export interface NyaaResult {
  title: string
  torrent_url: string
  magnet_url?: string | null
  seeders: number
  size: string
  was_tried?: boolean
}

export interface ActressMagnetExportResponse {
  actress_name: string
  queries: string[]
  magnets: string[]
}

export interface DownloadQueueItem {
  id: number
  content_id: string
  video_code: string
  status: 'pending' | 'processing' | 'done' | 'failed' | 'skipped'
  error: string | null
  torrent_url: string | null
  save_path?: string | null
  added_at: string
  processed_at: string | null
  position: number
}

export interface TorrentStatus {
  content_id: string
  video_code: string
  torrent_hash: string | null
  torrent_name: string
  status: 'downloading' | 'completed' | 'error'
  progress: number
  speed: number
  eta: number
  added_at: string
  completed_at: string | null
  seeders?: number | null
  created_at?: number | null
  size?: number | null
  total_size?: number | null
  save_path?: string | null
  state?: string | null
}
