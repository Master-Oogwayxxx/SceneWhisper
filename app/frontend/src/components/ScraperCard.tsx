import { Ban, CircleAlert, ExternalLink, FileStack, Globe, LoaderCircle, MoreVertical, Pencil, Play, SearchCheck, Sparkles, Square, Table2, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { ScraperSource, ScraperWebsiteStats } from '@/types/types'

export type ScraperCardTotals = Pick<ScraperWebsiteStats, 'pagesScraped' | 'created' | 'found'>

type ScraperCardProps = {
  source: ScraperSource
  isSelected: boolean
  websiteLabels: string[]
  websiteStats?: ScraperWebsiteStats[]
  showFailedWebsitesOnly?: boolean
  isRunning: boolean
  runningWebsiteUrls: Set<string>
  progress?: {
    currentUrl: string
    pagesScraped: number
    totalPages: number
    progress: number
  } | null
  isShowingMoreBadges: boolean
  onToggleSelection: (sourceId: string) => void
  onToggleActive: (source: ScraperSource, checked: boolean) => void
  onShowMoreBadgesChange: (sourceId: string, isShowingMore: boolean) => void
  onEdit: (source: ScraperSource) => void
  onEditWebsite: (source: ScraperSource, url: string) => void
  onDelete: (sourceId: string) => void
  onDeleteWebsite: (source: ScraperSource, url: string) => void
  onRun: (source: ScraperSource) => void
  onRunWebsite: (source: ScraperSource, url: string) => void
  onCancelRun: (source: ScraperSource) => void
  onViewTable: (source: ScraperSource) => void
}

function formatDate(value?: Date | string | null): string {
  if (!value) return 'Never'

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Never'

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(date)
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function hostnamesFromUrls(urls: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(urls).map((url) => hostnameFromUrl(url)).filter(Boolean)))
}

function formatStatValue(value: number | undefined): string {
  return value ?? 0
    ? String(value)
    : '0'
}

function isFailedWebsiteStat(source: ScraperSource, stat: ScraperWebsiteStats): boolean {
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

export function normalizeScraperUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1)
    }
    return parsed.toString()
  } catch {
    return trimmed.replace(/\/$/, '')
  }
}

export function buildScraperStatsByUrl(websiteStats?: ScraperWebsiteStats[]): Map<string, ScraperWebsiteStats> {
  return new Map((websiteStats ?? []).map((stat) => [normalizeScraperUrl(stat.url), stat]))
}

export function getScraperWebsiteStat(
  websiteStats: ScraperWebsiteStats[] | undefined,
  index: number,
  url: string,
): ScraperWebsiteStats | undefined {
  return buildScraperStatsByUrl(websiteStats).get(normalizeScraperUrl(url)) ?? websiteStats?.[index]
}

export function getScraperTotals(source: ScraperSource, websiteStats?: ScraperWebsiteStats[]): ScraperCardTotals {
  if (websiteStats?.length) {
    return {
      pagesScraped: websiteStats.reduce((total, stat) => total + stat.pagesScraped, 0),
      created: source.lastNew,
      found: source.lastFound,
    }
  }
  return {
    pagesScraped: source.lastPagesScraped,
    created: source.lastNew,
    found: source.lastFound,
  }
}

