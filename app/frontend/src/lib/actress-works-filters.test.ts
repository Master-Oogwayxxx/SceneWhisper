import { describe, expect, it } from 'vitest'

import type { ActressWork } from '@/types/types'
import { filterActressWorksByMetadataSource } from './actress-works-filters'

describe('filterActressWorksByMetadataSource', () => {
  const works = [
    { content_id: 'r18', metadata_source: 'r18' },
    { content_id: 'legacy-r18' },
    { content_id: 'merged', metadata_source: 'merged' },
    { content_id: 'scraped', metadata_source: 'scraped' },
  ] as ActressWork[]

  it('keeps merged works in the R18 results', () => {
    expect(filterActressWorksByMetadataSource(works, 'r18').map((work) => work.content_id))
      .toEqual(['r18', 'legacy-r18', 'merged'])
  })

  it('keeps the merged and scraper-only filters exact', () => {
    expect(filterActressWorksByMetadataSource(works, 'merged').map((work) => work.content_id))
      .toEqual(['merged'])
    expect(filterActressWorksByMetadataSource(works, 'scraped').map((work) => work.content_id))
      .toEqual(['scraped'])
  })
})
