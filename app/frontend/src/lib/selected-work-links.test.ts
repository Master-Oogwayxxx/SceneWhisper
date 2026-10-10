import { describe, expect, it } from 'vitest'

import { resolveSelectedWorkLinks } from './selected-work-links'

describe('resolveSelectedWorkLinks', () => {
  it('keeps selected items that are not present in the current page slice', () => {
    const selectedCodes = new Set(['page-1-a', 'page-2-b'])
    const selectedWorks = [
      { content_id: 'page-1-a', video_code: 'AAA-001' },
    ] as never
    const visibleWorks = [
      { content_id: 'page-2-b', dvd_id: 'BBB-002' },
    ] as never

    expect(resolveSelectedWorkLinks(selectedCodes, selectedWorks, visibleWorks)).toEqual([
      { contentId: 'page-1-a', formattedId: 'AAA-001' },
      { contentId: 'page-2-b', formattedId: 'BBB-002' },
    ])
  })

  it('returns an empty list when nothing is selected', () => {
    expect(resolveSelectedWorkLinks(new Set(), [], [])).toEqual([])
  })
})
