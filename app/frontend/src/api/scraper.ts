import { ScrapedVideo, ScrapedVideosResponse, ScraperRunResponse, ScraperSource } from '@/types/types'

import { API_BASE } from '@/api/client'

export interface ScraperVideoFilters {
  fileExists?: boolean | null
  localMatchTraits?: boolean | null
  localMatchResolution?: string | null
  uncensored?: boolean | null
  censored?: boolean | null
  subtitled?: boolean | null
  opened?: boolean | null
  website?: string[] | null
}

export type ScraperVideoSortBy = 'scraped_at' | 'first_seen_at' | 'video_code' | 'title'
export type ScraperVideoSortDir = 'asc' | 'desc'

function toUtcDate(value: string): Date {
  return new Date(value.endsWith('Z') ? value : `${value}Z`)
}

function parseSource(source: ScraperSource): ScraperSource {
  return {
    ...source,
    createdAt: toUtcDate(source.createdAt as unknown as string),
    lastRun: source.lastRun ? toUtcDate(source.lastRun as unknown as string) : null,
    nextRun: source.nextRun ? toUtcDate(source.nextRun as unknown as string) : null,
  }
}

function parseVideo(video: ScrapedVideo): ScrapedVideo {
  return {
    ...video,
    openedAt: video.openedAt ? toUtcDate(video.openedAt as unknown as string) : null,
    scrapedAt: toUtcDate(video.scrapedAt as unknown as string),
    firstSeenAt: toUtcDate(video.firstSeenAt as unknown as string),
  }
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const error = await res.json().catch(() => ({}))
  return new Error(typeof error.detail === 'string' ? error.detail : fallback)
}

export const scraperApi = {
  async getSources(): Promise<ScraperSource[]> {
    const res = await fetch(`${API_BASE}/scraper/sources`)
    if (!res.ok) throw await readError(res, 'Failed to load scraper sources')
    const data: ScraperSource[] = await res.json()
    return data.map(parseSource)
  },

  async createSource(source: ScraperSource): Promise<ScraperSource> {
    const res = await fetch(`${API_BASE}/scraper/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source),
    })
    if (!res.ok) throw await readError(res, 'Failed to create scraper source')
    return parseSource(await res.json())
  },

  async updateSource(source: ScraperSource): Promise<ScraperSource> {
    const res = await fetch(`${API_BASE}/scraper/sources/${encodeURIComponent(source.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(source),
    })
    if (!res.ok) throw await readError(res, 'Failed to update scraper source')
    return parseSource(await res.json())
  },

  async deleteSource(sourceId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/scraper/sources/${encodeURIComponent(sourceId)}`, { method: 'DELETE' })
    if (!res.ok) throw await readError(res, 'Failed to delete scraper source')
  },

  async runSource({ sourceId, urls }: { sourceId: string; urls?: string[] }): Promise<ScraperRunResponse> {
    const res = await fetch(`${API_BASE}/scraper/sources/${encodeURIComponent(sourceId)}/run`, {
      method: 'POST',
      headers: urls ? { 'Content-Type': 'application/json' } : undefined,
      body: urls ? JSON.stringify({ urls }) : undefined,
    })
    if (!res.ok) throw await readError(res, 'Failed to run scraper source')
    return res.json()
  },

  async getSourceProgress(): Promise<Array<{
    sourceId: string
    sourceName: string
    sourceUrl: string
    currentUrl: string
    pagesScraped: number
    totalPages: number
    progress: number
  }>> {
    const res = await fetch(`${API_BASE}/scraper/sources/progress`)
    if (!res.ok) throw await readError(res, 'Failed to load scraper progress')
    return res.json()
  },

  async cancelSourceRun(sourceId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/scraper/sources/${encodeURIComponent(sourceId)}/cancel`, {
      method: 'POST',
    })
    if (!res.ok) throw await readError(res, 'Failed to cancel scraper source')
  },

  async getVideos(
    sourceId?: string,
    search?: string,
    page = 1,
    pageSize = 25,
    fallbackTotal?: number,
    filters: ScraperVideoFilters = {},
    sortBy: ScraperVideoSortBy = 'scraped_at',
    sortDir: ScraperVideoSortDir = 'desc'
  ): Promise<ScrapedVideosResponse> {
    const params = new URLSearchParams({
      skip: String((page - 1) * pageSize),
      limit: String(pageSize),
    })
    params.set('sort_by', sortBy)
    params.set('sort_dir', sortDir)
    if (sourceId) params.set('source_id', sourceId)
    if (search) params.set('search', search)
    if (filters.fileExists !== null && filters.fileExists !== undefined) params.set('file_exists', String(filters.fileExists))
    if (filters.localMatchTraits !== null && filters.localMatchTraits !== undefined) params.set('local_match_traits', String(filters.localMatchTraits))
    if (filters.localMatchResolution !== null && filters.localMatchResolution !== undefined) params.set('local_match_resolution', String(filters.localMatchResolution))
    if (filters.uncensored !== null && filters.uncensored !== undefined) params.set('uncensored', String(filters.uncensored))
    if (filters.censored !== null && filters.censored !== undefined) params.set('censored', String(filters.censored))
    if (filters.subtitled !== null && filters.subtitled !== undefined) params.set('subtitled', String(filters.subtitled))
    if (filters.opened !== null && filters.opened !== undefined) params.set('opened', String(filters.opened))
    if (filters.website?.length) {
      for (const website of filters.website) {
        params.append('website', website)
      }
    }
    const res = await fetch(`${API_BASE}/scraper/videos?${params}`)
    if (!res.ok) throw await readError(res, 'Failed to load scraped videos')
    const data: ScrapedVideosResponse | ScrapedVideo[] = await res.json()
    if (Array.isArray(data)) {
      const inferredTotal = fallbackTotal && fallbackTotal > data.length
        ? fallbackTotal
        : ((page - 1) * pageSize) + data.length
      return {
        items: data.map(parseVideo),
        total: inferredTotal,
        skip: (page - 1) * pageSize,
        limit: pageSize,
      }
    }
    return { ...data, items: data.items.map(parseVideo) }
  },

  async markVideosOpened(ids: string[]): Promise<{ updated: number }> {
    const res = await fetch(`${API_BASE}/scraper/videos/opened`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    if (!res.ok) throw await readError(res, 'Failed to mark scraper videos opened')
    return res.json()
  },
}
