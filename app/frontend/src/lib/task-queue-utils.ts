import type { TaskTypeFilter } from '@/components/TaskFilterDialog'

export function formatEtaSeconds(seconds: number): string {
  const rounded = Math.max(0, Math.ceil(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remainingSeconds = rounded % 60
  return hours > 0 ? `~${hours}h ${minutes}m` : minutes > 0 ? `~${minutes}m ${remainingSeconds}s` : `~${remainingSeconds}s`
}

export const taskMatchesTypeFilter = (taskType: TaskTypeFilter, selectedTypes: TaskTypeFilter[]): boolean => selectedTypes.length === 0 || selectedTypes.includes(taskType) || (taskType === 'all' && selectedTypes.some((type) => type === 'scene' || type === 'split' || type === 'subtitle'))
