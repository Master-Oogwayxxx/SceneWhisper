export type FileStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'unprocessed'
export type FileType = 'video' | 'subtitle' | 'other'
export type FileFormat = 'mp4' | 'mov' | 'avi' | 'mkv' | 'wmv' | 'flv' | 'webm' | 'mp3' | 'wav' | 'aac' | 'srt'
export type DateRange = 'today' | 'last_7_days' | 'last_30_days' | 'last_year'
export type FileResolution = '480p' | '720p' | '1080p' | '1440p' | '4k'
export type FileSizeOperator = 'gte' | 'lte' | 'eq'
export type FileContentTag = 'censored' | 'uncensored' | 'subtitled'

/** Snapshot of all filter-dialog fields for draft/applied state and presets. */
export interface FileFilterState {
  type: FileType[]
  format: FileFormat[]
  dateRange: DateRange[]
  hasScenes: boolean
  hasSplit: boolean
  hasSubtitle: boolean
  hasNoScenes: boolean
  hasNoSplit: boolean
  hasNoSubtitle: boolean
  statusFilter: FileStatus[]
  queueDisabled: boolean
  queueDisabledNo: boolean
  splitDisabled: boolean
  splitDisabledNo: boolean
  subtitleDisabled: boolean
  subtitleDisabledNo: boolean
  noNumberSuffix: boolean
  newVideos: boolean
  contentTag: FileContentTag | null
  resolutionFilter: FileResolution[]
  fileSizeOperator: FileSizeOperator
  fileSizeValue: number | null
  selectedDirectoryIds: string[]
  directoryExclude: boolean
  /** Legacy saved presets used a single directory id. */
  selectedDirectoryId?: string | null
  isGroupedView: boolean
}

export interface SavedFileFilter {
  id: string
  name: string
  created_at: string
  filters: FileFilterState
  isDefault: boolean
}

export const EMPTY_FILE_FILTER_STATE: FileFilterState = {
  type: [],
  format: [],
  dateRange: [],
  hasScenes: false,
  hasSplit: false,
  hasSubtitle: false,
  hasNoScenes: false,
  hasNoSplit: false,
  hasNoSubtitle: false,
  statusFilter: [],
  queueDisabled: false,
  queueDisabledNo: false,
  splitDisabled: false,
  splitDisabledNo: false,
  subtitleDisabled: false,
  subtitleDisabledNo: false,
  noNumberSuffix: false,
  newVideos: false,
  contentTag: null,
  resolutionFilter: [],
  fileSizeOperator: 'gte',
  fileSizeValue: null,
  selectedDirectoryIds: [],
  directoryExclude: false,
  isGroupedView: false,
}

/**
 * Returns whether any filter-dialog criteria are active.
 * @param filters - Draft or applied filter state
 */
export function isFileFilterActive(filters: FileFilterState): boolean {
  return (
    filters.type.length > 0 ||
    filters.format.length > 0 ||
    filters.dateRange.length > 0 ||
  filters.hasScenes ||
  filters.hasSplit ||
  filters.hasSubtitle ||
  filters.hasNoScenes ||
  filters.hasNoSplit ||
  filters.hasNoSubtitle ||
  filters.statusFilter.length > 0 ||
    filters.queueDisabled ||
    filters.queueDisabledNo ||
    filters.splitDisabled ||
    filters.splitDisabledNo ||
    filters.subtitleDisabled ||
    filters.subtitleDisabledNo ||
    filters.noNumberSuffix ||
    filters.newVideos ||
    filters.contentTag !== null ||
    filters.resolutionFilter.length > 0 ||
    filters.fileSizeValue !== null ||
    filters.selectedDirectoryIds.length > 0
  )
}

/**
 * Build filter state from draft fields without directory/grouped (for applied-only checks).
 * @param filters - Core filter fields
 */
export function fileFilterCoreActive(filters: Omit<FileFilterState, 'selectedDirectoryIds' | 'selectedDirectoryId' | 'directoryExclude' | 'isGroupedView'>): boolean {
  return isFileFilterActive({ ...filters, selectedDirectoryIds: [], directoryExclude: false, isGroupedView: false })
}
