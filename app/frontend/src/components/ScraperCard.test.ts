import { describe, expect, it } from 'vitest'

import { buildScraperStatsByUrl, getScraperTotals, getScraperWebsiteStat, normalizeScraperUrl } from './ScraperCard'
import { ScraperSource } from '@/types/types'

describe('ScraperCard stats helpers', () => {
  it('uses source totals while summing per-website pages when stats are available', () => {
    const source = {
      id: 'source-1',
      name: 'Example',
      url: 'https://example.test/one',
      schedule: { interval: 'daily', time: '09:00' },
      isActive: true,
      lastFound: 12,
      lastNew: 4,
      lastPagesScraped: 6,
      createdAt: new Date(),
    } as ScraperSource

    expect(getScraperTotals(source, [
      { url: 'https://example.test/one', pagesScraped: 2, found: 3, created: 1, updated: 0 },
      { url: 'https://example.test/two', pagesScraped: 4, found: 5, created: 2, updated: 0 },
    ])).toEqual({
      pagesScraped: 6,
      created: 4,
      found: 12,
    })
  })

  it('matches scraper website stats by normalized url', () => {
    const statsByUrl = buildScraperStatsByUrl([
      {
        url: 'https://example.test/one/',
        pagesScraped: 2,
        found: 3,
        created: 1,
        updated: 0,
      },
    ])

    expect(statsByUrl.get(normalizeScraperUrl('https://example.test/one'))).toEqual({
      url: 'https://example.test/one/',
      pagesScraped: 2,
      found: 3,
      created: 1,
      updated: 0,
    })
  })

  it('matches scraper website stats by url before falling back to index', () => {
    const websiteStats = [
      { url: 'https://example.test/one/', pagesScraped: 2, found: 3, created: 1, updated: 0 },
      { url: 'https://example.test/two/', pagesScraped: 4, found: 5, created: 2, updated: 0 },
    ]

    expect(getScraperWebsiteStat(websiteStats, 1, 'https://example.test/one')).toEqual(websiteStats[0])
  })

  it('falls back to ordered website stats for legacy rows without matching urls', () => {
    const websiteStats = [
      { url: 'https://legacy.test/one/', pagesScraped: 2, found: 3, created: 1, updated: 0 },
      { url: 'https://legacy.test/two/', pagesScraped: 4, found: 5, created: 2, updated: 0 },
    ]

    expect(getScraperWebsiteStat(websiteStats, 1, 'https://example.test/two')).toEqual(websiteStats[1])
  })
})
