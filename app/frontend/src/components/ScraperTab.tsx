import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Play, Plus, Search, SortAsc, Square, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { scraperApi, ScraperVideoFilters, ScraperVideoSortBy, ScraperVideoSortDir } from '@/api/scraper'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { normalizeScraperUrl, ScraperCard } from '@/components/ScraperCard'
import { ScraperBulkRunDialog } from '@/components/ScraperBulkRunDialog'
import { ScraperRunDialog, urlsForScraperSource } from '@/components/ScraperRunDialog'
import { ScraperAddEditDialog } from '@/components/ScraperAddEditDialog'
import { ScraperVideosDialog, ScraperVideoPageSize } from '@/components/ScraperVideosDialog'
import { useSettings } from '@/hooks/useSettings'
import { ScraperSource, ScraperTemplate } from '@/types/types'

type ScraperProgressEvent = {
  sourceId: string
  sourceName: string
  sourceUrl: string
  currentUrl: string
  pagesScraped: number
  totalPages: number
  progress: number
}

type ScraperProgressState = ScraperProgressEvent & {
  updatedAt: number
}

type FailedScraperWebsite = {
  source: ScraperSource
  url: string
}

const SOURCE_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
type SourcePageSize = typeof SOURCE_PAGE_SIZE_OPTIONS[number]
const SCRAPER_QUERY_STALE_TIME_MS = 60_000
type SourceSortField = 'name' | 'createdAt' | 'lastRun' | 'nextRun' | 'lastNew' | 'lastFound' | 'lastPagesScraped'

const SOURCE_SORT_OPTIONS: { value: SourceSortField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'createdAt', label: 'Date Created' },
  { value: 'lastRun', label: 'Last Run' },
  { value: 'nextRun', label: 'Next Run' },
  { value: 'lastNew', label: 'New' },
  { value: 'lastFound', label: 'Found' },
  { value: 'lastPagesScraped', label: 'Pages' },
]

function formatDate(value?: Date | null): string {
  return value ? value.toLocaleString() : 'Never'
}

function getTime(value?: Date | string | null): number {
  return value ? new Date(value).getTime() : 0
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function websiteBadgesForSource(source: ScraperSource, templates: ScraperTemplate[]): string[] {
  return urlsForScraperSource(source).map((url) => {
    const matchingTemplate = templates.find((template) => {
      const [prefix, suffix = ''] = template.url_template.split('{actress_name}')
      return url.startsWith(prefix) && (!suffix || url.endsWith(suffix))
    })
    try {
      return matchingTemplate?.label.trim() || new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return matchingTemplate?.label.trim() || url
    }
  }).filter((label): label is string => Boolean(label))
}

function scraperRunKey(sourceId: string, urls?: string[]): string {
  const normalizedUrls = urls
    ?.map((url) => normalizeScraperUrl(url))
    .filter(Boolean)
  return `${sourceId}:${normalizedUrls?.length ? normalizedUrls.join('|') : '*'}`
}

function isFailedWebsiteStat(source: ScraperSource, stat: NonNullable<ScraperSource['lastWebsiteStats']>[number]): boolean {
  if (stat.blocked) {
    return true
  }
  return Boolean(
    source.lastError
    && stat.pagesScraped === 0
    && stat.found === 0
    && stat.created === 0
    && stat.updated === 0
  )
}

function upsertScraperSource(sources: ScraperSource[] | undefined, updatedSource: ScraperSource): ScraperSource[] {
  const currentSources = sources ?? []
  const existingIndex = currentSources.findIndex((source) => source.id === updatedSource.id)
  if (existingIndex === -1) {
    return [...currentSources, updatedSource]
  }
  return currentSources.map((source, index) => (index === existingIndex ? updatedSource : source))
}

function ScraperCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-3/5" />
          <Skeleton className="h-4 w-2/5" />
        </div>
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>

      <div className="mt-4 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
      </div>
    </div>
  )
}

interface ScraperTabProps {
  requestedActressName?: string | null
  onRequestedActressNameHandled?: () => void
}