export function ScraperCard({
  source,
  isSelected,
  websiteLabels,
  websiteStats,
  showFailedWebsitesOnly = false,
  isRunning,
  runningWebsiteUrls,
  progress,
  isShowingMoreBadges,
  onToggleSelection,
  onToggleActive,
  onShowMoreBadgesChange,
  onEdit,
  onEditWebsite,
  onDelete,
  onDeleteWebsite,
  onRun,
  onRunWebsite,
  onCancelRun,
  onViewTable,
}: ScraperCardProps) {
  const websiteSummary = source.urls?.length || websiteLabels.length > 1
    ? `${websiteLabels.length} websites`
    : hostnameFromUrl(source.url)

  const totalStats = getScraperTotals(source, websiteStats)
  const statsByUrl = buildScraperStatsByUrl(websiteStats)
  const sourceHasBlockedWebsite = source.lastError?.toLowerCase().includes('blocked scraper website') ?? false
  const websiteEntries = websiteLabels
    .map((label, index) => {
      const websiteUrl = normalizeScraperUrl(source.urls?.[index] ?? source.url)
      const stat = statsByUrl.get(websiteUrl) ?? websiteStats?.[index]
      return {
        label,
        index,
        isFailed: stat ? isFailedWebsiteStat(source, stat) : false,
      }
    })
    .filter((entry) => !showFailedWebsitesOnly || entry.isFailed)
  const visibleWebsiteEntries = websiteEntries.slice(0, 3)
  const hiddenWebsiteLabels = websiteLabels.slice(3)
  const hasHiddenWebsiteLabels = hiddenWebsiteLabels.length > 0
  const renderedWebsiteEntries = isShowingMoreBadges || !hasHiddenWebsiteLabels
    ? websiteEntries
    : visibleWebsiteEntries
  const runningWebsiteHosts = hostnamesFromUrls(runningWebsiteUrls)
  const runningWebsiteCount = runningWebsiteUrls.size
  const progressValue = progress?.progress ?? 0
  const handleOpenWebsite = (event: React.MouseEvent, url: string) => {
    event.stopPropagation()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div
        role="checkbox"
        aria-checked={isSelected}
        tabIndex={0}
        onClick={() => onToggleSelection(source.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggleSelection(source.id)
          }
        }}
        className={`rounded-md border p-4 space-y-3 bg-card cursor-pointer transition-colors ${isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/60'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate">{source.name}</div>
              <div className="truncate text-xs text-muted-foreground">{websiteSummary}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
            <Switch
              className="h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span[data-state=checked]]:translate-x-4"
              checked={source.isActive}
              onCheckedChange={(checked) => onToggleActive(source, checked)}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-5.5"
                  aria-label={`Open ${source.name} actions`}
                >
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onEdit(source)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  onClick={() => onDelete(source.id)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            {websiteLabels.length > 0 ? (
              <>
                {renderedWebsiteEntries.map(({ label, index }) => {
                  const websiteUrl = normalizeScraperUrl(source.urls?.[index] ?? source.url)
                  const urlMatchedStats = statsByUrl.get(websiteUrl)
                  const stats = urlMatchedStats ?? (sourceHasBlockedWebsite ? undefined : websiteStats?.[index])
                  const isWebsiteBlocked = stats?.blocked || (sourceHasBlockedWebsite && !urlMatchedStats)
                  const isWebsiteRunning = runningWebsiteUrls.has(websiteUrl)
                  return (
                    <div key={`${source.id}-${label}-${index}`} className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="secondary" className="flex items-center gap-1.5 py-1 cursor-help">
                            <span className="flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              <span>{label}</span>
                            </span>
                            <span className="flex items-center gap-2 border-l border-border pl-2 text-[11px] leading-none">
                              <span className="flex items-center gap-1">
                                <FileStack className="h-3 w-3" />
                                {stats?.pagesScraped ?? '-'}
                              </span>
                              <span className="flex items-center gap-1">
                                <Sparkles className="h-3 w-3" />
                                {stats?.created ?? '-'}
                              </span>
                              <span className="flex items-center gap-1">
                                <SearchCheck className="h-3 w-3" />
                                {stats?.found ?? '-'}
                              </span>
                            </span>
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="space-y-1">
                            <div>{label} Stats</div>
                            <div>Pages Scraped: {formatStatValue(stats?.pagesScraped)}</div>
                            <div>New Found: {formatStatValue(stats?.created)}</div>
                            <div>Found Total: {formatStatValue(stats?.found)}</div>
                            {isWebsiteBlocked && <div>Blocked</div>}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            aria-label={`Run ${label} for ${source.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              onRunWebsite(source, websiteUrl)
                            }}
                            disabled={isWebsiteRunning}
                          >
                            {isWebsiteRunning ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div>Run {label}</div>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            aria-label={`Edit ${label} for ${source.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              onEditWebsite(source, websiteUrl)
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div>Edit {label}</div>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            aria-label={`Open ${label} for ${source.name}`}
                            onClick={(event) => handleOpenWebsite(event, websiteUrl)}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div>Open {label}</div>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Delete ${label} for ${source.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              onDeleteWebsite(source, websiteUrl)
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div>Delete {label}</div>
                        </TooltipContent>
                      </Tooltip>
                      {isWebsiteBlocked && source.lastError && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-destructive"
                              aria-label={`Scraper error for ${source.name}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <CircleAlert className="h-3 w-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="max-w-xs whitespace-pre-wrap break-words">{source.lastError}</div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )
                })}
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="flex items-center gap-1.5 py-1 cursor-help">
                    <span className="flex items-center gap-1">
                      <Globe className="h-3 w-3" />
                      <span>Unknown</span>
                    </span>
                    <span className="flex items-center gap-2 border-l border-border pl-2 text-[11px] leading-none">
                      <span className="flex items-center gap-1">
                        <FileStack className="h-3 w-3" />
                        {totalStats.pagesScraped}
                      </span>
                      <span className="flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        {totalStats.created}
                      </span>
                      <span className="flex items-center gap-1">
                        <SearchCheck className="h-3 w-3" />
                        {totalStats.found}
                      </span>
                    </span>
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1">
                    <div>Unknown website stats</div>
                    <div>Pages scraped: {formatStatValue(totalStats.pagesScraped)}</div>
                    <div>New found: {formatStatValue(totalStats.created)}</div>
                    <div>Found total: {formatStatValue(totalStats.found)}</div>
                    {sourceHasBlockedWebsite && <div>Blocked</div>}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {hasHiddenWebsiteLabels && (
            <div className="flex items-center gap-2">
              {isShowingMoreBadges ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={(event) => {
                    event.stopPropagation()
                    onShowMoreBadgesChange(source.id, false)
                  }}
                >
                  Show less
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={(event) => {
                    event.stopPropagation()
                    onShowMoreBadgesChange(source.id, true)
                  }}
                >
                  Show more
                  <span className="ml-1 text-[11px] text-muted-foreground">
                    +{hiddenWebsiteLabels.length}
                  </span>
                </Button>
              )}
            </div>
          )}
        </div>
        {(isRunning || runningWebsiteCount > 0 || progress) && (
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 text-foreground">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="font-medium">
                {progress
                  ? `${source.name} is running`
                  : runningWebsiteCount > 0
                    ? `${runningWebsiteCount} website${runningWebsiteCount === 1 ? '' : 's'} running`
                    : 'Scraper running'}
              </span>
            </div>
            {progress && (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Progress value={Math.min(100, Math.max(0, progressValue))} className="h-2 flex-1" />
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">{Math.round(progressValue)}%</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="px-3"
                    onClick={() => onCancelRun(source)}
                    aria-label={`Cancel ${source.name} run`}
                  >
                    <Square className="h-4 w-4" />
                    <span className="ml-2">Stop</span>
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    Page {progress.pagesScraped} of {progress.totalPages}
                  </span>
                </div>
              </div>
            )}
            {!progress && isRunning && (
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="px-3"
                  onClick={() => onCancelRun(source)}
                  aria-label={`Cancel ${source.name} run`}
                >
                  <Square className="h-4 w-4" />
                  <span className="ml-2">Stop</span>
                </Button>
              </div>
            )}
            <div className="mt-1">
              {progress?.currentUrl
                ? `Current URL: ${progress.currentUrl}`
                : runningWebsiteHosts.length > 0
                  ? `Active websites: ${runningWebsiteHosts.join(', ')}`
                  : 'Working through the selected scraper websites and will update the saved totals when complete.'}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <div>Last run</div>
            <div className="text-foreground truncate">{formatDate(source.lastRun)}</div>
          </div>
          <div>
            <div>Next run</div>
            <div className="text-foreground truncate">{formatDate(source.nextRun)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1" onClick={(event) => event.stopPropagation()}>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => onRun(source)}
              disabled={isRunning}
            >
              {isRunning ? (
                <LoaderCircle className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {isRunning ? 'Running' : 'Run'}
            </Button>
          </div>
          <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => onViewTable(source)}>
            <Table2 className="h-4 w-4 mr-2" />
            View Videos
          </Button>
        </div>
      </div>
    </TooltipProvider>
  )
}
