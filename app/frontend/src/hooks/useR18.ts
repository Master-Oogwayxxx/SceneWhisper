import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { r18Api } from '@/api/r18'
import { ActressWorksFilterState, EMPTY_ACTRESS_WORKS_FILTER_STATE } from '@/lib/actress-works-filters'

export const r18Keys = {
  all: () => ['r18'] as const,
  status: () => ['r18', 'status'] as const,
  importStatus: () => ['r18', 'import', 'status'] as const,
  actresses: (q: string, page: number) => ['r18', 'actresses', q, page] as const,
  actress: (id: number) => ['r18', 'actress', id] as const,
  actressWorks: (
    id: number, page: number, pageSize: number,
    sortBy: string, sortDir: string, search: string,
    filters: ActressWorksFilterState
  ) => ['r18', 'actress', id, 'works', page, pageSize, sortBy, sortDir, search, filters] as const,
}

/**
 * Poll R18 database load state and import progress.
 */
export function useR18Status() {
  return useQuery({
    queryKey: r18Keys.status(),
    queryFn: r18Api.getStatus,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      return data.import_in_progress || data.import_state === 'running' ? 2000 : false
    },
  })
}

/**
 * Search actresses when the reference database is loaded.
 * @param q - Debounced search query
 * @param page - Zero-based page index
 * @param pageSize - Rows per page
 * @param enabled - Whether the query should run
 */
export function useR18ActressSearch(q: string, page: number, pageSize: number, enabled: boolean) {
  return useQuery({
    queryKey: r18Keys.actresses(q, page),
    queryFn: () => r18Api.searchActresses(q, page * pageSize, pageSize),
    enabled,
  })
}

/**
 * Fetch one actress detail panel payload.
 * @param id - Actress primary key, or null when nothing is selected
 * @param enabled - Whether the query should run
 */
export function useR18ActressDetail(id: number | null, enabled: boolean) {
  return useQuery({
    queryKey: r18Keys.actress(id ?? 0),
    queryFn: () => r18Api.getActress(id!),
    enabled: enabled && id !== null,
  })
}

/**
 * Fetch paginated works for the selected actress.
 * @param id - Actress primary key, or null when nothing is selected
 * @param page - Zero-based page index
 * @param pageSize - Works per page
 * @param enabled - Whether the query should run
 */
export function useR18ActressWorks(
  id: number | null,
  page: number,
  pageSize: number,
  enabled: boolean,
  sortBy = 'date',
  sortDir = 'desc',
  search = '',
  filters: ActressWorksFilterState = EMPTY_ACTRESS_WORKS_FILTER_STATE
) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: r18Keys.actressWorks(id ?? 0, page, pageSize, sortBy, sortDir, search, filters),
    queryFn: () => r18Api.getActressWorks(id!, page * pageSize, pageSize, sortBy, sortDir, search, filters),
    enabled: enabled && id !== null,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  })

  useEffect(() => {
    if (!enabled || id === null || !query.data) return

    const totalPages = Math.ceil(query.data.total / pageSize)
    const adjacentPages = [page - 1, page + 1].filter((candidate) => candidate >= 0 && candidate < totalPages)
    for (const adjacentPage of adjacentPages) {
      void queryClient.prefetchQuery({
        queryKey: r18Keys.actressWorks(id, adjacentPage, pageSize, sortBy, sortDir, search, filters),
        queryFn: () => r18Api.getActressWorks(id, adjacentPage * pageSize, pageSize, sortBy, sortDir, search, filters),
        staleTime: 5 * 60 * 1000,
      })
    }
  }, [enabled, filters, id, page, pageSize, query.data, queryClient, search, sortBy, sortDir])

  return query
}

/**
 * Start file or URL imports and invalidate cached R18 queries on success.
 */
export function useR18ImportMutations() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: r18Keys.all() })
  }

  const importFile = useMutation({
    mutationFn: (file: File) => r18Api.importDatabase(file),
    onSuccess: invalidate,
  })

  const importLatest = useMutation({
    mutationFn: () => r18Api.importFromUrl(),
    onSuccess: invalidate,
  })

  return { importFile, importLatest }
}