export function ScraperTab({
  requestedActressName = null,
  onRequestedActressNameHandled,
}: ScraperTabProps) {
  const queryClient = useQueryClient()
  const { settings } = useSettings()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null)
  const [editingWebsiteUrl, setEditingWebsiteUrl] = useState<string | null>(null)
  const [viewingSourceId, setViewingSourceId] = useState<string | null>(null)
  const [runningScraperRunKeys, setRunningScraperRunKeys] = useState<Set<string>>(() => new Set())
  const [sourceNameFilter, setSourceNameFilter] = useState('')
  const [sourcePage, setSourcePage] = useState(1)
  const [sourcePageSize, setSourcePageSize] = useState<SourcePageSize>(25)
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false)
  const [sourceSortField, setSourceSortField] = useState<SourceSortField>('name')
  const [sourceSortDirection, setSourceSortDirection] = useState<'asc' | 'desc'>('asc')
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [expandedWebsiteSourceIds, setExpandedWebsiteSourceIds] = useState<Set<string>>(() => new Set())
  const [isBulkScheduleOpen, setIsBulkScheduleOpen] = useState(false)
  const [bulkScheduleInterval, setBulkScheduleInterval] = useState<'hourly' | 'daily' | 'weekly'>('daily')
  const [bulkScheduleTime, setBulkScheduleTime] = useState('09:00')
  const [bulkScheduleDayOfWeek, setBulkScheduleDayOfWeek] = useState(1)
  const [isBulkRunOpen, setIsBulkRunOpen] = useState(false)
  const [showFailedOnly, setShowFailedOnly] = useState(false)
  const [runChoiceSourceId, setRunChoiceSourceId] = useState<string | null>(null)
  const [initialActressName, setInitialActressName] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [videoFilters, setVideoFilters] = useState<ScraperVideoFilters>({})
  const [videoPage, setVideoPage] = useState(1)
  const [videoPageSize, setVideoPageSize] = useState<ScraperVideoPageSize>(15)
  const [videoSortBy, setVideoSortBy] = useState<ScraperVideoSortBy>('video_code')
  const [videoSortDir, setVideoSortDir] = useState<ScraperVideoSortDir>('asc')
  const [isVideoTableRefreshing, setIsVideoTableRefreshing] = useState(false)

  const sourcesQuery = useQuery({
    queryKey: ['scraper', 'sources'],
    queryFn: scraperApi.getSources,
    staleTime: SCRAPER_QUERY_STALE_TIME_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const sources = sourcesQuery.data ?? []
  const failedWebsiteEntries = useMemo<FailedScraperWebsite[]>(() => {
    return sources.flatMap((source) => {
      const urls = urlsForScraperSource(source)
      const statsByUrl = new Map((source.lastWebsiteStats ?? []).map((stat) => [normalizeScraperUrl(stat.url), stat]))
      return urls
        .map((url, index) => {
          const normalizedUrl = normalizeScraperUrl(url)
          const stat = statsByUrl.get(normalizedUrl) ?? source.lastWebsiteStats?.[index]
          return stat && isFailedWebsiteStat(source, stat)
            ? { source, url: normalizedUrl || url }
            : null
        })
        .filter((entry): entry is FailedScraperWebsite => entry !== null)
    })
  }, [sources])
  const failedSourceIds = useMemo(() => new Set(failedWebsiteEntries.map((entry) => entry.source.id)), [failedWebsiteEntries])
  const failedWebsiteCount = failedWebsiteEntries.length
  const normalizedSourceNameFilter = sourceNameFilter.trim().toLowerCase()
  const nameFilteredSources = normalizedSourceNameFilter
    ? sources.filter((source) => source.name.toLowerCase().includes(normalizedSourceNameFilter))
    : sources
  const filteredSources = showFailedOnly
    ? nameFilteredSources.filter((source) => failedSourceIds.has(source.id))
    : nameFilteredSources
  const sourceSkeletonCount = Math.min(sourcePageSize, 50)
  const sortedSources = [...filteredSources].sort((a, b) => {
    const dir = sourceSortDirection === 'asc' ? 1 : -1
    if (sourceSortField === 'name') {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir
    }
    if (sourceSortField === 'createdAt' || sourceSortField === 'lastRun' || sourceSortField === 'nextRun') {
      return (getTime(a[sourceSortField]) - getTime(b[sourceSortField])) * dir
    }
    return (a[sourceSortField] - b[sourceSortField]) * dir
  })
  const validScraperTemplates = settings.scraper_templates.filter((template) => (
    template.label.trim() && template.url_template.trim().includes('{actress_name}')
  ))
  const sourceWebsiteLabels = useMemo(() => {
    const labelsBySourceId = new Map<string, string[]>()
    for (const source of sortedSources) {
      const urls = urlsForScraperSource(source)
      const websiteLabels = websiteBadgesForSource(source, validScraperTemplates)
      labelsBySourceId.set(
        source.id,
        urls.map((url, index) => websiteLabels[index] ?? hostnameFromUrl(url)),
      )
    }
    return labelsBySourceId
  }, [sortedSources, validScraperTemplates])
  const totalSourcePages = Math.max(1, Math.ceil(sortedSources.length / sourcePageSize))
  const pagedSources = sortedSources.slice((sourcePage - 1) * sourcePageSize, sourcePage * sourcePageSize)
  const expandableSourceIds = sortedSources
    .filter((source) => (sourceWebsiteLabels.get(source.id)?.length ?? 0) > 3)
    .map((source) => source.id)
  const hasExpandableSources = expandableSourceIds.length > 0
  const hasCollapsedExpandableSources = expandableSourceIds.some((sourceId) => !expandedWebsiteSourceIds.has(sourceId))
  const hasExpandedExpandableSources = expandableSourceIds.some((sourceId) => expandedWebsiteSourceIds.has(sourceId))
  const viewingSource = sources.find((source) => source.id === viewingSourceId) ?? null
  const editingBaseSource = sources.find((source) => source.id === editingSourceId) ?? null
  const editingSource = useMemo(() => {
    if (!editingBaseSource) {
      return null
    }
    if (!editingWebsiteUrl) {
      return editingBaseSource
    }
    return {
      ...editingBaseSource,
      url: editingWebsiteUrl,
      urls: [editingWebsiteUrl],
      urlActressNameReversed: [(editingBaseSource.urlActressNameReversed ?? [])[urlsForScraperSource(editingBaseSource).findIndex((url) => url === editingWebsiteUrl)] ?? false],
      schedule: { ...editingBaseSource.schedule },
    }
  }, [editingBaseSource, editingWebsiteUrl])
  const viewingWebsiteOptions = useMemo(() => (
    viewingSource
      ? Array.from(new Set(urlsForScraperSource(viewingSource).map(hostnameFromUrl).filter(Boolean)))
      : []
  ), [viewingSource])
  const runChoiceSource = sources.find((source) => source.id === runChoiceSourceId) ?? null
  const runningSourceIds = useMemo(() => (
    new Set([...runningScraperRunKeys].map((runKey) => runKey.split(':')[0]).filter(Boolean))
  ), [runningScraperRunKeys])
  const runningWebsiteUrlsBySource = useMemo(() => {
    const urlsBySourceId = new Map<string, Set<string>>()
    for (const source of sources) {
      const runningUrls = urlsForScraperSource(source)
        .map((url) => normalizeScraperUrl(url))
        .filter((url) => (
          runningScraperRunKeys.has(scraperRunKey(source.id, [url]))
        ))
      if (runningUrls.length > 0) {
        urlsBySourceId.set(source.id, new Set(runningUrls))
      }
    }
    return urlsBySourceId
  }, [runningScraperRunKeys, sources])
  const scraperProgressQuery = useQuery({
    queryKey: ['scraper', 'progress'],
    queryFn: scraperApi.getSourceProgress,
    refetchInterval: runningScraperRunKeys.size > 0 ? 1000 : false,
  })
  const scraperProgressBySource = useMemo(() => {
    const progressBySource = new Map<string, ScraperProgressState>()
    for (const progress of scraperProgressQuery.data ?? []) {
      progressBySource.set(progress.sourceId, {
        ...progress,
        updatedAt: Date.now(),
      })
    }
    return progressBySource
  }, [scraperProgressQuery.data])
  const selectedSources = sources.filter((source) => selectedSourceIds.has(source.id))
  const selectedSourceCount = selectedSources.length
  const hasSelectedSources = selectedSourceCount > 0
  const videosQuery = useQuery({
    queryKey: ['scraper', 'videos', viewingSourceId, search, videoFilters, videoPage, videoPageSize, viewingSource?.lastFound, videoSortBy, videoSortDir],
    queryFn: () => scraperApi.getVideos(viewingSourceId ?? undefined, search, videoPage, videoPageSize, search ? undefined : viewingSource?.lastFound, videoFilters, videoSortBy, videoSortDir),
    enabled: viewingSourceId !== null,
    placeholderData: keepPreviousData,
    staleTime: SCRAPER_QUERY_STALE_TIME_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const videos = videosQuery.data?.items ?? []
  const totalVideos = videosQuery.data?.total ?? 0
  const totalVideoPages = Math.max(1, Math.ceil(totalVideos / videoPageSize))

  useEffect(() => {
    if (viewingSourceId && videoPage > totalVideoPages) {
      setVideoPage(totalVideoPages)
    }
  }, [totalVideoPages, videoPage, viewingSourceId])

  useEffect(() => {
    if (!videosQuery.isFetching) {
      setIsVideoTableRefreshing(false)
    }
  }, [videosQuery.isFetching])

  useEffect(() => {
    if (videoFilters.website?.length) {
      const validWebsites = videoFilters.website.filter((website) => viewingWebsiteOptions.includes(website))
      if (validWebsites.length !== videoFilters.website.length) {
        setVideoFilters((prev) => ({
          ...prev,
          website: validWebsites.length > 0 ? validWebsites : null,
        }))
        setVideoPage(1)
      }
    }
  }, [videoFilters.website, viewingWebsiteOptions])

  useEffect(() => {
    if (sourcePage > totalSourcePages) {
      setSourcePage(totalSourcePages)
    }
  }, [sourcePage, totalSourcePages])

  useEffect(() => {
    setSelectedSourceIds((prev) => {
      const validIds = new Set(sources.map((source) => source.id))
      const next = new Set([...prev].filter((id) => validIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [sources])

  useEffect(() => {
    const actressName = requestedActressName?.trim()
    if (!actressName) {
      return
    }
    setInitialActressName(actressName)
    setEditingSourceId(null)
    setEditingWebsiteUrl(null)
    setIsAddOpen(true)
    onRequestedActressNameHandled?.()
  }, [onRequestedActressNameHandled, requestedActressName])

  const saveMutation = useMutation({
    mutationFn: scraperApi.createSource,
    onSuccess: (createdSource) => {
      toast.success('Scraper source saved')
      setIsAddOpen(false)
      queryClient.setQueryData<ScraperSource[]>(['scraper', 'sources'], (currentSources) => (
        upsertScraperSource(currentSources, createdSource)
      ))
      queryClient.invalidateQueries({ queryKey: ['scraper'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to save scraper source'),
  })

  const updateMutation = useMutation({
    mutationFn: scraperApi.updateSource,
    onSuccess: (updatedSource) => {
      toast.success('Scraper source saved')
      setEditingSourceId(null)
      setEditingWebsiteUrl(null)
      setIsAddOpen(false)
      queryClient.setQueryData<ScraperSource[]>(['scraper', 'sources'], (currentSources) => (
        upsertScraperSource(currentSources, updatedSource)
      ))
      queryClient.invalidateQueries({ queryKey: ['scraper'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to update scraper source'),
  })

  const deleteMutation = useMutation({
    mutationFn: scraperApi.deleteSource,
    onSuccess: () => {
      toast.success('Scraper source deleted')
      setViewingSourceId(null)
      queryClient.invalidateQueries({ queryKey: ['scraper'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to delete scraper source'),
  })

  const bulkActiveMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      await Promise.all(selectedSources.map((source) => scraperApi.updateSource({ ...source, isActive })))
    },
    onSuccess: (_result, isActive) => {
      toast.success(`${selectedSourceCount} scraper${selectedSourceCount === 1 ? '' : 's'} ${isActive ? 'enabled' : 'disabled'}`)
      queryClient.invalidateQueries({ queryKey: ['scraper'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to update selected scrapers'),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(selectedSources.map((source) => scraperApi.deleteSource(source.id)))
    },
    onSuccess: () => {
      toast.success(`${selectedSourceCount} scraper${selectedSourceCount === 1 ? '' : 's'} deleted`)
      setSelectedSourceIds(new Set())
      if (viewingSourceId && selectedSourceIds.has(viewingSourceId)) {
        setViewingSourceId(null)
      }
      queryClient.invalidateQueries({ queryKey: ['scraper'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to delete selected scrapers'),
  })

  const bulkScheduleMutation = useMutation({
    mutationFn: async () => {
      const schedule = {
        interval: bulkScheduleInterval,
        time: bulkScheduleInterval !== 'hourly' ? bulkScheduleTime : undefined,
        dayOfWeek: bulkScheduleInterval === 'weekly' ? bulkScheduleDayOfWeek : undefined,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
      await Promise.all(selectedSources.map((source) => (
        scraperApi.updateSource({
          ...source,
          schedule,
        })
      )))
    },
    onSuccess: () => {
      toast.success(`Schedule updated for ${selectedSourceCount} scraper${selectedSourceCount === 1 ? '' : 's'}`)
      setIsBulkScheduleOpen(false)
      queryClient.invalidateQueries({ queryKey: ['scraper'] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to update selected scraper schedules'),
  })

  const cancelRunMutation = useMutation({
    mutationFn: scraperApi.cancelSourceRun,
    onSuccess: (_result, sourceId) => {
      setRunningScraperRunKeys((prev) => {
        const next = new Set([...prev].filter((runKey) => runKey.split(':')[0] !== sourceId))
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['scraper'] })
      queryClient.invalidateQueries({ queryKey: ['scraper', 'progress'] })
      toast.success('Scraper cancelled')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to cancel scraper'),
  })

  const isBulkPending = bulkActiveMutation.isPending || bulkDeleteMutation.isPending || bulkScheduleMutation.isPending

  const openBulkScheduleEditor = () => {
    const source = selectedSources[0]
    if (!source) {
      return
    }
    setBulkScheduleInterval(source.schedule.interval)
    setBulkScheduleTime(source.schedule.time ?? '09:00')
    setBulkScheduleDayOfWeek(source.schedule.dayOfWeek ?? 1)
    setIsBulkScheduleOpen(true)
  }

  const runSource = async (source: ScraperSource, urls?: string[]) => {
    const runKey = scraperRunKey(source.id, urls)
    if (runningScraperRunKeys.has(runKey)) return
    setRunningScraperRunKeys((prev) => {
      const next = new Set(prev)
      next.add(runKey)
      return next
    })
    try {
      await scraperApi.runSource({ sourceId: source.id, urls })
      setRunChoiceSourceId(null)
      queryClient.invalidateQueries({ queryKey: ['scraper'] })
      queryClient.invalidateQueries({ queryKey: ['scraper', 'progress'] })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to run scraper')
    } finally {
      setRunningScraperRunKeys((prev) => {
        const next = new Set(prev)
        next.delete(runKey)
        return next
      })
    }
  }

  const handleCancelRun = async (source: ScraperSource) => {
    await cancelRunMutation.mutateAsync(source.id)
  }

  const handleRunClick = (source: ScraperSource) => {
    const urls = urlsForScraperSource(source)
    if (urls.length <= 1) {
      runSource(source)
      return
    }
    setRunChoiceSourceId(source.id)
  }

  const handleRunSelectedUrls = (source: ScraperSource, urls: string[]) => {
    if (urls.length === 0) {
      toast.error('Select at least one scraper website')
      return
    }
    runSource(source, urls)
  }

  const handleRunWebsite = (source: ScraperSource, url: string) => {
    handleRunSelectedUrls(source, [url])
  }

  const handleDeleteWebsite = (source: ScraperSource, url: string) => {
    const originalUrls = urlsForScraperSource(source)
    const websiteIndex = originalUrls.findIndex((currentUrl) => (
      normalizeScraperUrl(currentUrl) === normalizeScraperUrl(url)
    ))

    if (websiteIndex === -1) {
      toast.error('Scraper website not found')
      return
    }

    if (originalUrls.length <= 1) {
      deleteMutation.mutate(source.id)
      return
    }

    const nextUrls = originalUrls.filter((_, index) => index !== websiteIndex)
    const nextUrlActressNameReversed = (source.urlActressNameReversed ?? [])
      .filter((_, index) => index !== websiteIndex)

    updateMutation.mutate({
      ...source,
      url: nextUrls[0],
      urls: nextUrls,
      urlActressNameReversed: nextUrlActressNameReversed,
    })
  }

  const handleRunSelectedSources = () => {
    if (selectedSourceCount === 0) {
      return
    }
    setIsBulkRunOpen(true)
  }

  const handleBulkRunSelected = (selectedUrls: string[]) => {
    if (selectedUrls.length === 0) {
      toast.error('Select at least one scraper website')
      return
    }
    selectedSources.forEach((source) => {
      const sourceUrls = urlsForScraperSource(source)
      const urls = sourceUrls.filter((url) => selectedUrls.includes(url))
      if (urls.length === 0) {
        return
      }
      runSource(source, urls)
    })
  }

  const handleDialogOpenChange = (open: boolean) => {
    setIsAddOpen(open)
    if (!open) {
      setEditingSourceId(null)
      setEditingWebsiteUrl(null)
      setInitialActressName(null)
    }
  }

  const handleEdit = (source: ScraperSource) => {
    setEditingSourceId(source.id)
    setEditingWebsiteUrl(null)
    setIsAddOpen(true)
  }

  const handleEditWebsite = (source: ScraperSource, url: string) => {
    setEditingSourceId(source.id)
    setEditingWebsiteUrl(url)
    setIsAddOpen(true)
  }

  const handleUpdateSource = (updatedSource: ScraperSource) => {
    if (!editingBaseSource || !editingWebsiteUrl) {
      updateMutation.mutate(updatedSource)
      return
    }

    const originalUrls = urlsForScraperSource(editingBaseSource)
    const websiteIndex = originalUrls.findIndex((url) => url === editingWebsiteUrl)
    if (websiteIndex === -1) {
      updateMutation.mutate(updatedSource)
      return
    }

    const replacementUrl = urlsForScraperSource(updatedSource)[0]?.trim() || updatedSource.url.trim()
    if (!replacementUrl) {
      toast.error('Source URL is required')
      return
    }

    const nextUrls = [...originalUrls]
    nextUrls[websiteIndex] = replacementUrl
    const nextUrlActressNameReversed = [...(editingBaseSource.urlActressNameReversed ?? [])]
    if (nextUrlActressNameReversed.length < originalUrls.length) {
      nextUrlActressNameReversed.push(...Array(originalUrls.length - nextUrlActressNameReversed.length).fill(false))
    }
    nextUrlActressNameReversed[websiteIndex] = updatedSource.urlActressNameReversed?.[0] ?? false

    updateMutation.mutate({
      ...editingBaseSource,
      name: updatedSource.name,
      url: nextUrls[0],
      urls: nextUrls,
      urlActressNameReversed: nextUrlActressNameReversed,
      schedule: { ...updatedSource.schedule },
      isActive: updatedSource.isActive,
    })
  }

  const toggleSourceSelection = (sourceId: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) {
        next.delete(sourceId)
      } else {
        next.add(sourceId)
      }
      return next
    })
  }

  const handleSelectAllSources = () => {
    setSelectedSourceIds(new Set(filteredSources.map((source) => source.id)))
  }

  const handleSelectFailedSources = () => {
    setSelectedSourceIds(new Set(filteredSources.filter((source) => failedSourceIds.has(source.id)).map((source) => source.id)))
  }

  const handleRunFailedWebsites = () => {
    const failedUrlsBySourceId = new Map<string, string[]>()
    for (const entry of failedWebsiteEntries) {
      const urls = failedUrlsBySourceId.get(entry.source.id) ?? []
      urls.push(entry.url)
      failedUrlsBySourceId.set(entry.source.id, urls)
    }
    for (const source of sources) {
      const urls = failedUrlsBySourceId.get(source.id)
      if (urls?.length) {
        runSource(source, urls)
      }
    }
  }

  const handleDeselectAllSources = () => {
    setSelectedSourceIds(new Set())
  }
  const handleShowMoreBadgesChange = (sourceId: string, isShowingMore: boolean) => {
    setExpandedWebsiteSourceIds((current) => {
      const next = new Set(current)
      if (isShowingMore) {
        next.add(sourceId)
      } else {
        next.delete(sourceId)
      }
      return next
    })
  }
  const handleExpandAllShowMore = () => {
    setExpandedWebsiteSourceIds((current) => {
      const next = new Set(current)
      for (const sourceId of expandableSourceIds) {
        next.add(sourceId)
      }
      return next
    })
  }
  const handleCollapseAllShowMore = () => {
    setExpandedWebsiteSourceIds((current) => {
      const next = new Set(current)
      for (const sourceId of expandableSourceIds) {
        next.delete(sourceId)
      }
      return next
    })
  }

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 overflow-x-hidden">
      <div className="flex flex-col gap-2 p-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
        <Button type="button" size="sm" className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" onClick={() => { setEditingSourceId(null); setEditingWebsiteUrl(null); setInitialActressName(null); setIsAddOpen(true) }}>
          <Plus className="h-3.5 w-3.5 mr-1 sm:h-4 sm:w-4 sm:mr-2" />
          Add Scraper
        </Button>
        <Button
          type="button"
          size="sm"
          variant={showFailedOnly ? 'secondary' : 'outline'}
          className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
          onClick={() => {
            setShowFailedOnly((current) => !current)
            setSourcePage(1)
            if (!showFailedOnly) {
              setExpandedWebsiteSourceIds((current) => {
                const next = new Set(current)
                for (const sourceId of failedSourceIds) {
                  next.add(sourceId)
                }
                return next
              })
            }
          }}
          disabled={failedWebsiteCount === 0}
        >
          <AlertTriangle className="h-3.5 w-3.5 mr-1 sm:h-4 sm:w-4 sm:mr-2" />
          Failed {failedWebsiteCount}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
          onClick={handleRunFailedWebsites}
          disabled={failedWebsiteCount === 0 || isBulkPending}
        >
          <Play className="h-3.5 w-3.5 mr-1 sm:h-4 sm:w-4 sm:mr-2" />
          Run Failed
        </Button>
        <div className="inline-flex shrink-0 rounded-md shadow-sm">
          <DropdownMenu open={isSortDropdownOpen} onOpenChange={setIsSortDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-r-none border-r-0 px-2 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 sm:h-9 sm:px-3 sm:text-sm"
              >
                <SortAsc className="h-3.5 w-3.5 mr-1 sm:h-4 sm:w-4 sm:mr-2" />
                {SOURCE_SORT_OPTIONS.find((option) => option.value === sourceSortField)?.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {SOURCE_SORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  className="cursor-pointer"
                  onClick={() => {
                    setSourceSortField(option.value)
                    setSourcePage(1)
                    setIsSortDropdownOpen(false)
                  }}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setSourceSortDirection(sourceSortDirection === 'asc' ? 'desc' : 'asc')
              setSourcePage(1)
            }}
            className="h-8 rounded-l-none border-l-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
          >
            {sourceSortDirection === 'asc' ? (
              <>
                <span>↑</span>
                <span className="hidden sm:inline ml-1">Asc</span>
              </>
            ) : (
              <>
                <span>↓</span>
                <span className="hidden sm:inline ml-1">Desc</span>
              </>
            )}
          </Button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
            onClick={handleExpandAllShowMore}
            disabled={!hasExpandableSources || !hasCollapsedExpandableSources}
          >
            Expand All
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
            onClick={handleCollapseAllShowMore}
            disabled={!hasExpandableSources || !hasExpandedExpandableSources}
          >
            Collapse All
          </Button>
        </div>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground sm:left-3 sm:h-4 sm:w-4" />
          <Input
            value={sourceNameFilter}
            onChange={(event) => {
              setSourceNameFilter(event.target.value)
              setSourcePage(1)
            }}
            placeholder="Search scraper name"
            className="h-8 pl-8 text-xs sm:h-10 sm:pl-9 sm:text-sm"
            aria-label="Search scraper name"
          />
        </div>
      </div>

      {hasSelectedSources && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-2 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:px-3">
          <div className="text-xs text-muted-foreground whitespace-nowrap">
            {selectedSourceCount} selected
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              onClick={handleRunSelectedSources}
              disabled={isBulkPending}
            >
              <Play className="h-3.5 w-3.5 mr-1 sm:h-4 sm:w-4 sm:mr-2" />
              Run Selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              onClick={openBulkScheduleEditor}
              disabled={isBulkPending}
            >
              Edit Schedule
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              onClick={() => bulkActiveMutation.mutate(true)}
              disabled={isBulkPending}
            >
              <Check className="h-3.5 w-3.5 mr-1 sm:h-4 sm:w-4 sm:mr-2" />
              Enable Selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              onClick={() => bulkActiveMutation.mutate(false)}
              disabled={isBulkPending}
            >
              <X className="h-3.5 w-3.5 mr-1 sm:h-4 sm:w-4 sm:mr-2" />
              Disable Selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              onClick={handleSelectAllSources}
              disabled={filteredSources.length === 0 || isBulkPending}
            >
              Select All
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              onClick={handleSelectFailedSources}
              disabled={failedWebsiteCount === 0 || isBulkPending}
            >
              Select Failed
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              onClick={handleDeselectAllSources}
              disabled={isBulkPending}
            >
              Deselect All
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8 shrink-0 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              onClick={() => bulkDeleteMutation.mutate()}
              disabled={isBulkPending}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1 sm:h-4 sm:w-4 sm:mr-2" />
              Delete Selected
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(370px,1fr))] sm:gap-4">
          {sourcesQuery.isLoading
            ? Array.from({ length: sourceSkeletonCount }, (_, index) => (
              <ScraperCardSkeleton key={`scraper-source-skeleton-${index}`} />
            ))
            : pagedSources.map((source) => (
              <ScraperCard
                key={source.id}
                source={source}
                isSelected={selectedSourceIds.has(source.id)}
                websiteLabels={sourceWebsiteLabels.get(source.id) ?? []}
                websiteStats={source.lastWebsiteStats}
                showFailedWebsitesOnly={showFailedOnly}
                isRunning={runningSourceIds.has(source.id)}
                runningWebsiteUrls={runningWebsiteUrlsBySource.get(source.id) ?? new Set()}
                progress={scraperProgressBySource.get(source.id) ?? null}
                isShowingMoreBadges={expandedWebsiteSourceIds.has(source.id)}
                onToggleSelection={toggleSourceSelection}
                onToggleActive={(currentSource, checked) => updateMutation.mutate({ ...currentSource, isActive: checked })}
                onShowMoreBadgesChange={handleShowMoreBadgesChange}
                onEdit={handleEdit}
                onEditWebsite={handleEditWebsite}
                onDelete={(sourceId) => deleteMutation.mutate(sourceId)}
                onDeleteWebsite={handleDeleteWebsite}
                onRun={handleRunClick}
                onRunWebsite={handleRunWebsite}
                onCancelRun={handleCancelRun}
                onViewTable={(currentSource) => {
                  setSearch('')
                  setVideoFilters({})
                  setVideoPage(1)
                  setViewingSourceId(currentSource.id)
                }}
              />
            ))}
          {!sourcesQuery.isLoading && sources.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">No scraper sources yet.</div>
          )}
          {!sourcesQuery.isLoading && sources.length > 0 && filteredSources.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">No scraper sources match this search.</div>
          )}
        </div>
      </div>

      <div className="flex-none grid grid-cols-1 items-center gap-2 shrink-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-3">
        <div className="hidden items-center justify-center gap-2 text-xs text-muted-foreground sm:flex sm:justify-start sm:text-sm">
          <span>Per page:</span>
          <Select
            value={String(sourcePageSize)}
            onValueChange={(value) => {
              setSourcePageSize(Number(value) as SourcePageSize)
              setSourcePage(1)
            }}
          >
            <SelectTrigger className="h-8 w-[72px] text-xs sm:h-[40px] sm:w-[80px] sm:text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-0 w-[80px]">
              {SOURCE_PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)} className="pl-2 [&>span:first-child]:hidden">{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col items-center gap-1">
          <div className="flex max-w-full items-center justify-start gap-1 overflow-x-auto pb-1 sm:justify-center sm:gap-2 sm:overflow-visible sm:pb-0">
            <button
              onClick={() => setSourcePage(1)}
              className={`shrink-0 rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${sourcePage === 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
              disabled={sourcePage === 1}
              aria-label="First page"
            >
              <ChevronFirst className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            <button
              onClick={() => setSourcePage(Math.max(1, sourcePage - 1))}
              className={`shrink-0 rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${sourcePage === 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
              disabled={sourcePage === 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            {(() => {
              const maxVisiblePages = 5
              let startPage = Math.max(1, sourcePage - Math.floor(maxVisiblePages / 2))
              let endPage = startPage + maxVisiblePages - 1
              if (endPage > totalSourcePages) {
                startPage = Math.max(1, totalSourcePages - maxVisiblePages + 1)
                endPage = totalSourcePages
              }
              const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index)
              return (
                <>
                  {startPage > 1 && (
                    <>
                      <button onClick={() => setSourcePage(1)} className="shrink-0 rounded-md border bg-transparent px-2 py-1.5 text-xs font-medium hover:bg-muted sm:px-3 sm:text-sm">1</button>
                      {startPage > 2 && <span className="px-1.5 py-1.5 text-xs sm:px-3 sm:text-sm">...</span>}
                    </>
                  )}
                  {pageNumbers.map((pageNumber) => (
                    <button
                      key={pageNumber}
                      onClick={() => setSourcePage(pageNumber)}
                      className={`shrink-0 rounded-md border px-2 py-1.5 text-xs font-medium sm:px-3 sm:text-sm ${sourcePage === pageNumber ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`}
                    >
                      {pageNumber}
                    </button>
                  ))}
                  {endPage < totalSourcePages && (
                    <>
                      {endPage < totalSourcePages - 1 && <span className="px-1.5 py-1.5 text-xs sm:px-3 sm:text-sm">...</span>}
                      <button onClick={() => setSourcePage(totalSourcePages)} className="shrink-0 rounded-md border bg-transparent px-2 py-1.5 text-xs font-medium hover:bg-muted sm:px-3 sm:text-sm">{totalSourcePages}</button>
                    </>
                  )}
                </>
              )
            })()}

            <button
              onClick={() => setSourcePage(Math.min(totalSourcePages, sourcePage + 1))}
              className={`shrink-0 rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${sourcePage === totalSourcePages ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
              disabled={sourcePage === totalSourcePages}
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            <button
              onClick={() => setSourcePage(totalSourcePages)}
              className={`shrink-0 rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${sourcePage === totalSourcePages ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
              disabled={sourcePage === totalSourcePages}
              aria-label="Last page"
            >
              <ChevronLast className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          </div>
          <div className="text-xs text-muted-foreground whitespace-nowrap text-center">
            {filteredSources.length > 0
              ? `Showing ${Math.min((sourcePage - 1) * sourcePageSize + 1, filteredSources.length)} - ${Math.min(sourcePage * sourcePageSize, filteredSources.length)} of ${filteredSources.length} scrapers`
              : 'Showing 0 of 0 scrapers'}
          </div>
        </div>
        <div />
      </div>

      <Dialog open={isBulkScheduleOpen} onOpenChange={setIsBulkScheduleOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {selectedSourceCount} Scraper{selectedSourceCount === 1 ? '' : 's'}</DialogTitle>
            <DialogDescription>
              Apply one schedule to all selected scraper sources.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Interval</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['hourly', 'daily', 'weekly'] as const).map((interval) => (
                  <Button
                    key={interval}
                    type="button"
                    variant={bulkScheduleInterval === interval ? 'default' : 'outline'}
                    onClick={() => setBulkScheduleInterval(interval)}
                    className="capitalize"
                  >
                    {interval}
                  </Button>
                ))}
              </div>
            </div>
            {bulkScheduleInterval !== 'hourly' && (
              <div className={bulkScheduleInterval === 'weekly' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2' : 'space-y-2'}>
                <div className="space-y-2">
                  <Label htmlFor="bulk-scraper-schedule-time">Time (Local)</Label>
                  <Input
                    id="bulk-scraper-schedule-time"
                    type="time"
                    value={bulkScheduleTime}
                    onChange={(event) => setBulkScheduleTime(event.target.value)}
                  />
                </div>
                {bulkScheduleInterval === 'weekly' && (
                  <div className="space-y-2">
                    <Label htmlFor="bulk-scraper-schedule-day">Day of Week</Label>
                    <Select
                      value={String(bulkScheduleDayOfWeek)}
                      onValueChange={(value) => setBulkScheduleDayOfWeek(Number(value))}
                    >
                      <SelectTrigger id="bulk-scraper-schedule-day">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Sunday</SelectItem>
                        <SelectItem value="1">Monday</SelectItem>
                        <SelectItem value="2">Tuesday</SelectItem>
                        <SelectItem value="3">Wednesday</SelectItem>
                        <SelectItem value="4">Thursday</SelectItem>
                        <SelectItem value="5">Friday</SelectItem>
                        <SelectItem value="6">Saturday</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsBulkScheduleOpen(false)} disabled={bulkScheduleMutation.isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={() => bulkScheduleMutation.mutate()} disabled={bulkScheduleMutation.isPending}>
              {bulkScheduleMutation.isPending ? 'Saving...' : 'Apply Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ScraperAddEditDialog
        open={isAddOpen}
        editingSource={editingSource}
        validScraperTemplates={validScraperTemplates}
        singleWebsiteMode={editingWebsiteUrl !== null}
        initialActressName={initialActressName}
        isSaving={saveMutation.isPending || updateMutation.isPending}
        onOpenChange={handleDialogOpenChange}
        onCreate={(source) => saveMutation.mutate(source)}
        onUpdate={handleUpdateSource}
      />

      <ScraperBulkRunDialog
        open={isBulkRunOpen}
        sources={selectedSources}
        isRunning={isBulkPending}
        onOpenChange={setIsBulkRunOpen}
        onRun={handleBulkRunSelected}
      />

      <ScraperRunDialog
        source={runChoiceSource}
        isRunning={runChoiceSource !== null && runningSourceIds.has(runChoiceSource.id)}
        onOpenChange={(open) => {
          if (!open) {
            setRunChoiceSourceId(null)
          }
        }}
        onRun={handleRunSelectedUrls}
      />

      <ScraperVideosDialog
        open={viewingSourceId !== null}
        source={viewingSource}
        websiteOptions={viewingWebsiteOptions}
        videos={videos}
        isLoading={videosQuery.isLoading || isVideoTableRefreshing}
        isFetching={videosQuery.isFetching}
        search={search}
        page={videoPage}
        pageSize={videoPageSize}
        totalVideos={totalVideos}
        totalPages={totalVideoPages}
        filters={videoFilters}
        onOpenChange={(open) => { if (!open) setViewingSourceId(null) }}
        onSearchChange={(value) => {
          setIsVideoTableRefreshing(true)
          setSearch(value)
          setVideoPage(1)
        }}
        onFilterChange={(filters) => {
          setIsVideoTableRefreshing(true)
          setVideoFilters(filters)
          setVideoPage(1)
        }}
        onPageChange={(nextPage) => {
          setIsVideoTableRefreshing(true)
          setVideoPage(nextPage)
        }}
        onPageSizeChange={(value) => {
          setIsVideoTableRefreshing(true)
          setVideoPageSize(value)
          setVideoPage(1)
        }}
        onRefresh={() => {
          setIsVideoTableRefreshing(true)
          queryClient.invalidateQueries({ queryKey: ['scraper', 'videos'] })
        }}
        sortBy={videoSortBy}
        sortDir={videoSortDir}
        onSortByChange={(value) => {
          setIsVideoTableRefreshing(true)
          setVideoSortBy(value)
          setVideoPage(1)
        }}
        onSortDirChange={(value) => {
          setIsVideoTableRefreshing(true)
          setVideoSortDir(value)
          setVideoPage(1)
        }}
      />
    </div>
  )
}
