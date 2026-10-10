import { beforeEach, describe, expect, it, vi } from 'vitest'

import { settingsApi } from './settings'

describe('settingsApi R18 auto refresh fields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('returns R18 auto refresh fields from getSettings', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        r18_auto_refresh_enabled: true,
        r18_auto_refresh_time: '09:00',
        r18_auto_refresh_day_of_week: 1,
        r18_auto_refresh_last_run: '2026-07-07T16:00:00Z',
        r18_auto_refresh_next_run: '2026-07-14T16:00:00Z',
        r18_auto_refresh_last_error: null,
      }),
    })

    const result = await settingsApi.getSettings()

    expect(result.r18_auto_refresh_enabled).toBe(true)
    expect(result.r18_auto_refresh_time).toBe('09:00')
    expect(result.r18_auto_refresh_day_of_week).toBe(1)
    expect(result.r18_auto_refresh_last_run).toBe('2026-07-07T16:00:00Z')
    expect(result.r18_auto_refresh_next_run).toBe('2026-07-14T16:00:00Z')
    expect(result.r18_auto_refresh_last_error).toBeNull()
  })

  it('sends R18 auto refresh fields through patchSettings', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        r18_auto_refresh_enabled: true,
        r18_auto_refresh_time: '09:00',
        r18_auto_refresh_day_of_week: 1,
        r18_auto_refresh_last_run: null,
        r18_auto_refresh_next_run: '2026-07-14T16:00:00Z',
        r18_auto_refresh_last_error: null,
      }),
    })

    await settingsApi.patchSettings({
      r18_auto_refresh_enabled: true,
      r18_auto_refresh_time: '09:00',
      r18_auto_refresh_day_of_week: 1,
      r18_auto_refresh_next_run: '2026-07-14T16:00:00Z',
    })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/settings'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          r18_auto_refresh_enabled: true,
          r18_auto_refresh_time: '09:00',
          r18_auto_refresh_day_of_week: 1,
          r18_auto_refresh_next_run: '2026-07-14T16:00:00Z',
        }),
      }),
    )
  })
})
