import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { ListFilter, Clock, Loader2, CheckCircle2, AlertCircle, Ban, Search, X, Trash2, CircleX, RefreshCw, Pencil, Pause, Play, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ChevronsUp, ChevronsDown, Scissors, ChevronDown } from 'lucide-react'
import type { DirectoryRecord, Stats, Task } from '../types/types'
import { useGlobalPause } from '../hooks/useGlobalPause'
import { useTaskEstimates } from '../hooks/useTaskEstimates'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog'
import { EMPTY_TASK_FILTERS, TaskFilterDialog, type TaskFilters, type TaskTypeFilter } from './TaskFilterDialog'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Skeleton } from './ui/skeleton'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { cn } from '../lib/utils'
import { TaskCard } from './TaskCard'
import TaskSorting, { type TaskSortField } from './TaskSorting'
import { BulkProgressDialog } from './BulkProgressDialog'
import DashboardStats from './DashboardStats'

const compactToolbarButtonClass = 'h-8 gap-1.5 px-2 text-xs sm:h-[40px] sm:gap-2 sm:px-3 sm:text-sm'
const compactToolbarIconClass = 'h-3.5 w-3.5 sm:h-4 sm:w-4'
const compactPageButtonClass = 'min-h-0 rounded-md border text-xs font-medium sm:text-sm'
const compactPageIconClass = 'h-3.5 w-3.5 sm:h-4 sm:w-4'

function formatEtaSeconds(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  if (h > 0) return `~${h}h ${m}m`
  if (m > 0) return `~${m}m ${s}s`
  return `~${s}s`
}

interface TaskQueueProps {
  /** Tasks to display (filtered by status and optional name search inside this component). */
  tasks: Task[]
  /** Whether tasks are currently loading. */
  isLoading?: boolean
  /** Current status filter (controlled by parent, e.g. dashboard stat cards). */
  activeFilter: TaskQueueFilter
  /** Called when the user picks a different status filter. */
  onActiveFilterChange: (filter: TaskQueueFilter) => void
  /** Current page (controlled by parent for polling). */
  currentPage: number
  /** Current page size (controlled by parent for polling). */
  pageSize: number
  /** Called when user changes page. */
  onPageChange: (page: number) => void
  /** Called when user changes page size. */
  onPageSizeChange: (size: number) => void
  /** Search query (controlled by parent). */
  searchQuery?: string
  /** Called when user changes search query. */
  onSearchChange?: (query: string) => void
  sortField?: TaskSortField
  sortDirection?: 'asc' | 'desc'
  onSortFieldChange?: (field: TaskSortField) => void
  onSortDirectionChange?: (direction: 'asc' | 'desc') => void
  appliedFilters?: TaskFilters
  onAppliedFiltersChange?: (filters: TaskFilters) => void
  directories?: DirectoryRecord[]
  onCancelTask?: (taskId: string) => void
  onDeleteTask?: (taskId: string, silent?: boolean) => void
  onBulkDeleteTasks?: (tasks: Task[]) => Promise<void>
  onRerunTask?: (task: Task) => void
  onBulkRerunTasks?: (tasks: Task[]) => Promise<void>
  onEditTask?: (task: Task) => void
  onBulkEditTasks?: (tasks: Task[]) => void
  onPauseTask?: (taskId: string) => void
  onUnpauseTask?: (taskId: string) => void
  onBulkPauseTasks?: (taskIds: string[]) => Promise<unknown>
  onBulkUnpauseTasks?: (taskIds: string[]) => Promise<unknown>
  onMoveToTop?: (taskIds: string[]) => void
  onMoveToBottom?: (taskIds: string[]) => void
  onToggleTaskTypeDisabled?: (fileId: string, taskType: 'split' | 'subtitle') => Promise<void>
  highlightTaskId?: string | null
  /** Total count of tasks matching the filter (from server pagination). */
  totalCount?: number
  onRefresh?: (filter: TaskQueueFilter) => Promise<void> | void
  stats?: Stats
}

/** Status tab for the task queue; `all` shows every task. */
export type TaskQueueFilter = 'all' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused'

const filters: { value: TaskQueueFilter; label: string; icon: typeof Clock }[] = [
  { value: 'all', label: 'All', icon: ListFilter },
  { value: 'queued', label: 'Queued', icon: Clock },
  { value: 'processing', label: 'Processing', icon: Loader2 },
  { value: 'completed', label: 'Completed', icon: CheckCircle2 },
  { value: 'failed', label: 'Failed', icon: AlertCircle },
  { value: 'cancelled', label: 'Cancelled', icon: Ban },
  { value: 'paused', label: 'Paused', icon: Pause },
]

const taskMatchesTypeFilter = (taskType: TaskTypeFilter, selectedTypes: TaskTypeFilter[]): boolean => {
  if (selectedTypes.length === 0) return true
  if (selectedTypes.includes(taskType)) return true
  return taskType === 'all' && selectedTypes.some((type) => type === 'scene' || type === 'split' || type === 'subtitle')
}

/**
 * Renders a filterable list of task cards with optional search by source video file name.
 * @param props - Queue data, controlled filter, and optional cancel/delete handlers
 */
