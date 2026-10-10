import type { LogEntry, LogsResponse, LogQueryParams } from '@/types/types'

import { API_BASE } from '@/api/client'

export const logApi = {
  async getLogs(params: LogQueryParams = {}): Promise<LogsResponse> {
    const query = new URLSearchParams()
    if (params.level) query.set('level', params.level)
    if (params.task_id != null) query.set('task_id', String(params.task_id))
    if (params.search) query.set('search', params.search)
    if (params.skip != null) query.set('skip', String(params.skip))
    if (params.limit != null) query.set('limit', String(params.limit))

    const res = await fetch(`${API_BASE}/logs?${query}`)
    if (!res.ok) throw new Error('Failed to fetch logs')
    return res.json()
  },

  createLogStream(): EventSource {
    return new EventSource(`${API_BASE}/logs/stream`)
  },
}
