import { useMemo, useState } from 'react'
import { ChevronsDownUp, ChevronsUpDown, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, ExternalLink, Filter, RefreshCw, Search, SortAsc } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { scraperApi, ScraperVideoFilters, ScraperVideoSortBy, ScraperVideoSortDir } from '@/api/scraper'
import { activeScraperVideoFilterCount, ScraperVideosFilterDialog } from '@/components/ScraperVideosFilterDialog'
import { truncateAtWordBoundary } from '@/lib/truncate'
import { ScrapedVideo, ScraperSource } from '@/types/types'
import { useSettings } from '@/hooks/useSettings'
import { buildExternalVideoTargetUrl, isValidExternalVideoTarget } from '@/lib/external-video-targets'

const PAGE_SIZE_OPTIONS = [15, 25, 50, 100] as const
const TITLE_TRUNCATE_LENGTH = 50
const EXTERNAL_LINK_DELAY_MS = 100
const REFRESH_SPIN_MIN_MS = 600
const SORT_OPTIONS: { value: ScraperVideoSortBy; label: string }[] = [
  { value: 'scraped_at', label: 'Scraper' },
  { value: 'first_seen_at', label: 'First Seen' },
  { value: 'video_code', label: 'Code' },
  { value: 'title', label: 'Title' },
]
export type ScraperVideoPageSize = typeof PAGE_SIZE_OPTIONS[number]

function websiteNameFromUrl(url: string | null | undefined): string {
  if (!url) return 'Unknown'

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Unknown'
  }
}

function TraitBadges({ video }: { video: ScrapedVideo }) {
  const badges = [
    video.uncensored ? { label: 'Uncensored', className: 'bg-amber-500 text-white hover:bg-amber-500' } : null,
    video.censored ? { label: 'Censored', className: 'bg-zinc-500 text-white hover:bg-zinc-500' } : null,
    video.subtitled ? { label: 'Subtitled', className: 'bg-sky-500 text-white hover:bg-sky-500' } : null,
  ].filter(Boolean) as Array<{ label: string; className: string }>

  if (badges.length === 0) {
    return <span className="text-muted-foreground">None</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <Badge key={badge.label} variant="secondary" className={`h-5 px-1.5 text-[10px] font-semibold ${badge.className}`}>
          {badge.label}
        </Badge>
      ))}
    </div>
  )
}

function ScraperVideoRowSkeleton() {
  return (
    <TableRow>
      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
      <TableCell>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-20" />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </TableCell>
      <TableCell><Skeleton className="h-5 w-10 rounded-full" /></TableCell>
      <TableCell><Skeleton className="h-5 w-10 rounded-full" /></TableCell>
      <TableCell><Skeleton className="h-8 w-8 rounded-md" /></TableCell>
    </TableRow>
  )
}

interface ScraperVideosDialogProps {
  open: boolean
  source: ScraperSource | null
  websiteOptions: string[]
  videos: ScrapedVideo[]
  isLoading: boolean
  isFetching: boolean
  search: string
  page: number
  pageSize: ScraperVideoPageSize
  totalVideos: number
  totalPages: number
  filters: ScraperVideoFilters
  onOpenChange: (open: boolean) => void
  onSearchChange: (search: string) => void
  onFilterChange: (filters: ScraperVideoFilters) => void
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: ScraperVideoPageSize) => void
  onRefresh: () => void
  sortBy: ScraperVideoSortBy
  sortDir: ScraperVideoSortDir
  onSortByChange: (sortBy: ScraperVideoSortBy) => void
  onSortDirChange: (sortDir: ScraperVideoSortDir) => void
}

function filterMatches(value: boolean | null | undefined, filter: boolean | null | undefined): boolean {
  return filter === null || filter === undefined || value === filter
}

function videoMatchesFilters(video: ScrapedVideo, filters: ScraperVideoFilters): boolean {
  const websiteName = websiteNameFromUrl(video.url)
  return (
    filterMatches(video.fileExists, filters.fileExists)
    && filterMatches(video.uncensored, filters.uncensored)
    && filterMatches(video.censored, filters.censored)
    && filterMatches(video.subtitled, filters.subtitled)
    && filterMatches(video.opened, filters.opened)
    && (!filters.website || filters.website.length === 0 || filters.website.includes(websiteName))
  )
}

