import { OverviewStats, Stats, DirectoryMonitor } from '@/types/types'

import { API_BASE } from '@/api/client'

export const statsApi = {
  async getStats(): Promise<Stats> {
    const res = await fetch(`${API_BASE}/stats`)
    return res.json()
  },

  async getOverviewStats(): Promise<OverviewStats> {
    const res = await fetch(`${API_BASE}/stats/overview`)
    if (!res.ok) throw new Error('Failed to fetch overview stats')
    return res.json()
  },
}
