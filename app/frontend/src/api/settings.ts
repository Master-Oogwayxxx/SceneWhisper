import { AppSettings } from '@/types/types'

import { API_BASE } from '@/api/client'

export const settingsApi = {
  async getSettings(): Promise<AppSettings> {
    const res = await fetch(`${API_BASE}/settings`)
    if (!res.ok) throw new Error('Failed to fetch settings')
    return res.json()
  },

  async patchSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error('Failed to update settings')
    return res.json()
  },

  async clearTorrentDatabase(): Promise<{ deleted: number; message: string }> {
    const res = await fetch(`${API_BASE}/settings/torrent-db`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const error = await res.json().catch(() => null)
      throw new Error(error?.detail || 'Failed to clear torrent database')
    }
    return res.json()
  },
}
