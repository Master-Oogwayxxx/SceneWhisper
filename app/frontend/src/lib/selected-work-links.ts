import type { ActressWork } from '@/types/types'

export interface SelectedWorkLink {
  contentId: string
  formattedId: string
}

export function resolveSelectedWorkLinks(
  selectedCodes: Set<string>,
  selectedWorks: ActressWork[] | undefined,
  visibleWorks: ActressWork[],
): SelectedWorkLink[] {
  if (selectedCodes.size === 0) {
    return []
  }

  const worksById = new Map<string, ActressWork>()
  for (const work of selectedWorks ?? []) {
    worksById.set(work.content_id, work)
  }
  for (const work of visibleWorks) {
    if (selectedCodes.has(work.content_id)) {
      worksById.set(work.content_id, work)
    }
  }

  return Array.from(selectedCodes)
    .map((contentId) => {
      const work = worksById.get(contentId)
      if (!work) return null
      const formattedId = work.video_code ?? work.dvd_id ?? work.content_id
      if (!formattedId) return null
      return { contentId, formattedId }
    })
    .filter((link): link is SelectedWorkLink => link !== null)
}
