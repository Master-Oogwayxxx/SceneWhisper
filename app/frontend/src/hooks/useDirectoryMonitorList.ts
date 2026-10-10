import { useState, useMemo, useCallback } from 'react'
import { DirectoryMonitor, AppSettings } from '@/types/types'
import { useSettings } from './useSettings'

export type MonitorSortField = 'directoryName' | 'isActive' | 'nextRun' | 'lastRun' | 'createdAt' | 'interval'

export const MONITOR_SORT_OPTIONS: { value: MonitorSortField; label: string }[] = [
  { value: 'directoryName', label: 'Directory Name' },
  { value: 'isActive', label: 'Status' },
  { value: 'nextRun', label: 'Next Run' },
  { value: 'lastRun', label: 'Last Run' },
  { value: 'createdAt', label: 'Created' },
  { value: 'interval', label: 'Interval' },
]

function compareMonitors(a: DirectoryMonitor, b: DirectoryMonitor, field: MonitorSortField, dir: 'asc' | 'desc'): number {
  let result = 0
  switch (field) {
    case 'directoryName':
      result = a.directoryName.localeCompare(b.directoryName)
      break
    case 'isActive':
      result = Number(b.isActive) - Number(a.isActive)
      break
    case 'nextRun':
      result = (a.nextRun?.getTime() ?? 0) - (b.nextRun?.getTime() ?? 0)
      break
    case 'lastRun':
      result = (a.lastRun?.getTime() ?? 0) - (b.lastRun?.getTime() ?? 0)
      break
    case 'createdAt':
      result = a.createdAt.getTime() - b.createdAt.getTime()
      break
    case 'interval': {
      const order = { hourly: 0, daily: 1, weekly: 2 }
      result = order[a.schedule.interval] - order[b.schedule.interval]
      break
    }
  }
  return dir === 'asc' ? result : -result
}

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 250, 500, 1000] as const
export type PageSize = typeof PAGE_SIZE_OPTIONS[number]

interface DirectoryMonitorListOptions {
  initialPage?: number
  initialPageSize?: PageSize
}

export function useDirectoryMonitorList(monitors: DirectoryMonitor[], options: DirectoryMonitorListOptions = {}) {
  const { settings, patchSettings } = useSettings()

  const [sortField, setSortFieldState] = useState<MonitorSortField>(
    (settings.monitor_sort_field as MonitorSortField) ?? 'directoryName'
  )
  const [sortDirection, setSortDirectionState] = useState<'asc' | 'desc'>(
    settings.monitor_sort_direction ?? 'asc'
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pageSize, setPageSizeState] = useState<PageSize>(options.initialPageSize ?? 25)
  const [currentPage, setCurrentPageState] = useState(options.initialPage ?? 1)
  const [searchQuery, setSearchQueryState] = useState('')

  const sortedMonitors = useMemo(
    () => [...monitors].sort((a, b) => compareMonitors(a, b, sortField, sortDirection)),
    [monitors, sortField, sortDirection]
  )

  const filteredMonitors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return sortedMonitors
    return sortedMonitors.filter(
      (m) => m.directoryName.toLowerCase().includes(q) || m.directoryPath.toLowerCase().includes(q)
    )
  }, [sortedMonitors, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filteredMonitors.length / pageSize))

  const paginatedMonitors = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredMonitors.slice(start, start + pageSize)
  }, [filteredMonitors, currentPage, pageSize])

  const setSearchQuery = useCallback((q: string) => {
    setSearchQueryState(q)
    setCurrentPageState(1)
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(monitors.map((m) => m.id)))
  }, [monitors])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const rangeSelect = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids))
  }, [])

  const setSortField = useCallback(
    (field: MonitorSortField) => {
      setSortFieldState(field)
      setCurrentPageState(1)
      patchSettings({ monitor_sort_field: field })
    },
    [patchSettings]
  )

  const toggleSortDirection = useCallback(() => {
    setSortDirectionState((prev) => {
      const next: 'asc' | 'desc' = prev === 'asc' ? 'desc' : 'asc'
      patchSettings({ monitor_sort_direction: next })
      return next
    })
    setCurrentPageState(1)
  }, [patchSettings])

  const setPageSize = useCallback((size: PageSize) => {
    setPageSizeState(size)
    setCurrentPageState(1)
  }, [])

  const setCurrentPage = useCallback((page: number) => {
    setCurrentPageState(page)
  }, [])

  const allSelected = monitors.length > 0 && selectedIds.size === monitors.length
  const someSelected = selectedIds.size > 0 && selectedIds.size < monitors.length

  return {
    sortedMonitors,
    filteredMonitors,
    paginatedMonitors,
    selectedIds,
    searchQuery,
    setSearchQuery,
    sortField,
    sortDirection,
    pageSize,
    currentPage,
    totalPages,
    allSelected,
    someSelected,
    toggleSelect,
    selectAll,
    clearSelection,
    rangeSelect,
    setSortField,
    toggleSortDirection,
    setPageSize,
    setCurrentPage,
  }
}
