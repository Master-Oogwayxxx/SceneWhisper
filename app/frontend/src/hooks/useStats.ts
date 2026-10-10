import { useQuery } from '@tanstack/react-query'
import { statsApi } from '@/api/stats'
import type { Stats, OverviewStats } from '@/types/types'

const statsKeys = {
  all: () => ['stats'] as const,
  overview: () => ['stats', 'overview'] as const,
}

export function useStats(enabled = true) {
  return useQuery({
    queryKey: statsKeys.all(),
    queryFn: () => statsApi.getStats(),
    refetchInterval: 5000,
    enabled,
  })
}

export function useOverviewStats(enabled = true) {
  return useQuery({
    queryKey: statsKeys.overview(),
    queryFn: () => statsApi.getOverviewStats(),
    refetchInterval: 5000,
    enabled,
  })
}

export { statsKeys }