export function ScraperVideosDialog({
  open,
  source,
  websiteOptions,
  videos,
  isLoading,
  isFetching,
  search,
  page,
  pageSize,
  totalVideos,
  totalPages,
  filters,
  onOpenChange,
  onSearchChange,
  onFilterChange,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  sortBy,
  sortDir,
  onSortByChange,
  onSortDirChange,
}: ScraperVideosDialogProps) {
  const { settings } = useSettings()
  const linkedVideos = videos.filter((video) => video.url && videoMatchesFilters(video, filters))
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [isRefreshSpinning, setIsRefreshSpinning] = useState(false)
  const [expandedTitles, setExpandedTitles] = useState<Record<string, boolean>>({})
  const [selectedExternalTargetKeys, setSelectedExternalTargetKeys] = useState<Set<string>>(() => new Set())
  const [includeOriginalUrl, setIncludeOriginalUrl] = useState(false)
  const externalVideoTargets = useMemo(() => settings.external_video_targets.filter(isValidExternalVideoTarget), [settings.external_video_targets])
  const selectedExternalTargets = useMemo(
    () => externalVideoTargets.filter((target) => selectedExternalTargetKeys.has(target.label + target.url_template)),
    [externalVideoTargets, selectedExternalTargetKeys]
  )
  const expandableVideos = videos.filter((video) => (video.title || 'Untitled').length > TITLE_TRUNCATE_LENGTH)
  const allExpandableTitlesExpanded = expandableVideos.length > 0 && expandableVideos.every((video) => expandedTitles[video.id])
  const filterCount = activeScraperVideoFilterCount(filters)
  const showTableSkeleton = isLoading || isFetching
  const skeletonRowCount = Math.min(pageSize, 8)

  const markVideosOpened = async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean)
    if (uniqueIds.length === 0) return

    try {
      await scraperApi.markVideosOpened(uniqueIds)
      onRefresh()
    } catch {
      toast.warning('Opened links, but failed to save opened state.')
    }
  }

  const toggleTitleExpanded = (videoId: string) => {
    setExpandedTitles((current) => ({
      ...current,
      [videoId]: !current[videoId],
    }))
  }

  const toggleAllTitlesExpanded = () => {
    setExpandedTitles((current) => {
      const next = { ...current }
      for (const video of expandableVideos) {
        next[video.id] = !allExpandableTitlesExpanded
      }
      return next
    })
  }

  const handleRefresh = () => {
    setIsRefreshSpinning(true)
    onRefresh()
    window.setTimeout(() => setIsRefreshSpinning(false), REFRESH_SPIN_MIN_MS)
  }

  const openLink = (video: ScrapedVideo) => {
    if (!video.url) return
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      toast.warning('Link was blocked by the browser.')
      return
    }

    try {
      tab.opener = null
    } catch {
      // Ignore browsers that prevent reassigning opener.
    }

    tab.location.href = video.url
    void markVideosOpened([video.id])
  }

  const openSelectedExternalTargets = async () => {
    if (linkedVideos.length === 0 || (selectedExternalTargets.length === 0 && !includeOriginalUrl)) return

    const linksByVideo = linkedVideos.map((video) => [
      ...selectedExternalTargets.map((target) => buildExternalVideoTargetUrl(target, video.videoCode)),
      ...(includeOriginalUrl && video.url ? [video.url] : []),
    ])
    const links = linksByVideo.flat()
    const openedTabs = links.map(() => {
      const tab = window.open('about:blank', '_blank')
      if (!tab) return null
      try { tab.opener = null } catch { /* Ignore browsers that prevent reassigning opener. */ }
      return tab
    })

    for (let index = 0; index < links.length; index += 1) {
      if (openedTabs[index]) openedTabs[index].location.href = links[index]
      if (index < links.length - 1) await new Promise((resolve) => window.setTimeout(resolve, EXTERNAL_LINK_DELAY_MS))
    }
    void markVideosOpened(linkedVideos.map((video) => video.id))
    const openedCount = openedTabs.filter(Boolean).length
    if (openedCount < links.length) toast.warning(`Opened ${openedCount} of ${links.length} selected site links.`)
  }

  const toggleExternalTarget = (targetKey: string, checked: boolean) => {
    setSelectedExternalTargetKeys((previous) => {
      const next = new Set(previous)
      if (checked) next.add(targetKey)
      else next.delete(targetKey)
      return next
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen) setIsFilterDialogOpen(false)
      }}>
        <DialogContent className="max-w-5xl max-h-[95vh] grid-rows-[auto_auto_minmax(0,1fr)_auto]">
          <DialogHeader>
            <DialogTitle>{source?.name ?? 'Scraped Videos'}</DialogTitle>
            <DialogDescription>Stored videos from this scraper.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md shadow-sm">
              <Select value={sortBy} onValueChange={(value) => onSortByChange(value as ScraperVideoSortBy)}>
                <SelectTrigger className="rounded-r-none border-r-0 focus-visible:ring-0 focus-visible:ring-offset-0 w-[120px] justify-center [&>svg:last-child]:hidden">
                  <SortAsc className="h-4 w-4 mr-2 shrink-0" />
                  <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent className="w-[150px]">
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                onClick={() => onSortDirChange(sortDir === 'asc' ? 'desc' : 'asc')}
                className="rounded-l-none border-l-0"
              >
                {sortDir === 'asc' ? (
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
            <Button type="button" size="icon" variant="ghost" onClick={handleRefresh} title="Refresh" aria-label="Refresh scraped videos">
              <RefreshCw className={`h-4 w-4 ${isRefreshSpinning || isLoading || isFetching ? 'animate-spin' : ''}`} aria-hidden />
            </Button>
            <Button type="button" variant={filterCount > 0 ? 'default' : 'outline'} onClick={() => setIsFilterDialogOpen(true)}>
              <Filter className="h-4 w-4 mr-2" />
              Filter{filterCount > 0 ? ` (${filterCount})` : ''}
            </Button>
            {externalVideoTargets.length > 0 || linkedVideos.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" disabled={isFetching || linkedVideos.length === 0}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open In
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuLabel>Select sites</DropdownMenuLabel>
                  {linkedVideos.length > 0 ? (
                    <DropdownMenuCheckboxItem checked={includeOriginalUrl} onCheckedChange={(checked) => setIncludeOriginalUrl(checked === true)} onSelect={(event) => event.preventDefault()}>
                      Original URL
                    </DropdownMenuCheckboxItem>
                  ) : null}
                  {externalVideoTargets.map((target) => (
                    <DropdownMenuCheckboxItem key={target.label + target.url_template} checked={selectedExternalTargetKeys.has(target.label + target.url_template)} onCheckedChange={(checked) => toggleExternalTarget(target.label + target.url_template, checked === true)} onSelect={(event) => event.preventDefault()}>
                      {target.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <div className="flex gap-1 px-1 pb-1">
                    <Button type="button" size="sm" variant="secondary" className="h-8 flex-1 text-xs" onClick={() => { setIncludeOriginalUrl(true); setSelectedExternalTargetKeys(new Set(externalVideoTargets.map((target) => target.label + target.url_template))) }}>Select all</Button>
                    <Button type="button" size="sm" variant="secondary" className="h-8 flex-1 text-xs" onClick={() => { setIncludeOriginalUrl(false); setSelectedExternalTargetKeys(new Set()) }}>Clear</Button>
                  </div>
                  <div className="px-1 pb-1">
                    <Button type="button" size="sm" className="h-8 w-full text-xs" disabled={selectedExternalTargets.length === 0 && !includeOriginalUrl} onClick={() => void openSelectedExternalTargets()}>
                      {includeOriginalUrl && selectedExternalTargets.length === 0 ? 'Open original URL' : `Open in ${selectedExternalTargets.length} selected ${selectedExternalTargets.length === 1 ? 'site' : 'sites'}${includeOriginalUrl ? ' + original URL' : ''}`}
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button type="button" variant="outline" onClick={toggleAllTitlesExpanded} disabled={expandableVideos.length === 0}>
              {allExpandableTitlesExpanded ? (
                <ChevronsDownUp className="h-4 w-4 mr-2" />
              ) : (
                <ChevronsUpDown className="h-4 w-4 mr-2" />
              )}
              {allExpandableTitlesExpanded ? 'Collapse All' : 'Show More'}
            </Button>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search code or title" className="pl-9" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto scrollbar rounded-md border border-border">
            <Table aria-busy={showTableSkeleton || isFetching}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">Code</TableHead>
                  <TableHead className="w-[170px]">Website</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="w-[190px]">Traits</TableHead>
                  <TableHead className="w-24">Opened</TableHead>
                  <TableHead className="w-20">Local</TableHead>
                  <TableHead className="w-16">Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {showTableSkeleton ? (
                  Array.from({ length: skeletonRowCount }).map((_, index) => (
                    <ScraperVideoRowSkeleton key={`scraper-video-skeleton-${index}`} />
                  ))
                ) : videos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No scraped videos stored.</TableCell>
                  </TableRow>
                ) : linkedVideos.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">No scraped videos match the current filters.</TableCell>
                  </TableRow>
                ) : (
                  linkedVideos.map((video) => (
                    <TableRow key={video.id}>
                      <TableCell className="w-[220px] font-medium whitespace-nowrap">{video.videoCode}</TableCell>
                      <TableCell className="max-w-[170px] truncate text-muted-foreground">{websiteNameFromUrl(video.url)}</TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-1">
                          <span className={`${expandedTitles[video.id] ? 'whitespace-normal break-words' : 'truncate'}`} title={video.title || 'Untitled'}>
                            {expandedTitles[video.id]
                              ? (video.title || 'Untitled')
                              : truncateAtWordBoundary(video.title || 'Untitled', TITLE_TRUNCATE_LENGTH)}
                          </span>
                          {(video.title || 'Untitled').length > TITLE_TRUNCATE_LENGTH && (
                            <button
                              type="button"
                              className="w-fit text-xs text-muted-foreground hover:text-foreground transition-colors"
                              onClick={() => toggleTitleExpanded(video.id)}
                              aria-label={expandedTitles[video.id] ? `Show less title for ${video.videoCode}` : `Show more title for ${video.videoCode}`}
                            >
                              {expandedTitles[video.id] ? 'Show less' : 'Show more'}
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <TraitBadges video={video} />
                      </TableCell>
                      <TableCell>
                        {video.opened ? (
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-emerald-500 text-white hover:bg-emerald-500">
                            Yes
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {video.fileExists ? (
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-emerald-500 text-white hover:bg-emerald-500">
                            Yes
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {video.url && (
                          <Button type="button" variant="ghost" size="icon" onClick={() => openLink(video)} aria-label={`Open ${video.videoCode}`}>
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex-none grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Per page:</span>
              <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value) as ScraperVideoPageSize)}>
                <SelectTrigger className="h-[40px] w-[80px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-0 w-[80px]">
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)} className="pl-2 [&>span:first-child]:hidden">{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 items-center justify-center">
              <button
                onClick={() => onPageChange(1)}
                className={`p-2 rounded-md border text-sm font-medium ${page === 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                disabled={page === 1}
                aria-label="First page"
              >
                <ChevronFirst className="w-4 h-4" />
              </button>

              <button
                onClick={() => onPageChange(Math.max(1, page - 1))}
                className={`p-2 rounded-md border text-sm font-medium ${page === 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                disabled={page === 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {(() => {
                const maxVisiblePages = 5
                let startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2))
                let endPage = startPage + maxVisiblePages - 1
                if (endPage > totalPages) {
                  startPage = Math.max(1, totalPages - maxVisiblePages + 1)
                  endPage = totalPages
                }
                const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage + index)
                return (
                  <>
                    {startPage > 1 && (
                      <>
                        <button onClick={() => onPageChange(1)} className="px-3 py-1.5 rounded-md border text-sm font-medium bg-transparent hover:bg-muted">1</button>
                        {startPage > 2 && <span className="px-3 py-1.5 text-sm">...</span>}
                      </>
                    )}
                    {pageNumbers.map((pageNumber) => (
                      <button
                        key={pageNumber}
                        onClick={() => onPageChange(pageNumber)}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium ${page === pageNumber ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`}
                      >
                        {pageNumber}
                      </button>
                    ))}
                    {endPage < totalPages && (
                      <>
                        {endPage < totalPages - 1 && <span className="px-3 py-1.5 text-sm">...</span>}
                        <button onClick={() => onPageChange(totalPages)} className="px-3 py-1.5 rounded-md border text-sm font-medium bg-transparent hover:bg-muted">{totalPages}</button>
                      </>
                    )}
                  </>
                )
              })()}

              <button
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                className={`p-2 rounded-md border text-sm font-medium ${page === totalPages ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                disabled={page === totalPages}
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                onClick={() => onPageChange(totalPages)}
                className={`p-2 rounded-md border text-sm font-medium ${page === totalPages ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                disabled={page === totalPages}
                aria-label="Last page"
              >
                <ChevronLast className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-muted-foreground whitespace-nowrap text-right">
              {totalVideos > 0
                ? `Showing ${Math.min((page - 1) * pageSize + 1, totalVideos)} - ${Math.min(page * pageSize, totalVideos)} of ${totalVideos} videos`
                : 'Showing 0 of 0 videos'}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ScraperVideosFilterDialog
        open={isFilterDialogOpen}
        websiteOptions={websiteOptions}
        filters={filters}
        onOpenChange={setIsFilterDialogOpen}
        onFilterChange={onFilterChange}
      />
    </>
  )
}
