import { FileFilterState, SavedFileFilter } from '@/lib/file-filters'

import { API_BASE } from '@/api/client'

async function parseError(res: Response, fallback: string): Promise<never> {
  let detail = fallback
  try {
    const body = await res.json()
    if (typeof body.detail === 'string') detail = body.detail
  } catch {
    // ignore parse errors
  }
  throw new Error(detail)
}

export const fileFiltersApi = {
  /** Fetch all saved file filter presets. */
  async list(): Promise<SavedFileFilter[]> {
    const res = await fetch(`${API_BASE}/settings/file-filters`)
    if (!res.ok) throw new Error('Failed to fetch saved filters')
    return res.json()
  },

  /** Create a new saved filter preset. */
  async create(name: string, filters: FileFilterState): Promise<SavedFileFilter> {
    const res = await fetch(`${API_BASE}/settings/file-filters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, filters }),
    })
    if (!res.ok) await parseError(res, 'Failed to save filter')
    return res.json()
  },

  /** Update an existing saved filter preset. */
  async update(id: string, updates: { name?: string; filters?: FileFilterState; isDefault?: boolean }): Promise<SavedFileFilter> {
    const res = await fetch(`${API_BASE}/settings/file-filters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) await parseError(res, 'Failed to update saved filter')
    return res.json()
  },

  /** Delete a saved filter preset by id. */
  async remove(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/settings/file-filters/${id}`, { method: 'DELETE' })
    if (!res.ok) await parseError(res, 'Failed to delete saved filter')
  },
}
