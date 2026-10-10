import type { ActressWork } from '@/types/types'

export function mergeSelectedWorks(prev: ActressWork[], nextWorks: ActressWork[]): ActressWork[] {
  const merged = new Map(prev.map((work) => [work.content_id, work]))
  for (const work of nextWorks) {
    merged.set(work.content_id, work)
  }
  return [...merged.values()]
}

export function toggleActressWorkSelection(
  prevSelectedCodes: Set<string>,
  prevSelectedWorks: ActressWork[],
  visibleWorks: ActressWork[],
  work: ActressWork,
  options: { shiftKey?: boolean; anchorContentId?: string | null } = {},
): {
  nextSelectedCodes: Set<string>
  nextSelectedWorks: ActressWork[]
  nextAnchorContentId: string
} {
  const { shiftKey = false, anchorContentId = null } = options
  const workIndex = visibleWorks.findIndex((item) => item.content_id === work.content_id)

  if (shiftKey && workIndex !== -1 && anchorContentId) {
    const anchorIndex = visibleWorks.findIndex((item) => item.content_id === anchorContentId)
    if (anchorIndex !== -1) {
      const start = Math.min(anchorIndex, workIndex)
      const end = Math.max(anchorIndex, workIndex)
      const rangeWorks = visibleWorks.slice(start, end + 1)
      return {
        nextSelectedCodes: new Set([...prevSelectedCodes, ...rangeWorks.map((item) => item.content_id)]),
        nextSelectedWorks: mergeSelectedWorks(prevSelectedWorks, rangeWorks),
        nextAnchorContentId: work.content_id,
      }
    }
  }

  const nextSelectedCodes = new Set(prevSelectedCodes)
  if (nextSelectedCodes.has(work.content_id)) nextSelectedCodes.delete(work.content_id)
  else nextSelectedCodes.add(work.content_id)

  const exists = prevSelectedWorks.some((item) => item.content_id === work.content_id)
  return {
    nextSelectedCodes,
    nextSelectedWorks: exists
      ? prevSelectedWorks.filter((item) => item.content_id !== work.content_id)
      : [...prevSelectedWorks, work],
    nextAnchorContentId: work.content_id,
  }
}
