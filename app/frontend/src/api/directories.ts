import { Directory, DirectoryMonitor, File } from '@/types/types'

import { API_BASE } from '@/api/client'

function toUtcDate(s: string): Date {
  return new Date(s.endsWith('Z') ? s : s + 'Z')
}

function parseDirectoryMonitor(data: DirectoryMonitor): DirectoryMonitor {
  const rawTaskTypes = data.taskTypes?.length ? data.taskTypes : [data.taskType]
  const taskTypes = rawTaskTypes.flatMap((type) => (type === 'all' ? ['split', 'subtitle'] as const : [type]))
  const framePacingResolutions = data.framePacingResolutions?.length
    ? data.framePacingResolutions
    : data.framePacingResolution && data.framePacingResolution !== 'all'
      ? [data.framePacingResolution]
      : []
  return {
    ...data,
    taskType: taskTypes[0],
    taskTypes,
    framePacingScope: data.framePacingScope ?? 'all',
    framePacingResolution: data.framePacingResolution ?? 'all',
    framePacingResolutions,
    createdAt: toUtcDate(data.createdAt as unknown as string),
    lastRun: data.lastRun ? toUtcDate(data.lastRun as unknown as string) : undefined,
    nextRun: data.nextRun ? toUtcDate(data.nextRun as unknown as string) : undefined,
  }
}

export const directoryApi = {
  async createDirectoryMonitor(monitor: DirectoryMonitor): Promise<DirectoryMonitor> {
    const res = await fetch(`${API_BASE}/directory-monitors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(monitor),
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(typeof error.detail === 'string' ? error.detail : 'Failed to save directory monitor')
    }

    const data: DirectoryMonitor = await res.json()
    return parseDirectoryMonitor(data)
  },

  async updateDirectoryMonitor(monitor: DirectoryMonitor): Promise<DirectoryMonitor> {
    const res = await fetch(`${API_BASE}/directory-monitors/${encodeURIComponent(monitor.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(monitor),
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(typeof error.detail === 'string' ? error.detail : 'Failed to update directory monitor')
    }

    const data: DirectoryMonitor = await res.json()
    return parseDirectoryMonitor(data)
  },

  async deleteDirectoryMonitor(monitorId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/directory-monitors/${encodeURIComponent(monitorId)}`, {
      method: 'DELETE',
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(typeof error.detail === 'string' ? error.detail : 'Failed to delete directory monitor')
    }
  },

  async runMonitorNow(monitorId: string, timeoutMs = 60_000): Promise<{ queued: number; skipped: number }> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(`${API_BASE}/directory-monitors/${encodeURIComponent(monitorId)}/run`, {
        method: 'POST',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(typeof error.detail === 'string' ? error.detail : 'Failed to run monitor')
    }

    const data = await res.json()
    return { queued: data.queued ?? 0, skipped: data.skipped ?? 0 }
  },

  async getDirectoryMonitors(): Promise<DirectoryMonitor[]> {
    const res = await fetch(`${API_BASE}/directory-monitors`)

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(typeof error.detail === 'string' ? error.detail : 'Failed to load directory monitors')
    }

    const data: DirectoryMonitor[] = await res.json()
    return data.map(parseDirectoryMonitor)
  },

  async scanAllDirectories(): Promise<Directory[]> {
    const res = await fetch(`${API_BASE}/directory/scan_all`)

    if (!res.ok) {
      const error = await res.json()
      throw new Error(error.detail || 'Failed to scan all folders')
    }

    return res.json()
  },

  async getDirectoryTree(path: string): Promise<Directory> {
    const res = await fetch(`${API_BASE}/directory/tree?path=${encodeURIComponent(path)}`)

    if (!res.ok) {
      const error = await res.json()
      throw new Error(error.detail || 'Failed to get files in directory')
    }

    return res.json()
  },

  async getDirectoryFiles(path: string): Promise<File[]> {
    const res = await fetch(`${API_BASE}/directory/files?path=${encodeURIComponent(path)}`)

    if (!res.ok) {
      const error = await res.json()
      throw new Error(error.detail || 'Failed to get files in directory')
    }

    return res.json()
  },

  async getDirectoryInfo(directoryId: string): Promise<Directory> {
    const res = await fetch(`${API_BASE}/directory/info/${encodeURIComponent(directoryId)}`)

    if (!res.ok) {
      const error = await res.json()
      throw new Error(error.detail || 'Failed to get directory info')
    }

    return res.json()
  },

  async deleteDirectory(directoryId: string, options?: { deleteFromDisk?: boolean; deleteFromDatabase?: boolean }): Promise<void> {
    const params = new URLSearchParams({
      delete_from_disk: String(options?.deleteFromDisk ?? true),
      delete_from_database: String(options?.deleteFromDatabase ?? true),
    })
    const res = await fetch(`${API_BASE}/directory/delete/${encodeURIComponent(directoryId)}?${params.toString()}`, {
      method: 'DELETE',
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(typeof error.detail === 'string' ? error.detail : 'Failed to delete directory')
    }
  },

  async renameDirectory(directoryId: string, newName: string): Promise<void> {
    const res = await fetch(`${API_BASE}/directory/${encodeURIComponent(directoryId)}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newName }),
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(typeof error.detail === 'string' ? error.detail : 'Failed to rename directory')
    }
  },

  async moveDirectory(directoryId: string, destinationDirectoryId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/directory/${encodeURIComponent(directoryId)}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_directory_id: destinationDirectoryId }),
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({}))
      throw new Error(typeof error.detail === 'string' ? error.detail : 'Failed to move directory')
    }
  },
}

export interface TopLevelDirectory {
  name: string
  path: string
}

export const getTopLevelDirectories = async (): Promise<TopLevelDirectory[]> => {
  const res = await fetch(`${API_BASE}/directory/top_level`)
  if (!res.ok) throw new Error('Failed to fetch top-level directories')
  return res.json()
}
