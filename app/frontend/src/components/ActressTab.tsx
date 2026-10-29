import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Database, Download, ListOrdered, Loader2, Search, Star, User } from 'lucide-react'
import { toast } from 'sonner'
import { ActressDetail, ActressDownloadMonitor, ActressSummary, ActressWork, DownloadQueueItem, R18Status } from '@/types/types'
import {
  useR18ActressDetail,
  useR18ActressSearch,
  useR18ActressWorks,
  useR18ImportMutations,
  useR18Status,
} from '@/hooks/useR18'
import { useSettings } from '@/hooks/useSettings'
import { useQueue } from '@/hooks/useQueue'
import { r18Api } from '@/api/r18'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Skeleton } from './ui/skeleton'
import { Progress } from './ui/progress'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'
import { cn, localTimeToUtc, utcTimeToLocal } from '@/lib/utils'
import { ActressWorksPanel } from './ActressWorksPanel'
import { ActressWorkQueueDialog } from './ActressWorkQueueDialog'
import { ActressSchedulesDialog } from './ActressSchedulesDialog'
import { ActressWorksFilterState, EMPTY_ACTRESS_WORKS_FILTER_STATE, filterActressWorksByOpenedState } from '@/lib/actress-works-filters'
import { mergeSelectedWorks, toggleActressWorkSelection } from '@/lib/selected-works'
import { useDownloads } from '@/hooks/useDownloads'
import { formatActressName, useActressCustomNames } from '@/hooks/useActressCustomNames'

const PAGE_SIZE = 50
import { API_BASE } from '@/api/client'

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

function createMonitorId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `actress-monitor-${Date.now()}`
}

function ActressRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  )
}

function ActressGridSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-14 w-14 rounded-full shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  )
}

