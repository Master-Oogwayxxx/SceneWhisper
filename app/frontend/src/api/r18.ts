import {
  ActressDetail,
  ActressDownloadMonitor,
  ActressMagnetExportResponse,
  ActressesResponse,
  ActressWorksResponse,
  DownloadQueueItem,
  NyaaResult,
  R18ImportStatus,
  R18Status,
  TorrentStatus,
} from '@/types/types'

import { API_BASE } from '@/api/client'

function toUtcDate(s: string): Date {
  return new Date(s.endsWith('Z') ? s : `${s}Z`)
}

function parseActressDownloadMonitor(data: ActressDownloadMonitor): ActressDownloadMonitor {
  return {
    ...data,
    createdAt: toUtcDate(data.createdAt as unknown as string),
    lastRun: data.lastRun ? toUtcDate(data.lastRun as unknown as string) : null,
    nextRun: data.nextRun ? toUtcDate(data.nextRun as unknown as string) : null,
  }
}

export const r18Api = {
  async getStatus(): Promise<R18Status> {
    const res = await fetch(`${API_BASE}/r18/status`)
    if (!res.ok) throw new Error('Failed to fetch R18 status')
    return res.json()
  },

  async getImportStatus(): Promise<R18ImportStatus> {
    const res = await fetch(`${API_BASE}/r18/import/status`)
    if (!res.ok) throw new Error('Failed to fetch import status')
    return res.json()
  },

  async searchActresses(q: string, skip = 0, limit = 50): Promise<ActressesResponse> {
    const params = new URLSearchParams({ q, skip: String(skip), limit: String(limit) })
    const res = await fetch(`${API_BASE}/r18/actresses?${params}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? 'Failed to search actresses')
    }
    return res.json()
  },

  async getActress(id: number): Promise<ActressDetail> {
    const res = await fetch(`${API_BASE}/r18/actresses/${id}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? 'Failed to fetch actress')
    }
    return res.json()
  },

  async getActressWorks(
    id: number,
    skip = 0,
    limit = 48,
    sortBy = 'date',
    sortDir = 'desc',
    search = '',
    filters: { fileExists?: boolean | null; localFileStatus?: string | null; uncensored?: boolean | null; censored?: boolean | null; subtitled?: boolean | null; resolution?: string | null; opened?: boolean | null; releaseYear?: number | null; torrentStatus?: string | null } = {}
  ): Promise<ActressWorksResponse> {
    const params = new URLSearchParams({
      skip: String(skip),
      limit: String(limit),
      sort_by: sortBy,
      sort_dir: sortDir,
    })
    if (search) params.set('search', search)
    if (filters.fileExists !== null && filters.fileExists !== undefined) params.set('file_exists', String(filters.fileExists))
    if (filters.localFileStatus !== null && filters.localFileStatus !== undefined) params.set('local_file_state', filters.localFileStatus)
    if (filters.uncensored !== null && filters.uncensored !== undefined) params.set('uncensored', String(filters.uncensored))
    if (filters.censored !== null && filters.censored !== undefined) params.set('censored', String(filters.censored))
    if (filters.subtitled !== null && filters.subtitled !== undefined) params.set('subtitled', String(filters.subtitled))
    if (filters.resolution !== null && filters.resolution !== undefined) params.set('resolution', filters.resolution)
    if (filters.opened !== null && filters.opened !== undefined) params.set('opened', String(filters.opened))
    if (filters.releaseYear !== null && filters.releaseYear !== undefined) params.set('release_year', String(filters.releaseYear))
    if (filters.torrentStatus !== null && filters.torrentStatus !== undefined) params.set('torrent_status', filters.torrentStatus)
    const res = await fetch(`${API_BASE}/r18/actresses/${id}/works?${params}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? 'Failed to fetch actress works')
    }
    return res.json()
  },

  async importDatabase(file: File): Promise<R18ImportStatus> {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${API_BASE}/r18/import`, { method: 'POST', body: form })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? 'Import failed')
    }
    return res.json()
  },

  async translate(text: string): Promise<string> {
    const params = new URLSearchParams({ text })
    const res = await fetch(`${API_BASE}/r18/translate?${params}`)
    if (!res.ok) throw new Error('Translation failed')
    const data = await res.json()
    return data.translated as string
  },

  async importFromUrl(url = 'https://r18.dev/dumps/latest'): Promise<R18ImportStatus> {
    const res = await fetch(`${API_BASE}/r18/import-from-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? 'Import from URL failed')
    }
    return res.json()
  },

  async getNyaaResults(formattedId: string, contentId?: string): Promise<NyaaResult[]> {
    const params = new URLSearchParams()
    if (contentId) params.set('content_id', contentId)
    const suffix = params.toString() ? `?${params}` : ''
    const res = await fetch(`${API_BASE}/r18/nyaa/${encodeURIComponent(formattedId)}${suffix}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? 'Failed to fetch nyaa results')
    }
    return res.json()
  },

  async getNyaaMagnet(torrentUrl: string, title?: string): Promise<{ magnet_url: string }> {
    const params = new URLSearchParams({ torrent_url: torrentUrl })
    if (title) params.set('title', title)
    const res = await fetch(`${API_BASE}/r18/nyaa/magnet?${params}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? 'Failed to resolve magnet link')
    }
    return res.json()
  },

  async exportActressMagnets(actressId: number): Promise<ActressMagnetExportResponse> {
    const res = await fetch(`${API_BASE}/r18/actresses/${actressId}/magnet-export`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? 'Failed to export actress magnets')
    }
    return res.json()
  },

  async sendToQbittorrent(
    torrentUrl: string,
    videoCode: string,
    contentId: string,
    options?: { category?: string; tags?: string[]; savePath?: string }
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/r18/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        torrent_url: torrentUrl,
        video_code: videoCode,
        content_id: contentId,
        category: options?.category,
        tags: options?.tags,
        save_path: options?.savePath,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? 'Failed to send to qBittorrent')
    }
  },

  async getDownloads(): Promise<TorrentStatus[]> {
    const res = await fetch(`${API_BASE}/r18/downloads`)
    if (!res.ok) throw new Error('Failed to fetch downloads')
    return res.json()
  },

  async markActressWorkOpened(contentId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/r18/works/opened`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_id: contentId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? 'Failed to save actress work state')
    }
  },

  async markActressWorksOpened(contentIds: string[]): Promise<void> {
    const res = await fetch(`${API_BASE}/r18/works/opened/bulk`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_ids: contentIds }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? 'Failed to save actress work states')
    }
  },

  async enqueueWorks(
    items: { content_id: string; video_code: string }[],
    savePath?: string
  ): Promise<{ queued: number; skipped: number }> {
    const res = await fetch(`${API_BASE}/r18/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items,
        save_path: savePath,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail ?? 'Failed to enqueue works')
    }
    return res.json()
  },

  async getQueue(): Promise<DownloadQueueItem[]> {
    const res = await fetch(`${API_BASE}/r18/queue`)
    if (!res.ok) throw new Error('Failed to fetch download queue')
    return res.json()
  },

  async clearDoneQueue(includeFailed = false): Promise<{ removed: number }> {
    const params = includeFailed ? '?include_failed=true' : ''
    const res = await fetch(`${API_BASE}/r18/queue/done${params}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to clear done queue items')
    return res.json()
  },

  async clearFailedQueue(): Promise<{ removed: number }> {
    const res = await fetch(`${API_BASE}/r18/queue/failed`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to clear failed queue items')
    return res.json()
  },

  async retryQueueItem(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/r18/queue/${id}/retry`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? 'Failed to retry queue item')
    }
  },

  async deleteQueueItem(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/r18/queue/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? 'Failed to delete queue item')
    }
  },

  async cancelDownload(contentId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/r18/downloads/${encodeURIComponent(contentId)}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? 'Failed to cancel download')
    }
  },

  async getActressDownloadMonitors(): Promise<ActressDownloadMonitor[]> {
    const res = await fetch(`${API_BASE}/r18/actress-download-monitors`)
    if (!res.ok) throw new Error('Failed to load actress download monitors')
    const data: ActressDownloadMonitor[] = await res.json()
    return data.map(parseActressDownloadMonitor)
  },

  async createActressDownloadMonitor(monitor: ActressDownloadMonitor): Promise<ActressDownloadMonitor> {
    const res = await fetch(`${API_BASE}/r18/actress-download-monitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(monitor),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? 'Failed to create actress schedule')
    }
    return parseActressDownloadMonitor(await res.json())
  },

  async updateActressDownloadMonitor(monitor: ActressDownloadMonitor): Promise<ActressDownloadMonitor> {
    const res = await fetch(`${API_BASE}/r18/actress-download-monitors/${encodeURIComponent(monitor.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(monitor),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? 'Failed to update actress schedule')
    }
    return parseActressDownloadMonitor(await res.json())
  },

  async deleteActressDownloadMonitor(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/r18/actress-download-monitors/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? 'Failed to delete actress schedule')
    }
  },

  async runActressDownloadMonitor(id: string): Promise<{ queued: number; skipped: number }> {
    const res = await fetch(`${API_BASE}/r18/actress-download-monitors/${encodeURIComponent(id)}/run`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? 'Failed to run actress schedule')
    }
    const data = await res.json()
    return { queued: data.queued ?? 0, skipped: data.skipped ?? 0 }
  },
}
