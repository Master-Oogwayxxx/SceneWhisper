import { describe, expect, it } from 'vitest'

import { toggleActressWorkSelection } from './selected-works'
import type { ActressWork } from '@/types/types'

describe('toggleActressWorkSelection', () => {
  const works = [
    { content_id: 'work-1', video_code: 'AAA-001' },
    { content_id: 'work-2', video_code: 'AAA-002' },
    { content_id: 'work-3', video_code: 'AAA-003' },
    { content_id: 'work-4', video_code: 'AAA-004' },
  ] as ActressWork[]

  it('selects a contiguous range when shift-clicking from an anchor', () => {
    const initialCodes = new Set<string>(['work-1'])
    const initialWorks = [works[0]]

    const next = toggleActressWorkSelection(initialCodes, initialWorks, works, works[3], {
      shiftKey: true,
      anchorContentId: 'work-1',
    })

    expect(next.nextSelectedCodes).toEqual(new Set(['work-1', 'work-2', 'work-3', 'work-4']))
    expect(next.nextSelectedWorks).toEqual(works)
    expect(next.nextAnchorContentId).toBe('work-4')
  })

  it('falls back to single-item toggling when there is no anchor', () => {
    const next = toggleActressWorkSelection(new Set(), [], works, works[1], {
      shiftKey: true,
      anchorContentId: null,
    })

    expect(next.nextSelectedCodes).toEqual(new Set(['work-2']))
    expect(next.nextSelectedWorks).toEqual([works[1]])
    expect(next.nextAnchorContentId).toBe('work-2')
  })
})