/**
 * Format byte counts for download progress labels.
 * @param bytes - Size in bytes
 * @returns Human-readable size (e.g. "1.2 GB")
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}

function ImportStatusBanner({ status }: { status: R18Status }) {
  const isDownloading = status.import_phase === 'downloading'
  const downloaded = status.download_bytes ?? 0
  const total = status.download_total
  const hasPercent = isDownloading && total != null && total > 0
  const percent = hasPercent ? Math.min(100, Math.round((downloaded / total) * 100)) : undefined

  const message = isDownloading
    ? total != null
      ? `Downloading latest dump from r18.dev (${formatBytes(downloaded)} / ${formatBytes(total)})`
      : `Downloading latest dump from r18.dev (${formatBytes(downloaded)} downloaded)`
    : 'Importing database — this may take 5–15 minutes'

  return (
    <div className="space-y-2 px-1">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        <span>{message}</span>
      </div>
      {isDownloading && hasPercent && (
        <Progress value={percent} className="h-2" aria-label={`Download progress ${percent}%`} />
      )}
    </div>
  )
}

function formatOptionalDateTime(value?: string | Date | null): string {
  if (!value) return 'Not scheduled'
  const date = value instanceof Date ? value : new Date(value)
  return date.toLocaleString()
}

interface R18AutoRefreshSectionProps {
  settings: Pick<
    ReturnType<typeof useSettings>['settings'],
    | 'r18_auto_refresh_enabled'
    | 'r18_auto_refresh_time'
    | 'r18_auto_refresh_day_of_week'
    | 'r18_auto_refresh_last_run'
    | 'r18_auto_refresh_next_run'
    | 'r18_auto_refresh_last_error'
  >
  onPatch: (updates: {
    r18_auto_refresh_enabled?: boolean
    r18_auto_refresh_time?: string | null
    r18_auto_refresh_day_of_week?: number | null
  }) => void
}

export function R18AutoRefreshSection({ settings, onPatch }: R18AutoRefreshSectionProps) {
  const [enabled, setEnabled] = useState(settings.r18_auto_refresh_enabled)
  const [time, setTime] = useState(utcTimeToLocal(settings.r18_auto_refresh_time ?? '09:00'))
  const [dayOfWeek, setDayOfWeek] = useState(settings.r18_auto_refresh_day_of_week ?? 1)

  useEffect(() => {
    setEnabled(settings.r18_auto_refresh_enabled)
    setTime(utcTimeToLocal(settings.r18_auto_refresh_time ?? '09:00'))
    setDayOfWeek(settings.r18_auto_refresh_day_of_week ?? 1)
  }, [
    settings.r18_auto_refresh_day_of_week,
    settings.r18_auto_refresh_enabled,
    settings.r18_auto_refresh_time,
  ])

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-medium">Weekly auto-refresh</p>
          <p className="text-sm text-muted-foreground">
            Automatically download and import the latest `r18.dev` dump every week.
          </p>
        </div>
        <Switch
          checked={enabled}
          aria-label="Enable weekly auto-refresh"
          onCheckedChange={(checked) => {
            setEnabled(checked)
            onPatch(
              checked
                ? {
                    r18_auto_refresh_enabled: true,
                    r18_auto_refresh_time: localTimeToUtc(time),
                    r18_auto_refresh_day_of_week: dayOfWeek,
                  }
                : { r18_auto_refresh_enabled: false },
            )
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="r18-auto-refresh-day">Weekly refresh day</Label>
          <Select
            value={String(dayOfWeek)}
            onValueChange={(value) => {
              const nextDay = Number(value)
              setDayOfWeek(nextDay)
              onPatch({ r18_auto_refresh_day_of_week: nextDay })
            }}
          >
            <SelectTrigger id="r18-auto-refresh-day" aria-label="Weekly refresh day">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS_OF_WEEK.map((day) => (
                <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="r18-auto-refresh-time">Weekly refresh time</Label>
          <Input
            id="r18-auto-refresh-time"
            type="time"
            value={time}
            onChange={(e) => {
              const nextTime = e.target.value
              setTime(nextTime)
              if (nextTime) {
                onPatch({ r18_auto_refresh_time: localTimeToUtc(nextTime) })
              }
            }}
          />
        </div>
      </div>

      <div className="space-y-1 text-sm text-muted-foreground">
        <p>Last run: {formatOptionalDateTime(settings.r18_auto_refresh_last_run)}</p>
        <p>Next run: {formatOptionalDateTime(settings.r18_auto_refresh_next_run)}</p>
      </div>
      {settings.r18_auto_refresh_last_error && (
        <p className="text-sm text-destructive">{settings.r18_auto_refresh_last_error}</p>
      )}
    </div>
  )
}

interface ActressScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  monitor?: ActressDownloadMonitor | null
  actressName?: string
  onSave: (patch: {
    interval: 'hourly' | 'daily' | 'weekly'
    time?: string
    dayOfWeek?: number
    maxItemsPerRun: number
    savePath?: string
    isActive: boolean
  }) => void
}

function ActressScheduleDialog({ open, onOpenChange, monitor, actressName, onSave }: ActressScheduleDialogProps) {
  const [interval, setInterval] = useState<'hourly' | 'daily' | 'weekly'>('daily')
  const [time, setTime] = useState('09:00')
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [maxItemsPerRun, setMaxItemsPerRun] = useState(25)
  const [savePath, setSavePath] = useState('')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    if (!open) return
    setInterval(monitor?.schedule.interval ?? 'daily')
    setTime(utcTimeToLocal(monitor?.schedule.time ?? '09:00'))
    setDayOfWeek(monitor?.schedule.dayOfWeek ?? 1)
    setMaxItemsPerRun(monitor?.maxItemsPerRun ?? 25)
    setSavePath(monitor?.savePath ?? '')
    setIsActive(monitor?.isActive ?? true)
  }, [monitor, open])

  const handleSave = () => {
    onSave({
      interval,
      time: interval !== 'hourly' ? localTimeToUtc(time) : undefined,
      dayOfWeek: interval === 'weekly' ? dayOfWeek : undefined,
      maxItemsPerRun: Math.max(1, maxItemsPerRun || 25),
      savePath: savePath.trim() || undefined,
      isActive,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{monitor ? 'Edit actress schedule' : 'Schedule actress downloads'}</DialogTitle>
          <DialogDescription>
            {actressName ? `Automatically queue matching works for ${actressName}.` : 'Automatically queue matching actress works.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Check interval</Label>
            <Select value={interval} onValueChange={(value) => setInterval(value as 'hourly' | 'daily' | 'weekly')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Hourly</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {interval !== 'hourly' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="actress-schedule-time">Time</Label>
                <Input id="actress-schedule-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              {interval === 'weekly' && (
                <div className="space-y-2">
                  <Label>Day</Label>
                  <Select value={String(dayOfWeek)} onValueChange={(value) => setDayOfWeek(Number(value))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS_OF_WEEK.map((day) => (
                        <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="actress-max-items">Max works per run</Label>
            <Input
              id="actress-max-items"
              type="number"
              min={1}
              max={500}
              value={maxItemsPerRun}
              onChange={(e) => setMaxItemsPerRun(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="actress-save-path">Default save path</Label>
            <Input
              id="actress-save-path"
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              placeholder="Use qBittorrent default"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Enable this schedule
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" onClick={handleSave}>{monitor ? 'Update schedule' : 'Create schedule'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ActressTabProps {
  onAddScraper?: (actressName: string) => void
}

export const ActressTab = ({ onAddScraper }: ActressTabProps) => {
  const selectedActressQueryKey = 'actress'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(() => {
    const value = Number(new URLSearchParams(window.location.search).get('page'))
    return Number.isInteger(value) && value >= 0 ? value : 0
  })
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const queryId = new URLSearchParams(window.location.search).get(selectedActressQueryKey)
    if (!queryId) return null
    const parsedId = Number(queryId)
    return Number.isInteger(parsedId) ? parsedId : null
  })
  const [worksPage, setWorksPage] = useState(() => {
    const value = Number(new URLSearchParams(window.location.search).get('worksPage'))
    return Number.isInteger(value) && value >= 1 ? value - 1 : 0
  })
  const [worksPageSize, setWorksPageSize] = useState(() => {
    const value = Number(new URLSearchParams(window.location.search).get('worksPageSize'))
    return [10, 15, 25, 50, 100, 250, 500, 1000].includes(value)
      ? value
      : window.innerWidth >= 1921 ? 50 : 25
  })
  const [worksSortBy, setWorksSortBy] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('worksSort')
    return value === 'id' || value === 'title' || value === 'date' ? value : 'date'
  })
  const [worksSortDir, setWorksSortDir] = useState(() => (
    new URLSearchParams(window.location.search).get('worksDir') === 'asc' ? 'asc' : 'desc'
  ))
  const [worksSearch, setWorksSearch] = useState('')
  const [worksFilter, setWorksFilter] = useState<ActressWorksFilterState>(EMPTY_ACTRESS_WORKS_FILTER_STATE)
  const [worksFilterDraft, setWorksFilterDraft] = useState<ActressWorksFilterState>(EMPTY_ACTRESS_WORKS_FILTER_STATE)
  const [importing, setImporting] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set())
  const [selectedWorks, setSelectedWorks] = useState<ActressWork[]>([])
  const [queueAllLoading, setQueueAllLoading] = useState(false)
  const [queueAllDialogOpen, setQueueAllDialogOpen] = useState(false)
  const [queueAllSavePath, setQueueAllSavePath] = useState('')
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false)
  const [searchResultsHidden, setSearchResultsHidden] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState<number[]>([])
  const [favoriteActresses, setFavoriteActresses] = useState<ActressSummary[]>([])
  const [favoriteActressesLoading, setFavoriteActressesLoading] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(() => (
    new URLSearchParams(window.location.search).get('favorites') === '1'
  ))
  const [actressMonitors, setActressMonitors] = useState<ActressDownloadMonitor[]>([])
  const [schedulesDialogOpen, setSchedulesDialogOpen] = useState(false)
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false)
  const [scheduleTarget, setScheduleTarget] = useState<ActressDetail | null>(null)
  const [editingSchedule, setEditingSchedule] = useState<ActressDownloadMonitor | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectionAnchorRef = useRef<string | null>(null)

  const { data: status } = useR18Status()
  const dbLoaded = Boolean(status?.loaded)

  const { data: searchResults, isLoading: searchLoading, isFetching } = useR18ActressSearch(
    searchQuery,
    page,
    PAGE_SIZE,
    dbLoaded
  )

  const { data: detail, isLoading: detailLoading } = useR18ActressDetail(selectedId, dbLoaded)
  const {
    data: worksResults,
    isLoading: worksLoading,
    isFetching: worksFetching,
  } = useR18ActressWorks(selectedId, worksPage, worksPageSize, dbLoaded, worksSortBy, worksSortDir, worksSearch, worksFilter)
  const { importFile, importLatest } = useR18ImportMutations()
  const { settings, patchSettings } = useSettings()
  const showCovers = settings.show_actress_work_covers
  const showTitles = settings.show_actress_work_titles ?? true
  const { items: queueItems, pendingCount, clearDone, clearFailed, refresh: refreshQueue } = useQueue()
  const downloadsMap = useDownloads(true)
  const { customNames: actressCustomNames, setCustomName: setCustomActressName } = useActressCustomNames()
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const isActressListLoading = (!favoritesOnly && (searchLoading || isFetching)) || (favoritesOnly && favoriteActressesLoading)
  const selectedActressMonitor = useMemo(
    () => detail ? actressMonitors.find((monitor) => monitor.actressId === detail.id) ?? null : null,
    [actressMonitors, detail]
  )
  const loadActressMonitors = useCallback(async () => {
    try {
      setActressMonitors(await r18Api.getActressDownloadMonitors())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load actress schedules')
    }
  }, [])

  useEffect(() => {
    void loadActressMonitors()
  }, [loadActressMonitors])

  useEffect(() => {
    let cancelled = false

    const loadFavorites = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings/actress-favorites`)
        if (!res.ok) throw new Error('Failed to fetch actress favorites')
        const data = await res.json() as { actress_ids?: number[] }
        if (!cancelled) {
          setFavoriteIds(Array.isArray(data.actress_ids) ? data.actress_ids : [])
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to fetch actress favorites')
        }
      }
    }

    void loadFavorites()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!favoritesOnly || !dbLoaded || favoriteIds.length === 0) {
      setFavoriteActresses([])
      setFavoriteActressesLoading(false)
      return () => {
        cancelled = true
      }
    }

    const loadFavoriteActresses = async () => {
      setFavoriteActressesLoading(true)
      const results = await Promise.allSettled(favoriteIds.map((id) => r18Api.getActress(id)))
      if (cancelled) return

      const items = results.flatMap((result) => {
        if (result.status !== 'fulfilled') return []
        const actress = result.value
        return [{
          id: actress.id,
          display_name: actress.display_name,
          name_romaji: actress.name_romaji,
          name_kanji: actress.name_kanji,
          name_kana: actress.name_kana,
          image_url: actress.image_url,
        }]
      })

      setFavoriteActresses(items)
      setFavoriteActressesLoading(false)
    }

    void loadFavoriteActresses()

    return () => {
      cancelled = true
    }
  }, [dbLoaded, favoriteIds, favoritesOnly])

  const updateFavorites = useCallback(async (nextFavoriteIds: number[]) => {
    const previousFavoriteIds = favoriteIds
    setFavoriteIds(nextFavoriteIds)
    try {
      const res = await fetch(`${API_BASE}/settings/actress-favorites`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actress_ids: nextFavoriteIds }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { detail?: string }).detail ?? 'Failed to update actress favorites')
      }
      const data = await res.json() as { actress_ids?: number[] }
      setFavoriteIds(Array.isArray(data.actress_ids) ? data.actress_ids : nextFavoriteIds)
    } catch (err) {
      setFavoriteIds(previousFavoriteIds)
      toast.error(err instanceof Error ? err.message : 'Failed to update actress favorites')
    }
  }, [favoriteIds])

  const toggleFavorite = useCallback((actressId: number) => {
    const nextFavoriteIds = favoriteSet.has(actressId)
      ? favoriteIds.filter((id) => id !== actressId)
      : [...favoriteIds, actressId]
    void updateFavorites(nextFavoriteIds)
  }, [favoriteIds, favoriteSet, updateFavorites])

  const visibleActresses = useMemo(() => {
    const items = favoritesOnly ? favoriteActresses : (searchResults?.items ?? [])
    const searchNeedle = searchQuery.trim().toLowerCase()
    const filtered = items.filter((actress) => {
      if (!favoritesOnly) return true
      if (!searchNeedle) return true
      return [
        actress.display_name,
        actress.name_romaji,
        actress.name_kanji,
        actress.name_kana,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(searchNeedle))
    })
    return [...filtered].sort((a, b) => {
      const favoriteDelta = Number(favoriteSet.has(b.id)) - Number(favoriteSet.has(a.id))
      if (favoriteDelta !== 0) return favoriteDelta
      return formatActressName(a, actressCustomNames).localeCompare(formatActressName(b, actressCustomNames))
    })
  }, [actressCustomNames, favoriteActresses, favoriteSet, favoritesOnly, searchQuery, searchResults])

  const handleToggleSelect = useCallback((work: ActressWork, shiftKey = false) => {
    const visibleWorks = worksResults?.items ?? []
    const next = toggleActressWorkSelection(selectedCodes, selectedWorks, visibleWorks, work, {
      shiftKey,
      anchorContentId: selectionAnchorRef.current,
    })
    selectionAnchorRef.current = next.nextAnchorContentId
    setSelectedCodes(next.nextSelectedCodes)
    setSelectedWorks(next.nextSelectedWorks)
  }, [selectedCodes, selectedWorks, worksResults?.items])

  const clearSelectedWorks = useCallback(() => {
    setSelectedCodes(new Set())
    setSelectedWorks([])
    selectionAnchorRef.current = null
  }, [])

  const handleWorksPageChange = useCallback((page: number) => {
    clearSelectedWorks()
    setWorksPage(page)
  }, [clearSelectedWorks])

  const handleEnqueue = useCallback(async (
    items: { content_id: string; video_code: string }[],
    options?: { silent?: boolean; savePath?: string }
  ) => {
    try {
      const result = await r18Api.enqueueWorks(items, options?.savePath)
      if (!options?.silent) {
        toast.success(`Queued ${result.queued} works${result.skipped > 0 ? ` (${result.skipped} skipped)` : ''}`)
      }
      setSelectedCodes(new Set())
      setSelectedWorks([])
      selectionAnchorRef.current = null
      refreshQueue()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to enqueue')
    }
  }, [refreshQueue])

  const openCreateSchedule = useCallback((target: ActressDetail) => {
    setScheduleTarget(target)
    setEditingSchedule(null)
    setScheduleEditorOpen(true)
  }, [])

  const handleSaveSchedule = useCallback(async (patch: {
    interval: 'hourly' | 'daily' | 'weekly'
    time?: string
    dayOfWeek?: number
    maxItemsPerRun: number
    savePath?: string
    isActive: boolean
  }) => {
    try {
      if (editingSchedule) {
        const updated = await r18Api.updateActressDownloadMonitor({
          ...editingSchedule,
          schedule: {
            interval: patch.interval,
            time: patch.time,
            dayOfWeek: patch.dayOfWeek,
          },
          maxItemsPerRun: patch.maxItemsPerRun,
          savePath: patch.savePath,
          isActive: patch.isActive,
        })
        setActressMonitors((prev) => prev.map((monitor) => monitor.id === updated.id ? updated : monitor))
        toast.success('Updated actress schedule')
      } else if (scheduleTarget) {
        const name = formatActressName(scheduleTarget, actressCustomNames)
        const created = await r18Api.createActressDownloadMonitor({
          id: createMonitorId(),
          actressId: scheduleTarget.id,
          actressName: name,
          schedule: {
            interval: patch.interval,
            time: patch.time,
            dayOfWeek: patch.dayOfWeek,
          },
          isActive: patch.isActive,
            criteria: {
              search: worksSearch,
              sortBy: worksSortBy,
              sortDir: worksSortDir,
              fileExists: worksFilter.fileExists,
              localFileState: worksFilter.localFileStatus,
              uncensored: worksFilter.uncensored,
              censored: worksFilter.censored,
              subtitled: worksFilter.subtitled,
              resolution: worksFilter.resolution,
              releaseYear: worksFilter.releaseYear,
            },
          maxItemsPerRun: patch.maxItemsPerRun,
          savePath: patch.savePath,
          lastRun: null,
          nextRun: null,
          lastQueued: 0,
          lastSkipped: 0,
          lastError: null,
          createdAt: new Date(),
        })
        setActressMonitors((prev) => [created, ...prev])
        toast.success(`Scheduled downloads for ${name}`)
      }
      setScheduleEditorOpen(false)
      setEditingSchedule(null)
      setScheduleTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save actress schedule')
    }
  }, [actressCustomNames, editingSchedule, scheduleTarget, worksFilter, worksSearch, worksSortBy, worksSortDir])

  const handleRunSchedule = useCallback(async (monitor: ActressDownloadMonitor) => {
    try {
      const result = await r18Api.runActressDownloadMonitor(monitor.id)
      toast.success(`Queued ${result.queued} works${result.skipped > 0 ? ` (${result.skipped} skipped)` : ''}`)
      await loadActressMonitors()
      refreshQueue()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run actress schedule')
    }
  }, [loadActressMonitors, refreshQueue])

  const handleToggleSchedule = useCallback(async (monitor: ActressDownloadMonitor) => {
    try {
      const updated = await r18Api.updateActressDownloadMonitor({ ...monitor, isActive: !monitor.isActive })
      setActressMonitors((prev) => prev.map((item) => item.id === updated.id ? updated : item))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update actress schedule')
    }
  }, [])

  const handleDeleteSchedule = useCallback(async (monitor: ActressDownloadMonitor) => {
    try {
      await r18Api.deleteActressDownloadMonitor(monitor.id)
      setActressMonitors((prev) => prev.filter((item) => item.id !== monitor.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete actress schedule')
    }
  }, [])

  const handleDeleteQueueItem = useCallback(async (item: DownloadQueueItem) => {
    try {
      await r18Api.deleteQueueItem(item.id)
      refreshQueue()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete queue item')
    }
  }, [refreshQueue])

  const handleDownloadAgain = useCallback(async (_contentId: string, videoCode: string, queueItemId: number) => {
    try {
      await r18Api.retryQueueItem(queueItemId)
      toast.success(`Re-queued ${videoCode}`)
      refreshQueue()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to re-queue')
    }
  }, [refreshQueue])

  const handleCancelDownload = useCallback(async (contentId: string) => {
    const queueItem = queueItems.find((q) => q.content_id === contentId)
    try {
      if (queueItem && (queueItem.status === 'pending' || queueItem.status === 'processing')) {
        await r18Api.deleteQueueItem(queueItem.id)
      } else {
        await r18Api.cancelDownload(contentId)
      }
      refreshQueue()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel download')
    }
  }, [queueItems, refreshQueue])

  const handleQueuePage = useCallback(async () => {
    if (!worksResults?.items) return
    const items = worksResults.items.map((w) => ({
      content_id: w.content_id,
      video_code: w.video_code ?? w.dvd_id ?? w.content_id,
    }))
    await handleEnqueue(items)
  }, [worksResults, handleEnqueue])

  const handleOpenQueueAll = useCallback(() => {
    setQueueAllSavePath(selectedActressMonitor?.savePath ?? '')
    setQueueAllDialogOpen(true)
  }, [selectedActressMonitor])

  const handleQueueAll = useCallback(async () => {
    if (!detail) return
    const savePath = queueAllSavePath.trim()
    if (!savePath) {
      toast.error('Please enter a save path')
      return
    }
    const pageSize = 200
    let skip = 0
    let total = 1
    setQueueAllLoading(true)
    setQueueAllDialogOpen(false)
    try {
      let queued = 0
      let skipped = 0
      while (skip < total) {
        const resp = await r18Api.getActressWorks(
          detail.id, skip, pageSize, worksSortBy, worksSortDir, worksSearch,
          { fileExists: worksFilter.fileExists, localFileStatus: worksFilter.localFileStatus, uncensored: worksFilter.uncensored, censored: worksFilter.censored, subtitled: worksFilter.subtitled, resolution: worksFilter.resolution, opened: worksFilter.opened, releaseYear: worksFilter.releaseYear }
        )
        total = resp.total
        const filteredItems = filterActressWorksByOpenedState(resp.items, worksFilter.opened)
        const items = filteredItems.map((w) => ({
          content_id: w.content_id,
          video_code: w.video_code ?? w.dvd_id ?? w.content_id,
        }))
        if (items.length > 0) {
          const result = await r18Api.enqueueWorks(items, savePath)
          queued += result.queued
          skipped += result.skipped
          refreshQueue()
        }
        skip += pageSize
        if (resp.items.length === 0) break
      }
      toast.success(`Queued ${queued} works${skipped > 0 ? ` (${skipped} skipped)` : ''}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to fetch all works')
    } finally {
      setQueueAllLoading(false)
    }
  }, [detail, queueAllSavePath, worksSortBy, worksSortDir, worksSearch, worksFilter, refreshQueue])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (selectedId === null) url.searchParams.delete(selectedActressQueryKey)
    else url.searchParams.set(selectedActressQueryKey, String(selectedId))
    if (favoritesOnly) url.searchParams.set('favorites', '1')
    else url.searchParams.delete('favorites')
    if (page > 0) url.searchParams.set('page', String(page))
    else url.searchParams.delete('page')
    url.searchParams.set('worksPage', String(worksPage + 1))
    url.searchParams.set('worksPageSize', String(worksPageSize))
    url.searchParams.set('worksSort', worksSortBy)
    url.searchParams.set('worksDir', worksSortDir)
    window.history.replaceState(window.history.state, '', url)
  }, [favoritesOnly, page, selectedId, worksPage, worksPageSize, worksSortBy, worksSortDir])

  useEffect(() => {
    clearSelectedWorks()
  }, [worksPage, clearSelectedWorks])

  useEffect(() => {
    if (worksLoading || worksFetching) {
      clearSelectedWorks()
    }
  }, [worksLoading, worksFetching, clearSelectedWorks])

  useEffect(() => {
    if (status?.import_in_progress) {
      setImporting(true)
    } else if (importing && status && !status.import_in_progress) {
      setImporting(false)
    }
  }, [status, importing])

  const handleSearchChange = (value: string) => {
    setSearchDraft(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value)
      setPage(0)
    }, 350)
  }

  const handleImportFile = async (file: File) => {
    if (!file.name.endsWith('.gz')) {
      toast.error('Please select a .sql.gz file')
      return
    }
    setImportDialogOpen(false)
    setImporting(true)
    try {
      await importFile.mutateAsync(file)
    } catch (err) {
      setImporting(false)
      toast.error(err instanceof Error ? err.message : 'Import failed')
    }
  }

  const handleImportLatest = async () => {
    setImportDialogOpen(false)
    setImporting(true)
    try {
      await importLatest.mutateAsync()
    } catch (err) {
      setImporting(false)
      toast.error(err instanceof Error ? err.message : 'Import failed')
    }
  }

  const totalPages = favoritesOnly ? 0 : (searchResults ? Math.ceil(searchResults.total / PAGE_SIZE) : 0)
  const worksTotalPages = worksResults ? Math.ceil(worksResults.total / worksPageSize) : 0
  const showEmpty = status && !status.loaded && !status.import_in_progress && !importing

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <div className="flex flex-col gap-2 shrink-0 sm:flex-row sm:items-center">
        <form
          className="relative flex-1 min-w-0 p-1 sm:min-w-[200px] sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault()
            if (debounceRef.current) clearTimeout(debounceRef.current)
            setSearchQuery(searchDraft)
            setPage(0)
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search actresses..."
            value={searchDraft}
            onChange={(e) => handleSearchChange(e.target.value)}
            disabled={!status?.loaded}
            aria-label="Search actresses"
          />
        </form>

        <div className="flex items-center gap-2 px-1 sm:px-0">
          {status?.loaded && (
            <Badge variant="secondary" className="h-8 gap-1 shrink-0">
              <User className="h-3 w-3" />
              {status.actress_count.toLocaleString()} loaded
            </Badge>
          )}

          <div className="ml-auto flex items-center gap-2 shrink-0 sm:hidden">
            <Button
              type="button"
              variant={favoritesOnly ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setFavoritesOnly((prev) => !prev)}
              disabled={!status?.loaded}
              aria-pressed={favoritesOnly}
              aria-label="Favorites only"
            >
              <Star className={cn('h-4 w-4', favoritesOnly && 'fill-current')} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              disabled={importing}
              onClick={() => setImportDialogOpen(true)}
              aria-label="Load r18.dev Dump"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative h-8 w-8"
              onClick={() => setSchedulesDialogOpen(true)}
              disabled={!status?.loaded}
              aria-label="Schedules"
            >
              <CalendarClock className="h-4 w-4" />
              {actressMonitors.length > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                  {actressMonitors.length}
                </span>
              )}
            </Button>
            <Button type="button" variant="outline" size="icon" className="relative h-8 w-8" onClick={() => setQueueDrawerOpen(true)} aria-label="Queue">
              <ListOrdered className="h-4 w-4" />
              {pendingCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 rounded-full bg-primary px-1 text-primary-foreground text-[10px] leading-none flex items-center justify-center">
                  {pendingCount > 999 ? '999+' : pendingCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".gz,.sql.gz"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImportFile(file)
            e.target.value = ''
          }}
        />

        <div className="ml-auto hidden items-center gap-2 shrink-0 pr-1 sm:flex">
          <Button
            type="button"
            variant={favoritesOnly ? 'default' : 'outline'}
            size="sm"
            className="gap-2"
            onClick={() => setFavoritesOnly((prev) => !prev)}
            disabled={!status?.loaded}
            aria-pressed={favoritesOnly}
          >
            <Star className={cn('h-4 w-4', favoritesOnly && 'fill-current')} />
            Favorites only
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={importing}
            onClick={() => setImportDialogOpen(true)}
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Load r18.dev Dump
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="relative gap-2"
            onClick={() => setSchedulesDialogOpen(true)}
            disabled={!status?.loaded}
          >
            <CalendarClock className="h-4 w-4" />
            Schedules
            {actressMonitors.length > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                {actressMonitors.length}
              </span>
            )}
          </Button>
          <Button type="button" variant="outline" size="sm" className="relative gap-1.5 text-xs" onClick={() => setQueueDrawerOpen(true)}>
            <ListOrdered className="h-4 w-4" />
            Queue
            {pendingCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 rounded-full bg-primary px-1 text-primary-foreground text-[10px] leading-none flex items-center justify-center">
                {pendingCount > 999 ? '999+' : pendingCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {(importing || status?.import_in_progress) && status && (
        <ImportStatusBanner status={status} />
      )}

      {showEmpty && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8 border border-dashed border-border rounded-lg">
          <Database className="h-12 w-12 text-muted-foreground" />
          <div>
            <p className="font-medium">No R18.dev database loaded</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              Import a gzipped SQL dump from{' '}
              <a href="https://r18.dev/dumps" target="_blank" rel="noreferrer" className="underline">
                r18.dev/dumps
              </a>{' '}
              or use Load r18.dev Dump to download automatically.
            </p>
          </div>
        </div>
      )}

      {status?.loaded && (
        <div className="flex-1 flex min-h-0 sm:gap-4">
          {!searchResultsHidden && (
            <div
              className={cn(
                'flex flex-col min-w-0 border border-border rounded-lg overflow-hidden shrink-0 transition-[width]',
                selectedId === null ? 'flex-1' : 'hidden sm:flex sm:w-[min(100%,280px)]'
              )}
            >
              <div className={cn('flex-1 overflow-y-auto scrollbar', selectedId === null && 'p-2 sm:p-4')}>
                {isActressListLoading ? (
                  selectedId === null ? (
                    <div className="grid grid-cols-1 gap-2 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {Array.from({ length: 8 }).map((_, i) => <ActressGridSkeleton key={i} />)}
                    </div>
                  ) : (
                    Array.from({ length: 8 }).map((_, i) => <ActressRowSkeleton key={i} />)
                  )
                ) : visibleActresses.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground text-center">
                    {favoritesOnly ? 'No favorite actresses match your search.' : 'No actresses match your search.'}
                  </p>
                ) : (
                  selectedId === null ? (
                    <div className="grid grid-cols-1 gap-2 sm:gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {visibleActresses.map((actress) => (
                        <div
                          key={actress.id}
                          onClick={() => setSelectedId(actress.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelectedId(actress.id)
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          className="group relative flex h-full flex-col rounded-lg border border-border bg-card p-3 pr-10 text-left transition-colors hover:bg-muted/40 sm:rounded-xl sm:p-4 sm:pr-12"
                        >
                          <button
                            type="button"
                            className="absolute right-4 top-4 rounded-full p-1 text-muted-foreground transition-colors hover:text-primary"
                            aria-label={`${favoriteSet.has(actress.id) ? 'Unfavorite' : 'Favorite'} ${formatActressName(actress, actressCustomNames)}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleFavorite(actress.id)
                            }}
                          >
                            <Star className={cn('h-4 w-4', favoriteSet.has(actress.id) && 'fill-current text-primary')} />
                          </button>
                          <div className="flex items-center gap-3">
                            {actress.image_url ? (
                              <img
                                src={actress.image_url}
                                alt=""
                                className="h-12 w-12 rounded-full object-cover shrink-0 bg-muted sm:h-14 sm:w-14"
                              />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted shrink-0 sm:h-14 sm:w-14">
                                <User className="h-6 w-6 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium" data-testid="actress-name">{formatActressName(actress, actressCustomNames)}</p>
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {[actress.name_kanji, actress.name_kana].filter(Boolean).join(' · ') || `ID ${actress.id}`}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    visibleActresses.map((actress) => (
                      <div
                        key={actress.id}
                        onClick={() => setSelectedId(actress.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelectedId(actress.id)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2 text-left border-b border-border hover:bg-muted/50 transition-colors',
                          selectedId === actress.id && 'bg-primary/10'
                        )}
                      >
                        {actress.image_url ? (
                          <img
                            src={actress.image_url}
                            alt=""
                            className="h-10 w-10 rounded-full object-cover shrink-0 bg-muted"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <User className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate" data-testid="actress-name">{formatActressName(actress, actressCustomNames)}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {[actress.name_kanji, actress.name_kana].filter(Boolean).join(' · ') || `ID ${actress.id}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="rounded-full p-1 text-muted-foreground transition-colors hover:text-primary"
                          aria-label={`${favoriteSet.has(actress.id) ? 'Unfavorite' : 'Favorite'} ${formatActressName(actress, actressCustomNames)}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFavorite(actress.id)
                          }}
                        >
                          <Star className={cn('h-4 w-4', favoriteSet.has(actress.id) && 'fill-current text-primary')} />
                        </button>
                      </div>
                    ))
                  )
                )}
              </div>

              {totalPages > 1 && (
                <div
                  className={cn(
                    'border-t border-border shrink-0',
                    selectedId === null
                      ? 'flex items-center justify-between px-3 py-2'
                      : 'flex items-center justify-between gap-2 px-2 py-2'
                  )}
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(selectedId !== null && 'px-2')}
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {selectedId === null ? 'Previous' : <ChevronLeft className="h-4 w-4" />}
                  </Button>
                  <span className="min-w-0 flex-1 text-center text-xs text-muted-foreground">
                    {selectedId === null ? `Page ${page + 1} of ${totalPages}` : `${page + 1}/${totalPages}`}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(selectedId !== null && 'px-2')}
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {selectedId === null ? 'Next' : <ChevronRight className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className={cn('relative min-w-0', selectedId === null ? 'hidden w-0 flex-none overflow-hidden sm:block' : 'flex-1', searchResultsHidden && 'sm:pl-4')}>
            <div className={cn('absolute top-1/2 z-20 hidden -translate-x-1/2 -translate-y-1/2 sm:block', searchResultsHidden ? 'left-4' : 'left-0')}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded-full bg-background shadow-sm"
                onClick={() => setSearchResultsHidden((prev) => !prev)}
                aria-label={searchResultsHidden ? 'Show search results' : 'Hide search results'}
              >
                {searchResultsHidden ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </Button>
            </div>
            <div className={cn('h-full border border-border rounded-lg overflow-hidden flex flex-col', selectedId === null && 'opacity-0 pointer-events-none')}>
              {selectedId === null ? (
                <div className="flex-1 flex items-center justify-center p-8">
                  <p className="text-sm text-muted-foreground">Select an actress to browse their works.</p>
                </div>
              ) : (
                <>
                  <div className="border-b border-border px-2 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 px-2"
                      onClick={() => setSelectedId(null)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Actresses
                    </Button>
                  </div>
                  <ActressWorksPanel
                    detail={detail}
                    detailLoading={detailLoading}
                    works={worksResults?.items}
                    worksTotal={worksResults?.total ?? 0}
                    worksLoading={worksLoading || worksFetching}
                    worksPage={worksPage}
                    worksTotalPages={worksTotalPages}
                    worksPageSize={worksPageSize}
                    showCovers={showCovers}
                    showTitles={showTitles}
                    sortBy={worksSortBy}
                    sortDir={worksSortDir}
                    selectedCodes={selectedCodes}
                    selectedWorks={selectedWorks}
                    onToggleSelect={handleToggleSelect}
                    onSelectAll={() => {
                      const nextWorks = worksResults?.items ?? []
                      setSelectedCodes((prev) => new Set([...prev, ...nextWorks.map((w) => w.content_id)]))
                      setSelectedWorks((prev) => mergeSelectedWorks(prev, nextWorks))
                    }}
                    onDeselectAll={clearSelectedWorks}
                    onQueuePage={() => void handleQueuePage()}
                    onQueue={() => {
                      const items = (worksResults?.items ?? [])
                        .filter((w) => selectedCodes.has(w.content_id))
                        .map((w) => ({ content_id: w.content_id, video_code: w.video_code ?? w.dvd_id ?? w.content_id }))
                      void handleEnqueue(items)
                    }}
                    onToggleCovers={(checked) => patchSettings({ show_actress_work_covers: checked })}
                    onToggleTitles={(checked) => patchSettings({ show_actress_work_titles: checked })}
                    onWorksPageChange={handleWorksPageChange}
                    onWorksPageSizeChange={setWorksPageSize}
                    onSortChange={(by, dir) => { setWorksSortBy(by); setWorksSortDir(dir) }}
                    search={worksSearch}
                    onSearchChange={(q) => { setWorksSearch(q); setWorksPage(0) }}
                    worksFilter={worksFilter}
                    worksFilterDraft={worksFilterDraft}
                    onWorksFilterDraftChange={(patch) => setWorksFilterDraft((prev) => ({ ...prev, ...patch }))}
                    onWorksFilterApply={() => { setWorksFilter(worksFilterDraft); setWorksPage(0) }}
                    onWorksFilterReset={() => {
                      setWorksFilter(EMPTY_ACTRESS_WORKS_FILTER_STATE)
                      setWorksFilterDraft(EMPTY_ACTRESS_WORKS_FILTER_STATE)
                      setWorksPage(0)
                    }}
                    queueItems={queueItems}
                    onDownloadAgain={(contentId, videoCode, queueItemId) => void handleDownloadAgain(contentId, videoCode, queueItemId)}
                    onQueueAll={handleOpenQueueAll}
                    queueAllLoading={queueAllLoading}
                    onCancelDownload={(contentId) => void handleCancelDownload(contentId)}
                    onScheduleActress={openCreateSchedule}
                    onAddScraper={onAddScraper}
                    actressName={detail ? formatActressName(detail, actressCustomNames) : undefined}
                    customActressName={detail ? actressCustomNames[detail.id] : undefined}
                    onCustomActressNameChange={setCustomActressName}
                    defaultSavePath={selectedActressMonitor?.savePath ?? null}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <ActressWorkQueueDialog
        open={queueDrawerOpen}
        onOpenChange={setQueueDrawerOpen}
        items={queueItems}
        downloadsMap={downloadsMap}
        onDeleteItem={handleDeleteQueueItem}
        onRetryItem={(item) => handleDownloadAgain(item.content_id, item.video_code, item.id)}
        onRefresh={refreshQueue}
      />
      <ActressSchedulesDialog
        open={schedulesDialogOpen}
        onOpenChange={setSchedulesDialogOpen}
        monitors={actressMonitors}
        onRun={(monitor) => void handleRunSchedule(monitor)}
        onEdit={(monitor) => {
          setEditingSchedule(monitor)
          setScheduleTarget(null)
          setScheduleEditorOpen(true)
        }}
        onToggle={(monitor) => void handleToggleSchedule(monitor)}
        onDelete={(monitor) => void handleDeleteSchedule(monitor)}
      />
      <ActressScheduleDialog
        open={scheduleEditorOpen}
        onOpenChange={(open) => {
          setScheduleEditorOpen(open)
          if (!open) {
            setEditingSchedule(null)
            setScheduleTarget(null)
          }
        }}
        monitor={editingSchedule}
        actressName={editingSchedule?.actressName ?? (scheduleTarget ? formatActressName(scheduleTarget, actressCustomNames) : undefined)}
        onSave={(patch) => void handleSaveSchedule(patch)}
      />
      <Dialog
        open={queueAllDialogOpen}
        onOpenChange={(open) => {
          setQueueAllDialogOpen(open)
          if (!open && !queueAllLoading) {
            setQueueAllSavePath(selectedActressMonitor?.savePath ?? '')
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Queue all works</DialogTitle>
            <DialogDescription>
              Enter the qBittorrent save path to use for every work in the current actress search and filter context.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="queue-all-save-path">Save path</Label>
            <Input
              id="queue-all-save-path"
              value={queueAllSavePath}
              onChange={(e) => setQueueAllSavePath(e.target.value)}
              placeholder="D:/Media/Downloads/Actress Name"
              disabled={queueAllLoading}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setQueueAllDialogOpen(false)}
              disabled={queueAllLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleQueueAll()}
              disabled={queueAllLoading || !queueAllSavePath.trim()}
            >
              {queueAllLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Queue All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Load r18.dev dump</DialogTitle>
            <DialogDescription>
              Choose whether to import a local dump file or download the latest dump from r18.dev.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <button
              type="button"
              className="group flex min-w-0 flex-col items-start gap-2 rounded-md border border-input bg-background px-4 py-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <Database className="h-4 w-4" />
                Import local dump
              </span>
              <span className="min-w-0 whitespace-normal break-words text-sm font-normal text-muted-foreground group-hover:text-accent-foreground">
                Pick a `.sql.gz` dump file from disk and import it into SceneWhisper.
              </span>
            </button>
            <button
              type="button"
              className="group flex min-w-0 flex-col items-start gap-2 rounded-md border border-input bg-background px-4 py-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
              disabled={importing}
              onClick={() => void handleImportLatest()}
            >
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <Download className="h-4 w-4" />
                Download latest dump
              </span>
              <span className="min-w-0 whitespace-normal break-words text-sm font-normal text-muted-foreground group-hover:text-accent-foreground">
                Fetch the current dump from `r18.dev` and start the import automatically.
              </span>
            </button>
          </div>
          <R18AutoRefreshSection
            settings={settings}
            onPatch={(updates) => patchSettings(updates)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
