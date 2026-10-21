import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ExternalLink, FileCode2, FileSearch, Loader2, Play, Search, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { fileApi } from '@/api/files'
import { toolsApi } from '@/api/tools'
import type { BookmarkVideoCheckItem, DirectoryRecord } from '@/types/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSettings } from '@/hooks/useSettings'
import { buildExternalVideoTargetUrl, isValidExternalVideoTarget } from '@/lib/external-video-targets'
import { BookmarkStatusBadge, MatchedFilesSummary, parseHtmlPageVideoLinks, type StatusFilter } from './toolUtils'
import { DiskDirectorySelect } from './BookmarkVideoCheckTool'

interface HtmlPageVideoCheckToolProps {
  onBack: () => void
}

type VideoContentKind = 'censored' | 'uncensored'

const EXTERNAL_LINK_DELAY_MS = 100

export function HtmlPageVideoCheckTool({ onBack }: HtmlPageVideoCheckToolProps) {
  const { settings } = useSettings()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastSelectedRowIdRef = useRef<string | null>(null)
  const [items, setItems] = useState<BookmarkVideoCheckItem[]>([])
  const [diskDirectories, setDiskDirectories] = useState<DirectoryRecord[]>([])
  const [selectedDiskDirectoryIds, setSelectedDiskDirectoryIds] = useState<string[]>([])
  const [sourceLabel, setSourceLabel] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [hasChecked, setHasChecked] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isPasteOpen, setIsPasteOpen] = useState(false)
  const [pastedHtml, setPastedHtml] = useState('')
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set())
  const [selectedExternalTargetKeys, setSelectedExternalTargetKeys] = useState<Set<string>>(() => new Set())
  const [includeOriginalUrl, setIncludeOriginalUrl] = useState(false)
  const [openedVideoCodes, setOpenedVideoCodes] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    void fileApi.getDirectories().then(setDiskDirectories).catch(() => toast.error('Failed to load disk directories'))
  }, [])

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((item) => {
      if (hasChecked && status === 'exists' && !item.fileExists) return false
      if (hasChecked && status === 'missing' && item.fileExists) return false
      if (!query) return true
      return (
        item.videoCode.toLowerCase().includes(query) ||
        item.title.toLowerCase().includes(query) ||
        item.url.toLowerCase().includes(query)
      )
    })
  }, [hasChecked, items, search, status])

  const existingCount = items.filter((item) => item.fileExists).length
  const statusCounts = {
    all: items.length,
    exists: hasChecked ? existingCount : 0,
    missing: hasChecked ? items.length - existingCount : 0,
  }
  const visibleRowIds = useMemo(() => filteredItems.map(pageRowId), [filteredItems])
  const visibleUnopenedRowIds = useMemo(
    () => filteredItems.filter((item) => !openedVideoCodes.has(item.videoCode)).map(pageRowId),
    [filteredItems, openedVideoCodes]
  )
  const selectedItems = useMemo(() => items.filter((item) => selectedRowIds.has(pageRowId(item))), [items, selectedRowIds])
  const visibleSelectedCount = visibleRowIds.filter((rowId) => selectedRowIds.has(rowId)).length
  const hasUnselectedVisibleUnopenedRows = visibleUnopenedRowIds.some((rowId) => !selectedRowIds.has(rowId))
  const allVisibleSelected = visibleRowIds.length > 0 && visibleSelectedCount === visibleRowIds.length
  const visibleSelectionState = visibleSelectedCount === 0 ? false : allVisibleSelected ? true : 'indeterminate'
  const externalVideoTargets = useMemo(
    () => settings.external_video_targets.filter(isValidExternalVideoTarget),
    [settings.external_video_targets]
  )
  const selectedExternalTargets = useMemo(
    () => externalVideoTargets.filter((target) => selectedExternalTargetKeys.has(target.label + target.url_template)),
    [externalVideoTargets, selectedExternalTargetKeys]
  )
  const selectedVideoCodes = useMemo(
    () => Array.from(new Set(selectedItems.map((item) => item.videoCode))),
    [selectedItems]
  )

  useEffect(() => {
    const availableRowIds = new Set(items.map(pageRowId))
    setSelectedRowIds((previous) => {
      const next = new Set(Array.from(previous).filter((rowId) => availableRowIds.has(rowId)))
      return next.size === previous.size ? previous : next
    })
  }, [items])

  const importHtmlBatch = (pages: Array<{ html: string; label: string }>, nextSourceLabel: string) => {
    const seen = new Set<string>()
    const parsedItems = pages.flatMap(({ html }) => parseHtmlPageVideoLinks(html)).filter((item) => {
      const key = `${item.videoCode}|${item.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    setItems(parsedItems)
    setSelectedRowIds(new Set())
    setOpenedVideoCodes(new Set())
    setHasChecked(false)
    setStatus('all')
    setSourceLabel(nextSourceLabel)

    if (parsedItems.length === 0) {
      toast.error('No video links found in page HTML')
      return false
    }

    toast.success(`Imported ${parsedItems.length} video link${parsedItems.length === 1 ? '' : 's'} from ${pages.length} page${pages.length === 1 ? '' : 's'}`)
    return true
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return

    try {
      const pages = await Promise.all(files.map(async (file) => ({ html: await file.text(), label: file.name })))
      const nextSourceLabel = files.length === 1 ? files[0].name : `${files.length} HTML files`
      importHtmlBatch(pages, nextSourceLabel)
    } catch {
      toast.error('Failed to read page HTML')
    } finally {
      event.target.value = ''
    }
  }

  const handlePasteImport = () => {
    if (!pastedHtml.trim()) {
      toast.error('Paste HTML code first')
      return
    }

    if (importHtmlBatch(splitPastedHtmlPages(pastedHtml).map((html, index) => ({ html, label: `Pasted HTML ${index + 1}` })), 'Pasted HTML')) {
      setPastedHtml('')
      setIsPasteOpen(false)
    }
  }

  const handleRunCheck = async () => {
    if (items.length === 0) {
      toast.error('Import page HTML first')
      return
    }

    setIsChecking(true)
    try {
      const result = await toolsApi.checkBookmarkVideos(items, selectedDiskDirectoryIds)
      setItems([...result.items].sort(comparePageVideoItemsAlphabetically))
      setHasChecked(true)
      toast.success(`Checked ${result.total} video link${result.total === 1 ? '' : 's'}`)
    } catch {
      toast.error('Failed to check page videos')
    } finally {
      setIsChecking(false)
    }
  }

  const markVideoCodeOpened = (videoCode: string) => {
    setOpenedVideoCodes((previous) => {
      if (previous.has(videoCode)) return previous
      const next = new Set(previous)
      next.add(videoCode)
      return next
    })
  }

  const unselectVideoCodes = (videoCodes: Iterable<string>) => {
    const codesToUnselect = new Set(videoCodes)
    setSelectedRowIds((previous) => {
      const next = new Set(previous)
      items.forEach((item) => {
        if (codesToUnselect.has(item.videoCode)) {
          next.delete(pageRowId(item))
        }
      })
      return next.size === previous.size ? previous : next
    })
  }

  const openPageLink = (item: BookmarkVideoCheckItem) => {
    window.open(item.url, '_blank', 'noopener,noreferrer')
    markVideoCodeOpened(item.videoCode)
    unselectVideoCodes([item.videoCode])
  }

  const toggleRowSelection = (item: BookmarkVideoCheckItem, checked: boolean) => {
    const rowId = pageRowId(item)
    lastSelectedRowIdRef.current = rowId
    setSelectedRowIds((previous) => {
      const next = new Set(previous)
      if (checked) {
        next.add(rowId)
      } else {
        next.delete(rowId)
      }
      return next
    })
  }

  const handleRowClick = (item: BookmarkVideoCheckItem, event: React.MouseEvent) => {
    const rowId = pageRowId(item)
    const anchorRowId = lastSelectedRowIdRef.current
    lastSelectedRowIdRef.current = rowId

    setSelectedRowIds((previous) => {
      const next = new Set(previous)
      const anchorIndex = anchorRowId ? visibleRowIds.indexOf(anchorRowId) : -1
      const rowIndex = visibleRowIds.indexOf(rowId)

      if (event.shiftKey && anchorIndex >= 0 && rowIndex >= 0) {
        const start = Math.min(anchorIndex, rowIndex)
        const end = Math.max(anchorIndex, rowIndex)
        visibleRowIds.slice(start, end + 1).forEach((visibleRowId) => next.add(visibleRowId))
        return next
      }

      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  const toggleVisibleSelection = () => {
    setSelectedRowIds((previous) => {
      const next = new Set(previous)
      if (allVisibleSelected) {
        visibleRowIds.forEach((rowId) => next.delete(rowId))
      } else {
        visibleRowIds.forEach((rowId) => next.add(rowId))
      }
      return next
    })
  }

  const selectNextVisibleRows = (count: number) => {
    setSelectedRowIds((previous) => {
      const next = new Set(previous)
      const selectedVisibleIndexes = filteredItems
        .map((item, index) => (previous.has(pageRowId(item)) ? index : -1))
        .filter((index) => index >= 0)
      const startIndex = selectedVisibleIndexes.length > 0 ? Math.max(...selectedVisibleIndexes) + 1 : 0
      const rowIdsToSelect = filteredItems
        .slice(startIndex)
        .filter((item) => !openedVideoCodes.has(item.videoCode))
        .map(pageRowId)
        .filter((rowId) => !previous.has(rowId))
        .slice(0, count)

      rowIdsToSelect.forEach((rowId) => next.add(rowId))
      if (rowIdsToSelect.length > 0) {
        lastSelectedRowIdRef.current = rowIdsToSelect[rowIdsToSelect.length - 1]
      }
      return next
    })
  }

  const openSelectedExternalTargets = async () => {
    if (selectedVideoCodes.length === 0 || (selectedExternalTargets.length === 0 && !includeOriginalUrl)) {
      return
    }

    const linksByVideo = selectedVideoCodes.map((videoCode) => {
      const item = selectedItems.find((selectedItem) => selectedItem.videoCode === videoCode)
      return [
        ...selectedExternalTargets.map((target) => buildExternalVideoTargetUrl(target, videoCode)),
        ...(includeOriginalUrl && item ? [item.url] : []),
      ]
    })
    const links = linksByVideo.flat()
    const openedTabs = links.map(() => {
      const tab = window.open('about:blank', '_blank')
      if (!tab) {
        return null
      }

      try {
        tab.opener = null
      } catch {
        // Some browsers block reassignment; opening still works without it.
      }

      return tab
    })

    let linkIndex = 0
    for (const videoLinks of linksByVideo) {
      for (const link of videoLinks) {
        const tab = openedTabs[linkIndex]
        if (tab) {
          tab.location.href = link
        }
        linkIndex += 1

        if (linkIndex < links.length) {
          await new Promise((resolve) => window.setTimeout(resolve, EXTERNAL_LINK_DELAY_MS))
        }
      }
    }
    setOpenedVideoCodes((previous) => new Set([...previous, ...selectedVideoCodes]))
    unselectVideoCodes(selectedVideoCodes)
    const openedCount = openedTabs.filter((tab) => tab !== null).length
    if (openedCount < links.length) {
      toast.error(`Opened ${openedCount} of ${links.length} selected site link${links.length === 1 ? '' : 's'}`)
    }
  }

  const toggleExternalTarget = (targetKey: string, checked: boolean) => {
    setSelectedExternalTargetKeys((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(targetKey)
      } else {
        next.delete(targetKey)
      }
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background shadow sm:rounded-lg">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={onBack} title="Back to tools" aria-label="Back to tools" className="h-8 w-8 shrink-0 sm:h-9 sm:w-9">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary sm:h-9 sm:w-9">
            <FileCode2 className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">HTML Page Video Check</h2>
            <p className="truncate text-xs text-muted-foreground">
              {items.length ? `${existingCount} of ${items.length} page video codes exist` : 'HTML page video link checker'}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
          <div className="scrollbar -mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:gap-2 sm:px-0 sm:pb-0">
            <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isChecking} className="h-8 shrink-0 gap-2 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
              {isChecking ? <Upload className="h-4 w-4 animate-pulse" aria-hidden /> : <FileCode2 className="h-4 w-4" aria-hidden />}
              Import
            </Button>
            <Dialog open={isPasteOpen} onOpenChange={setIsPasteOpen}>
              <DialogTrigger asChild>
                <Button type="button" size="sm" variant="outline" disabled={isChecking} className="h-8 shrink-0 gap-2 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
                  <FileSearch className="h-4 w-4" aria-hidden />
                  Paste
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Paste HTML Code</DialogTitle>
                </DialogHeader>
                <Textarea
                  value={pastedHtml}
                  onChange={(event) => setPastedHtml(event.target.value)}
                  placeholder="<html>...</html>"
                  className="min-h-[45vh] resize-y font-mono text-xs"
                  spellCheck={false}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsPasteOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={handlePasteImport} disabled={!pastedHtml.trim()}>
                    Import HTML
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <DiskDirectorySelect directories={diskDirectories} selectedDirectoryIds={selectedDiskDirectoryIds} onChange={(directoryIds) => {
              setSelectedDiskDirectoryIds(directoryIds)
              setHasChecked(false)
            }} />
            <Button type="button" size="sm" onClick={() => void handleRunCheck()} disabled={isChecking || items.length === 0} className="h-8 shrink-0 gap-2 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
              {isChecking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {isChecking ? 'Checking' : 'Run Check'}
            </Button>
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".html,.htm,text/html" multiple className="hidden" onChange={handleFileChange} />

      <div className="flex flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center">
        <div className="min-w-0 truncate text-xs text-muted-foreground">
          {sourceLabel ? `${sourceLabel} - ${items.length} video link${items.length === 1 ? '' : 's'}` : 'Choose HTML page exports or paste HTML code'}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:ml-auto sm:flex-row sm:items-center">
          <div className="flex shrink-0 gap-1.5 sm:gap-2">
            {(['all', 'exists', 'missing'] as const).map((value) => (
              <Button key={value} type="button" size="sm" variant={status === value ? 'default' : 'outline'} onClick={() => setStatus(value)} disabled={!hasChecked && value !== 'all'} className="h-8 shrink-0 px-2.5 text-xs capitalize">
                {value} ({statusCounts[value]})
              </Button>
            ))}
          </div>
          <div className="relative min-w-0 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search page links" className="h-8 pl-9 text-sm" />
          </div>
        </div>
      </div>

      {isChecking ? (
        <div className="border-b border-border bg-primary/5 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Checking page video codes
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-primary/10">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      ) : null}

      {selectedItems.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/45 px-3 py-2">
          <div className="mr-auto flex min-w-0 items-center gap-2">
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setSelectedRowIds(new Set())} aria-label="Clear selected links">
              <X className="h-4 w-4" aria-hidden />
            </Button>
            <span className="text-sm text-muted-foreground">{selectedItems.length} selected</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {[5, 10, 15].map((count) => (
              <Button
                key={count}
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs"
                onClick={() => selectNextVisibleRows(count)}
                disabled={!hasUnselectedVisibleUnopenedRows}
              >
                Next {count}
              </Button>
            ))}
          </div>
          {externalVideoTargets.length > 0 || selectedItems.some((item) => item.url) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" className="h-8 gap-2">
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  Open Selected
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuLabel>Select sites</DropdownMenuLabel>
                {selectedItems.some((item) => item.url) ? (
                  <DropdownMenuCheckboxItem
                    checked={includeOriginalUrl}
                    onCheckedChange={(checked) => setIncludeOriginalUrl(checked === true)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    Original URL
                  </DropdownMenuCheckboxItem>
                ) : null}
                {externalVideoTargets.map((target) => (
                  <DropdownMenuCheckboxItem
                    key={target.label + target.url_template}
                    checked={selectedExternalTargetKeys.has(target.label + target.url_template)}
                    onCheckedChange={(checked) => toggleExternalTarget(target.label + target.url_template, checked === true)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {target.label}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <div className="flex gap-1 px-1 pb-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 flex-1 text-xs"
                    onClick={() => {
                      setIncludeOriginalUrl(true)
                      setSelectedExternalTargetKeys(new Set(externalVideoTargets.map((target) => target.label + target.url_template)))
                    }}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 flex-1 text-xs"
                    onClick={() => {
                      setIncludeOriginalUrl(false)
                      setSelectedExternalTargetKeys(new Set())
                    }}
                  >
                    Clear
                  </Button>
                </div>
                <div className="px-1 pb-1">
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 w-full text-xs"
                    disabled={selectedExternalTargets.length === 0 && !includeOriginalUrl}
                    onClick={openSelectedExternalTargets}
                  >
                    {includeOriginalUrl && selectedExternalTargets.length === 0
                      ? 'Open original URL'
                      : `Open in ${selectedExternalTargets.length} selected ${selectedExternalTargets.length === 1 ? 'site' : 'sites'}${includeOriginalUrl ? ' + original URL' : ''}`}
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto scrollbar sm:hidden">
        <div className="space-y-2 p-2">
          {filteredItems.length ? filteredItems.map((item) => (
            <article key={pageRowId(item)} className="cursor-pointer select-none rounded-md border border-border bg-background p-3 shadow-sm" onClick={(event) => handleRowClick(item, event)}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <Checkbox className="mt-0.5 shrink-0" checked={selectedRowIds.has(pageRowId(item))} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => toggleRowSelection(item, checked === true)} aria-label={`Select ${item.videoCode}`} />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <div className="font-mono text-sm font-semibold">{item.videoCode}</div>
                      <VideoContentKindBadge kind={getVideoContentKind(item.title)} />
                      <OpenedVideoCodeBadge opened={openedVideoCodes.has(item.videoCode)} />
                    </div>
                    <h3 className="mt-1 truncate text-sm font-medium" title={item.title}>{item.title}</h3>
                  </div>
                </div>
                {hasChecked ? <BookmarkStatusBadge exists={item.fileExists} /> : <span className="text-xs text-muted-foreground">Not checked</span>}
              </div>
              <div className="mt-3 break-all rounded-md bg-secondary/35 px-2 py-1.5 text-xs text-muted-foreground">{item.url}</div>
              <div className="mt-3 rounded-md border border-border/70 px-2 py-2">
                {hasChecked ? <MatchedFilesSummary files={item.matchedFiles} /> : <span className="text-xs text-muted-foreground">Import page HTML and run check</span>}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={(event) => {
                event.stopPropagation()
                openPageLink(item)
              }} className="mt-3 h-8 w-full gap-2">
                <ExternalLink className="h-4 w-4" aria-hidden />
                Open
              </Button>
            </article>
          )) : (
            <div className="px-3 py-14 text-center text-sm text-muted-foreground">No Page Video Links Found</div>
          )}
        </div>
      </div>

      <div className="hidden min-h-0 flex-1 overflow-auto scrollbar sm:block">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <colgroup>
            <col className="w-12" />
            <col className="w-44" />
            <col className="w-32" />
            <col className="w-[31%]" />
            <col className="w-[21%]" />
            <col className="w-28" />
            <col className="w-24" />
            <col className="w-16" />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border bg-background/95 text-xs uppercase text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-semibold">
                <Checkbox checked={visibleSelectionState} onCheckedChange={toggleVisibleSelection} disabled={filteredItems.length === 0} aria-label={allVisibleSelected ? 'Deselect visible links' : 'Select visible links'} />
              </th>
              <th className="px-3 py-2 font-semibold">Code</th>
              <th className="px-3 py-2 font-semibold">Kind</th>
              <th className="px-3 py-2 font-semibold">Page Link</th>
              <th className="px-3 py-2 font-semibold">Matched Local File</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Opened</th>
              <th className="px-3 py-2 text-right font-semibold">Open</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length ? filteredItems.map((item) => (
              <tr key={pageRowId(item)} className="cursor-pointer select-none border-b border-border/70 last:border-0 hover:bg-secondary/40" onClick={(event) => handleRowClick(item, event)}>
                <td className="px-3 py-2 align-middle">
                  <div className="flex items-center">
                    <Checkbox checked={selectedRowIds.has(pageRowId(item))} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => toggleRowSelection(item, checked === true)} aria-label={`Select ${item.videoCode}`} />
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 align-middle font-mono font-semibold">{item.videoCode}</td>
                <td className="px-3 py-2 align-middle">
                  <VideoContentKindBadge kind={getVideoContentKind(item.title)} />
                </td>
                <td className="min-w-0 px-3 py-2 align-middle">
                  <div className="whitespace-normal break-words font-medium" title={item.title}>{item.title}</div>
                  <div className="mt-1 whitespace-normal break-all text-xs text-muted-foreground" title={item.url}>{item.url}</div>
                </td>
                <td className="min-w-0 px-3 py-2 align-middle">
                  {hasChecked ? <MatchedFilesSummary files={item.matchedFiles} /> : <span className="text-xs text-muted-foreground">Import page HTML and run check</span>}
                </td>
                <td className="px-3 py-2 align-middle">{hasChecked ? <BookmarkStatusBadge exists={item.fileExists} /> : <span className="text-xs text-muted-foreground">Not checked</span>}</td>
                <td className="px-3 py-2 align-middle">
                  <OpenedVideoCodeBadge opened={openedVideoCodes.has(item.videoCode)} />
                </td>
                <td className="px-3 py-2 text-right align-middle">
                  <Button type="button" size="icon" variant="ghost" onClick={(event) => {
                    event.stopPropagation()
                    openPageLink(item)
                  }} title="Open page link" aria-label={`Open ${item.videoCode}`}>
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </Button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={8} className="px-3 py-14 text-center text-sm text-muted-foreground">
                  No Page Video Links Found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function pageRowId(item: BookmarkVideoCheckItem) {
  return `${item.videoCode}\u0000${item.url}`
}

function getVideoContentKind(title: string): VideoContentKind {
  const normalizedTitle = title.toLowerCase()
  return /\b(?:un[\s_-]*censored|uncensor(?:ed)?|reduc(?:ed|ing)[\s_-]*mosaic|reducedmosaic|reducingmosaic|no[\s_-]*mosaic|rm)\b/.test(normalizedTitle)
    ? 'uncensored'
    : 'censored'
}

function VideoContentKindBadge({ kind }: { kind: VideoContentKind }) {
  if (kind === 'uncensored') {
    return (
      <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-600 hover:bg-blue-500/10">
        Uncensored
      </Badge>
    )
  }

  return <Badge variant="secondary">Censored</Badge>
}

function OpenedVideoCodeBadge({ opened }: { opened: boolean }) {
  return opened ? (
    <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/10">
      Opened
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Not opened
    </Badge>
  )
}

function comparePageVideoItemsAlphabetically(first: BookmarkVideoCheckItem, second: BookmarkVideoCheckItem) {
  return first.videoCode.localeCompare(second.videoCode, undefined, { numeric: true, sensitivity: 'base' })
    || first.title.localeCompare(second.title, undefined, { numeric: true, sensitivity: 'base' })
    || first.url.localeCompare(second.url, undefined, { numeric: true, sensitivity: 'base' })
}

function splitPastedHtmlPages(value: string) {
  const trimmedValue = value.trim()
  if (!trimmedValue) return []

  const documents = trimmedValue.match(/<!doctype[\s\S]*?<\/html>|<html[\s\S]*?<\/html>/gi)
  if (!documents || documents.length <= 1) return [trimmedValue]

  return documents
}