export function TaskQueue({
  tasks,
  isLoading,
  activeFilter,
  onActiveFilterChange,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  searchQuery = '',
  onSearchChange,
  sortField: controlledSortField,
  sortDirection: controlledSortDirection,
  onSortFieldChange,
  onSortDirectionChange,
  appliedFilters: controlledAppliedFilters,
  onAppliedFiltersChange,
  directories = [],
  onCancelTask,
  onDeleteTask,
  onBulkDeleteTasks,
  onRerunTask,
  onBulkRerunTasks,
  onEditTask,
  onBulkEditTasks,
  onPauseTask,
  onUnpauseTask,
  onBulkPauseTasks,
  onBulkUnpauseTasks,
  onMoveToTop,
  onMoveToBottom,
  onToggleTaskTypeDisabled,
  highlightTaskId,
  totalCount,
  onRefresh,
  stats,
}: TaskQueueProps) {
  const { isGloballyPaused, globalPause, globalUnpause } = useGlobalPause()
  const { estimateTask, isReady: estimatesReady } = useTaskEstimates()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [draftFilters, setDraftFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)
  const [localAppliedFilters, setLocalAppliedFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)
  const appliedFilters = controlledAppliedFilters ?? localAppliedFilters
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const isFilterActive =
    appliedFilters.taskType.length > 0 ||
    appliedFilters.dateRange.length > 0 ||
    appliedFilters.subtitleLanguage.length > 0 ||
    appliedFilters.sceneDetector.length > 0 ||
    appliedFilters.selectedDirectoryIds.length > 0

  const availableLanguages = useMemo(() =>
    [...new Set(tasks.flatMap(t => t.subtitleLanguage ? [t.subtitleLanguage] : []))].sort()
    , [tasks])

  const availableDetectors = useMemo(() =>
    [...new Set(tasks.flatMap(t => t.scene_detector ? [t.scene_detector] : []))].sort()
    , [tasks])

  const handleApplyFilters = () => {
    if (onAppliedFiltersChange) {
      onAppliedFiltersChange(draftFilters)
    } else {
      setLocalAppliedFilters(draftFilters)
    }
    setIsFilterDialogOpen(false)
    onPageChange(1)
  }

  const handleResetFilters = () => {
    setDraftFilters(EMPTY_TASK_FILTERS)
    if (onAppliedFiltersChange) {
      onAppliedFiltersChange(EMPTY_TASK_FILTERS)
    } else {
      setLocalAppliedFilters(EMPTY_TASK_FILTERS)
    }
    onPageChange(1)
  }

  useEffect(() => {
    if (!isFilterDialogOpen) return
    setDraftFilters(appliedFilters)
  }, [isFilterDialogOpen, appliedFilters])

  const taskRefsMap = useRef<Record<string, HTMLDivElement | null>>({})
  const anchorIndexRef = useRef<number | null>(null)

  type SortState = { field: TaskSortField; direction: 'asc' | 'desc' }
  const DEFAULT_SORT: SortState = { field: 'createdAt', direction: 'desc' }

  const [tabSortStates, setTabSortStates] = useState<Record<TaskQueueFilter, SortState>>({
    all: DEFAULT_SORT,
    queued: { field: 'createdAt', direction: 'asc' },
    processing: DEFAULT_SORT,
    completed: { field: 'completedAt', direction: 'desc' },
    failed: { field: 'completedAt', direction: 'desc' },
    cancelled: { field: 'completedAt', direction: 'desc' },
    paused: { field: 'pausedAt', direction: 'desc' },
  })

  const { field: localSortField, direction: localSortDirection } = tabSortStates[activeFilter]
  const sortField = controlledSortField ?? localSortField
  const sortDirection = controlledSortDirection ?? localSortDirection

  const setSortField = (field: TaskSortField) => {
    onSortFieldChange?.(field)
    setTabSortStates(prev => ({ ...prev, [activeFilter]: { ...prev[activeFilter], field } }))
  }

  const setSortDirection = (direction: 'asc' | 'desc') => {
    onSortDirectionChange?.(direction)
    setTabSortStates(prev => ({ ...prev, [activeFilter]: { ...prev[activeFilter], direction } }))
  }

  const filteredTasks = useMemo(() => {
    const now = Date.now()
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)

    const byStatus = tasks
      .filter((task) => (activeFilter === 'all' ? true : task.status === activeFilter))
      .filter((task) => taskMatchesTypeFilter(task.type as TaskTypeFilter, appliedFilters.taskType))
      .filter((task) => appliedFilters.subtitleLanguage.length === 0 || appliedFilters.subtitleLanguage.includes(task.subtitleLanguage ?? ''))
      .filter((task) => appliedFilters.sceneDetector.length === 0 || appliedFilters.sceneDetector.includes(task.scene_detector ?? ''))
      .filter((task) => {
        if (appliedFilters.dateRange.length === 0) return true
        const created = new Date(task.createdAt).getTime()
        return appliedFilters.dateRange.some((range) => {
          if (range === 'today') return created >= startOfToday.getTime()
          if (range === 'last_7_days') return created >= now - 7 * 86400000
          if (range === 'last_30_days') return created >= now - 30 * 86400000
          if (range === 'last_year') return created >= now - 365 * 86400000
          return false
        })
      })

    const parseDuration = (d: string | undefined): number | null => {
      if (!d) return null
      const parts = d.split(':').map(Number)
      if (parts.length !== 3 || parts.some(isNaN)) return null
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    }

    if (activeFilter === 'queued') return byStatus

    return [...byStatus].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1

      if (sortField === 'name') {
        const getMergeName = (t: Task) => {
          try { const p: string[] = JSON.parse(t.merge_input_paths ?? '[]'); if (p.length) return p[0].split(/[\\/]/).pop() ?? 'Merge Task' } catch { /* fall through */ }
          return 'Merge Task'
        }
        const aName = a.file?.name || getMergeName(a)
        const bName = b.file?.name || getMergeName(b)
        return aName.localeCompare(bName) * dir
      }
      if (sortField === 'status') return a.status.localeCompare(b.status) * dir
      if (sortField === 'type') return a.type.localeCompare(b.type) * dir

      let aVal: number | null
      let bVal: number | null

      if (sortField === 'createdAt') {
        aVal = new Date(a.createdAt).getTime()
        bVal = new Date(b.createdAt).getTime()
      } else if (sortField === 'startedAt') {
        aVal = a.startedAt ? new Date(a.startedAt).getTime() : null
        bVal = b.startedAt ? new Date(b.startedAt).getTime() : null
      } else if (sortField === 'completedAt') {
        aVal = a.completedAt ? new Date(a.completedAt).getTime() : null
        bVal = b.completedAt ? new Date(b.completedAt).getTime() : null
      } else if (sortField === 'pausedAt') {
        aVal = a.pausedAt ? new Date(a.pausedAt).getTime() : null
        bVal = b.pausedAt ? new Date(b.pausedAt).getTime() : null
      } else {
        // 'elapsedSeconds' → sort by the video file's duration (HH:MM:SS) converted to seconds
        aVal = parseDuration(a.file?.duration)
        bVal = parseDuration(b.file?.duration)
      }

      if (aVal === null && bVal === null) return 0
      if (aVal === null) return 1
      if (bVal === null) return -1
      return (aVal - bVal) * dir
    })
  }, [tasks, activeFilter, sortField, sortDirection, appliedFilters])

  const totalPages = Math.max(1, Math.ceil((totalCount ?? filteredTasks.length) / pageSize))
  const paginatedTasks = filteredTasks

  const queuedEstimates = useMemo(() => {
    if (activeFilter !== 'queued') return { perTask: new Map<string, number>(), total: 0, hasAny: false }
    let total = 0
    let hasAny = false
    const perTask = new Map<string, number>()
    for (const task of paginatedTasks) {
      if (task.status !== 'queued') continue
      const est = estimateTask(task)
      if (est !== undefined) {
        perTask.set(task.id, est)
        total += est
        hasAny = true
      }
    }
    return { perTask, total, hasAny }
  }, [activeFilter, paginatedTasks, estimateTask, estimatesReady])

  const pageNumbers = useMemo(() => {
    const delta = 2
    const start = Math.max(1, currentPage - delta)
    const end = Math.min(totalPages, currentPage + delta)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }, [currentPage, totalPages])

  useEffect(() => {
    onPageChange(1)
  }, [activeFilter, sortField, sortDirection, pageSize])

  useEffect(() => {
    setSelectedIds(new Set())
    anchorIndexRef.current = null
  }, [activeFilter])

  useEffect(() => {
    if (!highlightTaskId) return
    const element = taskRefsMap.current[highlightTaskId]
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightTaskId])

  useEffect(() => {
    setSelectedIds(prev => {
      const filteredTaskIds = new Set(filteredTasks.map(t => t.id))
      const next = new Set(prev)
      for (const id of prev) {
        if (!filteredTaskIds.has(id)) next.delete(id)
      }
      return next.size === prev.size ? prev : next
    })
  }, [filteredTasks])

  const toggleSelect = useCallback((id: string, _selected: boolean, e: React.MouseEvent) => {
    const index = paginatedTasks.findIndex(t => t.id === id)
    if (e.shiftKey && anchorIndexRef.current !== null) {
      const start = Math.min(anchorIndexRef.current, index)
      const end = Math.max(anchorIndexRef.current, index)
      setSelectedIds(new Set(paginatedTasks.slice(start, end + 1).map(t => t.id)))
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
      anchorIndexRef.current = index
    }
  }, [paginatedTasks])

  const allFilteredSelected =
    paginatedTasks.length > 0 && paginatedTasks.every((t) => selectedIds.has(t.id))

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        paginatedTasks.forEach(t => next.delete(t.id))
        return next
      })
    } else {
      setSelectedIds(prev => new Set([...prev, ...paginatedTasks.map(t => t.id)]))
    }
  }

  const selectedTasks = filteredTasks.filter((t) => selectedIds.has(t.id))
  const cancellableTasks = selectedTasks.filter((t) => t.status === 'queued' || t.status === 'processing')
  const rerunableTasks = selectedTasks.filter((t) => {
    if (t.status !== 'failed' && t.status !== 'cancelled') return false
    if (t.type === 'split') return !t.file?.split_disabled
    if (t.type === 'subtitle') return !t.file?.subtitle_disabled
    if (t.type === 'all') return !t.file?.split_disabled && !t.file?.subtitle_disabled
    return true
  })
  const deletableTasks = selectedTasks.filter((t) => t.status === 'queued' || t.status === 'paused' || t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
  const editableTasks = selectedTasks.filter((t) => t.status === 'queued')
  const pausableTasks = selectedTasks.filter((t) => t.status === 'queued' || t.status === 'processing')
  const unpausableTasks = selectedTasks.filter((t) => t.status === 'paused')
  const splitDisableable = selectedTasks.filter((t) => t.file && !t.file.split_disabled)
  const subtitleDisableable = selectedTasks.filter((t) => t.file && !t.file.subtitle_disabled)
  const splitEnableable = selectedTasks.filter((t) => t.file?.split_disabled)
  const subtitleEnableable = selectedTasks.filter((t) => t.file?.subtitle_disabled)

  const handleBulkCancel = async () => {
    if (onCancelTask) for (const task of cancellableTasks) await onCancelTask(task.id)
    setSelectedIds(new Set())
  }

  const handleBulkRerun = async () => {
    if (rerunableTasks.length === 1 && onRerunTask) {
      onRerunTask(rerunableTasks[0])
    } else if (rerunableTasks.length > 1 && onBulkRerunTasks) {
      await onBulkRerunTasks(rerunableTasks)
      setSelectedIds(new Set())
    }
  }

  const handleBulkDelete = async () => {
    if (onBulkDeleteTasks) {
      await onBulkDeleteTasks(deletableTasks)
    } else if (onDeleteTask) {
      for (const task of deletableTasks) await onDeleteTask(task.id, true)
      toast.success(`${deletableTasks.length} task${deletableTasks.length !== 1 ? 's' : ''} deleted`)
    }
    setSelectedIds(new Set())
  }

  const handleBulkEdit = () => {
    if (editableTasks.length === 0) return
    onBulkEditTasks?.(editableTasks)
    setSelectedIds(new Set())
  }

  const [pendingPauseTasks, setPendingPauseTasks] = useState<Task[] | null>(null)
  const [pauseProgress, setPauseProgress] = useState<{ total: number; done: number } | null>(null)

  const handlePauseWithConfirm = (taskId: string) => {
    const task = filteredTasks.find(t => t.id === taskId)
    if (task) setPendingPauseTasks([task])
  }

  const handleConfirmPause = async () => {
    const tasks = pendingPauseTasks
    setPendingPauseTasks(null)
    if (!tasks || tasks.length === 0) return
    setPauseProgress({ total: tasks.length, done: 0 })
    if (onBulkPauseTasks) {
      await onBulkPauseTasks(tasks.map(t => t.id))
      setPauseProgress({ total: tasks.length, done: tasks.length })
    } else if (onPauseTask) {
      for (let i = 0; i < tasks.length; i++) {
        await onPauseTask(tasks[i].id)
        setPauseProgress({ total: tasks.length, done: i + 1 })
      }
    }
    setSelectedIds(new Set())
  }

  const handleBulkPause = () => {
    if (pausableTasks.length > 0) setPendingPauseTasks(pausableTasks)
  }

  const [unpauseProgress, setUnpauseProgress] = useState<{ total: number; done: number } | null>(null)

  const handleBulkUnpause = async () => {
    if (unpausableTasks.length === 0) return
    setUnpauseProgress({ total: unpausableTasks.length, done: 0 })
    if (onBulkUnpauseTasks) {
      await onBulkUnpauseTasks(unpausableTasks.map(t => t.id))
      setUnpauseProgress({ total: unpausableTasks.length, done: unpausableTasks.length })
    } else if (onUnpauseTask) {
      for (let i = 0; i < unpausableTasks.length; i++) {
        await onUnpauseTask(unpausableTasks[i].id)
        setUnpauseProgress({ total: unpausableTasks.length, done: i + 1 })
      }
    }
    setSelectedIds(new Set())
  }

  const handleBulkDisable = async (taskType: 'split' | 'subtitle') => {
    if (onToggleTaskTypeDisabled) {
      const tasks = taskType === 'split' ? splitDisableable : subtitleDisableable
      const fileIds = new Set(tasks.map(t => t.file!.id))
      for (const fileId of fileIds) await onToggleTaskTypeDisabled(fileId, taskType)
    }
    setSelectedIds(new Set())
  }

  const handleBulkEnable = async (taskType: 'split' | 'subtitle') => {
    if (onToggleTaskTypeDisabled) {
      const tasks = taskType === 'split' ? splitEnableable : subtitleEnableable
      const fileIds = new Set(tasks.map(t => t.file!.id))
      for (const fileId of fileIds) await onToggleTaskTypeDisabled(fileId, taskType)
    }
    setSelectedIds(new Set())
  }

  const duplicateTasksToRemove = useMemo(() => {
    const eligible = filteredTasks.filter(t => t.status === 'failed' || t.status === 'cancelled')
    const groups = new Map<string, Task[]>()
    for (const task of eligible) {
      const key = `${task.file?.name ?? task.id}__${task.type}`
      const group = groups.get(key) ?? []
      group.push(task)
      groups.set(key, group)
    }
    const toDelete: Task[] = []
    for (const group of groups.values()) {
      if (group.length <= 1) continue
      const sorted = [...group].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      toDelete.push(...sorted.slice(1))
    }
    return toDelete
  }, [filteredTasks])

  const handleRemoveDuplicates = async () => {
    if (!onDeleteTask) return
    for (const task of duplicateTasksToRemove) await onDeleteTask(task.id, true)
    toast.success(`Removed ${duplicateTasksToRemove.length} duplicate task${duplicateTasksToRemove.length !== 1 ? 's' : ''}`)
  }

  const showRemoveDuplicates =
    (activeFilter === 'all' || activeFilter === 'failed' || activeFilter === 'cancelled') &&
    duplicateTasksToRemove.length > 0

  const activeFilterMeta = filters.find((filter) => filter.value === activeFilter) ?? filters[0]
  const ActiveFilterIcon = activeFilterMeta.icon

  const emptyHint =
    filteredTasks.length === 0 && (totalCount ?? 0) > 0 && searchQuery
      ? 'Try a different search or clear the filter'
      : activeFilter !== 'all'
        ? 'Try selecting a different filter'
        : undefined

  return (
    <div className='flex min-h-0 grow flex-col gap-3'>
      {stats && (
        <div className='block sm:hidden'>
          <DashboardStats stats={stats} openTaskQueueWithFilter={(status) => onActiveFilterChange(status as TaskQueueFilter)} />
        </div>
      )}

      <div className='grid min-w-0 shrink-0 grid-cols-[1fr_auto] items-center gap-1.5 p-1 sm:gap-2 lg:flex lg:flex-row'>
        <div className='col-span-2 flex min-h-8 min-w-0 flex-1 items-center sm:min-h-9 lg:col-span-1'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='outline'
                size='sm'
                className={cn(compactToolbarButtonClass, 'w-full justify-between sm:w-48 min-[1920px]:hidden')}
                aria-label='Select task status filter'
              >
                <span className='flex min-w-0 items-center gap-1.5'>
                  <ActiveFilterIcon className={cn(compactToolbarIconClass, activeFilter === 'processing' && 'animate-spin')} />
                  <span className='truncate'>{activeFilterMeta.label}</span>
                </span>
                <ChevronDown className='h-3.5 w-3.5 opacity-70 sm:h-4 sm:w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='w-48'>
              {filters.map((filter) => (
                <DropdownMenuItem
                  key={filter.value}
                  className={cn('gap-2', activeFilter === filter.value && 'bg-accent text-accent-foreground')}
                  onClick={() => onActiveFilterChange(filter.value)}
                >
                  <filter.icon className={cn('h-4 w-4', filter.value === 'processing' && activeFilter === filter.value && 'animate-spin')} />
                  {filter.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className='scrollbar hidden min-w-0 flex-1 items-center gap-1.5 overflow-x-auto sm:gap-2 min-[1920px]:flex'>
          {filters.map((filter) => {
            return (
              <Button
                key={filter.value}
                variant={activeFilter === filter.value ? 'default' : 'outline'}
                size='sm'
                onClick={() => onActiveFilterChange(filter.value)}
                className={cn(compactToolbarButtonClass, 'shrink-0', activeFilter === filter.value && 'shadow-lg shadow-primary/20')}
              >
                <filter.icon className={cn(compactToolbarIconClass, filter.value === 'processing' && activeFilter === filter.value && 'animate-spin')} />
                {filter.label}
              </Button>
            )
          })}
          </div>
        </div>

        <div className='scrollbar col-span-2 flex min-w-0 items-center gap-1.5 overflow-x-auto sm:gap-2 lg:contents'>
          {showRemoveDuplicates && (
            <Button
              variant='outline'
              size='sm'
              className={cn(compactToolbarButtonClass, 'shrink-0 text-destructive hover:text-destructive')}
              title={`Delete ${duplicateTasksToRemove.length} older duplicate failed/cancelled task${duplicateTasksToRemove.length !== 1 ? 's' : ''}, keeping the most recent per file + type`}
              onClick={handleRemoveDuplicates}
            >
              <Trash2 className={compactToolbarIconClass} />
              Remove Duplicates
            </Button>
          )}

          {onRefresh && (
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8 shrink-0 sm:h-9 sm:w-9'
              title='Refresh'
              aria-label='Refresh tasks'
              onClick={async () => {
                setIsRefreshing(true)
                try {
                  await onRefresh(activeFilter)
                } finally {
                  window.setTimeout(() => setIsRefreshing(false), 600)
                }
              }}
            >
              <RefreshCw className={cn(compactToolbarIconClass, (isRefreshing || isLoading) && 'animate-spin')} aria-hidden />
            </Button>
          )}

          <Button
            variant='outline'
            size='sm'
            className={cn(compactToolbarButtonClass, 'shrink-0')}
            onClick={() => isGloballyPaused ? globalUnpause() : globalPause()}
            title={isGloballyPaused ? 'Resume all queued and processing tasks' : 'Pause all queued and processing tasks'}
          >
            {isGloballyPaused ? (
              <>
                <Play className={compactToolbarIconClass} />
                Resume All
              </>
            ) : (
              <>
                <Pause className={compactToolbarIconClass} />
                Pause All
              </>
            )}
          </Button>

          {activeFilter !== 'queued' && (
            <TaskSorting
              isSortDropdownOpen={isSortDropdownOpen}
              setIsSortDropdownOpen={setIsSortDropdownOpen}
              sortField={sortField}
              setSortField={setSortField}
              sortDirection={sortDirection}
              setSortDirection={setSortDirection}
            />
          )}

          <TaskFilterDialog
            isFilterActive={isFilterActive}
            isOpen={isFilterDialogOpen}
            setIsOpen={setIsFilterDialogOpen}
            taskTypeFilter={draftFilters.taskType}
            setTaskTypeFilter={(v) => setDraftFilters(prev => ({ ...prev, taskType: v }))}
            dateRangeFilter={draftFilters.dateRange}
            setDateRangeFilter={(v) => setDraftFilters(prev => ({ ...prev, dateRange: v }))}
            subtitleLanguageFilter={draftFilters.subtitleLanguage}
            setSubtitleLanguageFilter={(v) => setDraftFilters(prev => ({ ...prev, subtitleLanguage: v }))}
            sceneDetectorFilter={draftFilters.sceneDetector}
            setSceneDetectorFilter={(v) => setDraftFilters(prev => ({ ...prev, sceneDetector: v }))}
            taskDirectoryIds={draftFilters.selectedDirectoryIds}
            setTaskDirectoryIds={(v) => setDraftFilters(prev => ({ ...prev, selectedDirectoryIds: v }))}
            directoryExclude={draftFilters.directoryExclude}
            setDirectoryExclude={(v) => setDraftFilters(prev => ({ ...prev, directoryExclude: v }))}
            availableLanguages={availableLanguages}
            availableDetectors={availableDetectors}
            directories={directories}
            onApply={handleApplyFilters}
            onReset={handleResetFilters}
          />
        </div>

        <div className='relative col-span-2 w-full shrink-0 sm:w-72 lg:col-span-1'>
          <Search
            className='pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground sm:left-3 sm:size-4'
            aria-hidden
          />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder='Search by video name…'
            className='h-8 pl-8 pr-8 text-xs focus-visible:ring-offset-0 sm:h-10 sm:pl-9 sm:pr-9 sm:text-sm'
            aria-label='Search tasks by video name'
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange?.('')}
              className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none sm:right-3 sm:h-4 sm:w-4"
              aria-label="Clear search"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          ) : null}
        </div>

      </div>

      {isGloballyPaused && (
        <div className='bg-amber-50 border border-amber-200 rounded-md p-3 mb-4 flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <AlertCircle className='h-4 w-4 text-amber-600' />
            <span className='text-sm text-amber-800'>Processing paused — click Resume All to continue</span>
          </div>
        </div>
      )}

      {activeFilter === 'queued' && (
        !estimatesReady ? (
          <Skeleton className='h-9 w-64' />
        ) : queuedEstimates.hasAny ? (
          <div className='flex items-center gap-2 rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground'>
            <Clock className='h-4 w-4 shrink-0' />
            <span>
              Estimated total: <span className='font-medium text-foreground'>{formatEtaSeconds(queuedEstimates.total)}</span>
              {totalCount !== undefined && totalCount > paginatedTasks.length && (
                <span className='ml-1'>(this page only)</span>
              )}
            </span>
          </div>
        ) : null
      )}

      {selectedIds.size > 0 && (
        <div className='flex max-h-40 shrink-0 flex-wrap items-center gap-3 overflow-y-auto rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 sm:max-h-none sm:overflow-visible'>
          <Checkbox
            checked={allFilteredSelected}
            onCheckedChange={toggleSelectAll}
            aria-label='Select all filtered tasks'
            className='shrink-0'
          />
          <span className='text-sm font-medium'>{selectedIds.size} selected</span>
          <button
            type='button'
            className='text-xs text-muted-foreground hover:text-foreground underline underline-offset-2'
            onClick={toggleSelectAll}
          >
            {allFilteredSelected ? 'Deselect all' : 'Select all'}
          </button>
          <div className='flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto'>
            {activeFilter !== 'cancelled' && (
              <>
                <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' disabled={cancellableTasks.length === 0} onClick={handleBulkCancel}>
                  <CircleX className='h-3.5 w-3.5' />
                  Cancel
                </Button>
                <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' disabled={pausableTasks.length === 0} onClick={handleBulkPause}>
                  <Pause className='h-3.5 w-3.5' />
                  Pause
                </Button>
                <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' disabled={unpausableTasks.length === 0} onClick={handleBulkUnpause}>
                  <Play className='h-3.5 w-3.5' />
                  Unpause
                </Button>
                {activeFilter === 'queued' && onMoveToTop && (
                  <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' disabled={selectedTasks.filter(t => t.status === 'queued').length === 0} onClick={() => onMoveToTop(selectedTasks.filter(t => t.status === 'queued').map(t => t.id))}>
                    <ChevronsUp className='h-3.5 w-3.5' />
                    Move to Top
                  </Button>
                )}
                {activeFilter === 'queued' && onMoveToBottom && (
                  <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' disabled={selectedTasks.filter(t => t.status === 'queued').length === 0} onClick={() => onMoveToBottom(selectedTasks.filter(t => t.status === 'queued').map(t => t.id))}>
                    <ChevronsDown className='h-3.5 w-3.5' />
                    Move to Bottom
                  </Button>
                )}
              </>
            )}
            <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' disabled={rerunableTasks.length === 0} onClick={handleBulkRerun}>
              <RefreshCw className='h-3.5 w-3.5' />
              Rerun
            </Button>
            <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs text-destructive hover:text-destructive' disabled={deletableTasks.length === 0} onClick={handleBulkDelete}>
              <Trash2 className='h-3.5 w-3.5' />
              Delete
            </Button>
            {activeFilter !== 'cancelled' && (
              <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' disabled={editableTasks.length === 0} onClick={handleBulkEdit}>
                <Pencil className='h-3.5 w-3.5' />
                Edit
              </Button>
            )}
            {splitDisableable.length > 0 && (
              <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' onClick={() => handleBulkDisable('split')}>
                <Scissors className='h-3.5 w-3.5' />
                Disable from Split
              </Button>
            )}
            {subtitleDisableable.length > 0 && (
              <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' onClick={() => handleBulkDisable('subtitle')}>
                <Ban className='h-3.5 w-3.5' />
                Disable from Subtitle
              </Button>
            )}
            {splitEnableable.length > 0 && (
              <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' onClick={() => handleBulkEnable('split')}>
                Enable for Split
              </Button>
            )}
            {subtitleEnableable.length > 0 && (
              <Button size='sm' variant='outline' className='h-8 gap-1.5 text-xs' onClick={() => handleBulkEnable('subtitle')}>
                Enable for Subtitle
              </Button>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div
          className={cn(
            'grid gap-2 overflow-y-auto pr-1 scrollbar sm:pr-2',
            activeFilter === 'queued' ? 'grid-cols-1 1921:grid-cols-2' : 'grid-cols-1'
          )}
        >
          {Array.from({ length: pageSize }).map((_, i) => (
            <div key={`skeleton-${i}`} className='rounded-lg border border-border p-4 space-y-3'>
              <div className='flex items-start justify-between'>
                <div className='flex-1 space-y-2'>
                  <Skeleton className='h-4 w-2/3' />
                  <Skeleton className='h-3 w-1/2' />
                </div>
                <Skeleton className='h-8 w-8 rounded' />
              </div>
              <div className='space-y-2'>
                <Skeleton className='h-3 w-full' />
                <Skeleton className='h-3 w-5/6' />
              </div>
              <div className='flex gap-2 pt-2'>
                <Skeleton className='h-6 w-16 rounded-full' />
                <Skeleton className='h-6 w-16 rounded-full' />
              </div>
            </div>
          ))}
        </div>
      ) : filteredTasks.length > 0 ? (
        <div
          className={cn(
            'grid gap-2 overflow-y-auto pr-1 scrollbar sm:pr-2',
            activeFilter === 'queued' ? 'grid-cols-1 1921:grid-cols-2' : 'grid-cols-1'
          )}
        >
          {paginatedTasks.map((task, index) => {
            const pageOffset = (currentPage - 1) * pageSize;
            const queuePosition = activeFilter === 'queued' && task.status === 'queued' ? pageOffset + index + 1 : undefined;
            return (
              <div
                key={task.id}
                ref={(el) => { if (el) taskRefsMap.current[task.id] = el; else delete taskRefsMap.current[task.id]; }}
                style={{ animationDelay: `${index * 50}ms` }}
                className={cn(highlightTaskId === task.id && 'animate-highlight-flash')}
                tabIndex={-1}
              >
                <TaskCard task={task} isSelected={selectedIds.has(task.id)} onSelect={toggleSelect} onCancelTask={onCancelTask} onDeleteTask={onDeleteTask} onRerunTask={onRerunTask} onEditTask={onEditTask} onPauseTask={onPauseTask ? handlePauseWithConfirm : undefined} onUnpauseTask={onUnpauseTask} onMoveToTop={onMoveToTop ? (id) => onMoveToTop([id]) : undefined} onMoveToBottom={onMoveToBottom ? (id) => onMoveToBottom([id]) : undefined} onToggleTaskTypeDisabled={onToggleTaskTypeDisabled} queuePosition={queuePosition} estimatedSeconds={queuedEstimates.perTask.get(task.id)} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className='flex min-h-96 flex-1 flex-col items-center justify-center text-center'>
          <ListFilter className='w-12 h-12 text-muted-foreground/30 mb-3' />
          <p className='text-muted-foreground'>
            {searchQuery ? 'No tasks match your search' : 'No tasks found'}
          </p>
          {emptyHint ? <p className='text-sm text-muted-foreground/70'>{emptyHint}</p> : null}
        </div>
      )}

      {totalPages >= 1 && (
        <div className='grid flex-none shrink-0 grid-cols-1 items-center gap-1.5 pt-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-2'>
            <div className='hidden items-center gap-1.5 sm:flex sm:gap-2'>
              <span className='text-xs text-muted-foreground whitespace-nowrap sm:text-sm'>Per page:</span>
              <Select value={String(pageSize)} onValueChange={val => { onPageSizeChange(Number(val)); onPageChange(1) }}>
                <SelectTrigger className='h-8 w-[68px] text-xs sm:h-[32px] sm:w-[72px] sm:text-sm'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className='min-w-0 w-[68px] sm:w-[72px]'>
                  {[10, 25, 50, 100, 250, 500, 1000].map(n => (
                    <SelectItem key={n} value={String(n)} className='pl-2 text-xs sm:text-sm [&>span:first-child]:hidden'>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          <div className='scrollbar -mx-1 flex min-w-0 max-w-full items-center justify-center gap-1.5 overflow-x-auto px-1 sm:mx-0 sm:justify-self-center sm:gap-2 sm:px-0'>
            <button
              onClick={() => onPageChange(1)}
              className={cn(compactPageButtonClass, `p-1.5 sm:p-2 ${currentPage === 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`)}
              disabled={currentPage === 1}
              aria-label='First page'
            >
              <ChevronFirst className={compactPageIconClass} />
            </button>

            <button
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className={cn(compactPageButtonClass, `p-1.5 sm:p-2 ${currentPage === 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`)}
              disabled={currentPage === 1}
              aria-label='Previous page'
            >
              <ChevronLeft className={compactPageIconClass} />
            </button>

            {(() => {
              const maxVisiblePages = 5
              let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2))
              let endPage = startPage + maxVisiblePages - 1
              if (endPage > totalPages) {
                startPage = Math.max(1, totalPages - maxVisiblePages + 1)
                endPage = totalPages
              }
              const pages = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i)
              return (
                <>
                  {startPage > 1 && (
                    <>
                      <button onClick={() => onPageChange(1)} className={cn(compactPageButtonClass, 'bg-transparent px-2 py-1 hover:bg-muted sm:px-3 sm:py-1.5')}>1</button>
                      {startPage > 2 && <span className='px-2 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm'>...</span>}
                    </>
                  )}
                  {pages.map(page => (
                    <button
                      key={page}
                      onClick={() => onPageChange(page)}
                      className={cn(compactPageButtonClass, `px-2 py-1 sm:px-3 sm:py-1.5 ${currentPage === page ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`)}
                    >
                      {page}
                    </button>
                  ))}
                  {endPage < totalPages && (
                    <>
                      {endPage < totalPages - 1 && <span className='px-2 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm'>...</span>}
                      <button onClick={() => onPageChange(totalPages)} className={cn(compactPageButtonClass, 'bg-transparent px-2 py-1 hover:bg-muted sm:px-3 sm:py-1.5')}>{totalPages}</button>
                    </>
                  )}
                </>
              )
            })()}

            <button
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              className={cn(compactPageButtonClass, `p-1.5 sm:p-2 ${currentPage === totalPages ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`)}
              disabled={currentPage === totalPages}
              aria-label='Next page'
            >
              <ChevronRight className={compactPageIconClass} />
            </button>

            <button
              onClick={() => onPageChange(totalPages)}
              className={cn(compactPageButtonClass, `p-1.5 sm:p-2 ${currentPage === totalPages ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`)}
              disabled={currentPage === totalPages}
              aria-label='Last page'
            >
              <ChevronLast className={compactPageIconClass} />
            </button>
          </div>
          <div className='text-xs text-muted-foreground whitespace-nowrap text-center sm:text-right'>
            Showing {Math.min((currentPage - 1) * pageSize + 1, totalCount ?? filteredTasks.length)} – {Math.min(currentPage * pageSize, totalCount ?? filteredTasks.length)} of {totalCount ?? filteredTasks.length} tasks
          </div>
        </div>
      )}
      <AlertDialog open={!!pendingPauseTasks} onOpenChange={(open) => { if (!open) setPendingPauseTasks(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause {pendingPauseTasks && pendingPauseTasks.length > 1 ? `${pendingPauseTasks.length} tasks` : 'task'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPauseTasks && pendingPauseTasks.length === 1
                ? `"${pendingPauseTasks[0].file?.name ?? 'Merge Task'}" will be paused. You can resume it at any time.`
                : `${pendingPauseTasks?.length} tasks will be paused. You can resume them at any time.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmPause}>Pause</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {pauseProgress && (
        <BulkProgressDialog
          open
          total={pauseProgress.total}
          done={pauseProgress.done}
          runningTitle={`Pausing tasks… (${pauseProgress.done} / ${pauseProgress.total})`}
          doneTitle={`${pauseProgress.total} task${pauseProgress.total !== 1 ? 's' : ''} paused`}
          onClose={() => setPauseProgress(null)}
        />
      )}

      {unpauseProgress && (
        <BulkProgressDialog
          open
          total={unpauseProgress.total}
          done={unpauseProgress.done}
          runningTitle={`Unpausing tasks… (${unpauseProgress.done} / ${unpauseProgress.total})`}
          doneTitle={`${unpauseProgress.total} task${unpauseProgress.total !== 1 ? 's' : ''} unpaused`}
          onClose={() => setUnpauseProgress(null)}
        />
      )}
    </div>
  )
}
