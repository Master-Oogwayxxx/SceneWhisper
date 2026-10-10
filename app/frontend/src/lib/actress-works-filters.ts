import type { ActressWork, DownloadQueueItem, TorrentStatus } from '@/types/types'

export type ActressWorkTorrentStatusFilter =
  | 'queued'
  | 'downloading'
  | 'stalled'
  | 'completed'
  | 'failed'
  | 'skipped'

export type ActressWorkLocalFileStatusFilter =
  | 'present'
  | 'deleted'
  | 'missing'

export type ActressWorkResolutionFilter =
  | 'sd'
  | '720p'
  | '1080p'
  | '1440p'
  | '4k'

export interface ActressWorksFilterState {
  fileExists: boolean | null // null = no filter; true = local file found; false = not found
  localFileStatus: ActressWorkLocalFileStatusFilter | null
  uncensored: boolean | null
  censored: boolean | null
  subtitled: boolean | null
  resolution: ActressWorkResolutionFilter | null
  opened: boolean | null     // null = no filter; true = opened; false = not opened
  releaseYear: number | null // null = no filter; 4-digit year otherwise
  torrentStatus: ActressWorkTorrentStatusFilter | null
}

export const EMPTY_ACTRESS_WORKS_FILTER_STATE: ActressWorksFilterState = {
  fileExists: null,
  localFileStatus: null,
  uncensored: null,
  censored: null,
  subtitled: null,
  resolution: null,
  opened: null,
  releaseYear: null,
  torrentStatus: null,
}

export function isActressWorksFilterActive(f: ActressWorksFilterState): boolean {
  return f.fileExists !== null || f.localFileStatus !== null || f.uncensored !== null || f.censored !== null || f.subtitled !== null || f.resolution !== null || f.opened !== null || f.releaseYear !== null || f.torrentStatus !== null
}

const QBIT_QUEUED_STATES = new Set([
  'queuedDL',
  'metaDL',
  'checkingDL',
  'checkingResumeData',
  'pausedDL',
  'stoppedDL',
])

export function matchesActressWorkTorrentStatusFilter(
  filter: ActressWorkTorrentStatusFilter | null,
  queueItem?: DownloadQueueItem,
  downloadStatus?: TorrentStatus,
): boolean {
  if (filter === null) return true
  if (filter === 'failed') return queueItem?.status === 'failed'
  if (filter === 'skipped') return queueItem?.status === 'skipped'
  if (filter === 'completed') return downloadStatus?.status === 'completed'
  if (filter === 'stalled') return downloadStatus?.state === 'stalledDL'
  if (filter === 'queued') {
    return Boolean(
      (queueItem && (queueItem.status === 'pending' || queueItem.status === 'processing')) ||
      (downloadStatus?.status === 'downloading' && (
        !downloadStatus.torrent_hash ||
        !downloadStatus.state ||
        QBIT_QUEUED_STATES.has(downloadStatus.state)
      ))
    )
  }
  if (filter === 'downloading') {
    return downloadStatus?.status === 'downloading' &&
      downloadStatus.state !== 'stalledDL' &&
      !(!downloadStatus.torrent_hash || !downloadStatus.state || QBIT_QUEUED_STATES.has(downloadStatus.state))
  }
  return false
}

export function filterActressWorksByTorrentStatus(
  works: ActressWork[],
  filter: ActressWorkTorrentStatusFilter | null,
  queueItems: DownloadQueueItem[],
  downloads: Map<string, TorrentStatus>,
): ActressWork[] {
  if (filter === null) return works

  const queueMap = new Map(queueItems.map((item) => [item.content_id, item]))
  return works.filter((work) => (
    matchesActressWorkTorrentStatusFilter(
      filter,
      queueMap.get(work.content_id),
      downloads.get(work.content_id),
    )
  ))
}

export function filterActressWorksByOpenedState(
  works: ActressWork[],
  filter: boolean | null,
): ActressWork[] {
  if (filter === null) return works
  return works.filter((work) => Boolean(work.is_opened) === filter)
}
