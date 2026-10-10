import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, FileSearch, FolderOpen, Loader2, Play, Search, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { fileApi } from '@/api/files'
import { toolsApi } from '@/api/tools'
import type { BookmarkVideoCheckItem, DirectoryRecord } from '@/types/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BookmarkStatusBadge, MatchedFilesSummary, parseGoogleBookmarks, type StatusFilter } from './toolUtils'

interface BookmarkVideoCheckToolProps {
  onBack: () => void
}

export function BookmarkVideoCheckTool({ onBack }: BookmarkVideoCheckToolProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastSelectedRowIdRef = useRef<string | null>(null)
  const [items, setItems] = useState<BookmarkVideoCheckItem[]>([])
  const [allBookmarkItems, setAllBookmarkItems] = useState<BookmarkVideoCheckItem[]>([])
  const [bookmarkDirectories, setBookmarkDirectories] = useState<string[]>([])
  const [selectedBookmarkDirectories, setSelectedBookmarkDirectories] = useState<string[]>([])
  const [diskDirectories, setDiskDirectories] = useState<DirectoryRecord[]>([])
  const [selectedDiskDirectoryIds, setSelectedDiskDirectoryIds] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [hasChecked, setHasChecked] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set())

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
  const visibleRowIds = useMemo(() => filteredItems.map(bookmarkRowId), [filteredItems])
  const selectedItems = useMemo(() => items.filter((item) => selectedRowIds.has(bookmarkRowId(item))), [items, selectedRowIds])
  const visibleSelectedCount = visibleRowIds.filter((rowId) => selectedRowIds.has(rowId)).length
  const allVisibleSelected = visibleRowIds.length > 0 && visibleSelectedCount === visibleRowIds.length
  const visibleSelectionState = visibleSelectedCount === 0 ? false : allVisibleSelected ? true : 'indeterminate'
  const bookmarkDirectoryLabel = selectionLabel(selectedBookmarkDirectories.length, bookmarkDirectories.length, 'bookmark folder')
  const diskDirectoryLabel = diskSelectionLabel(selectedDiskDirectoryIds.length, selectableDiskDirectories(diskDirectories).length)
  const itemsForBookmarkDirectories = (directories: string[], sourceItems = allBookmarkItems) => {
    if (directories.length === 0) return []
    const selected = new Set(directories)
    return sourceItems.filter((item) => item.bookmarkPath && selected.has(item.bookmarkPath))
  }

  useEffect(() => {
    const availableRowIds = new Set(items.map(bookmarkRowId))
    setSelectedRowIds((previous) => {
      const next = new Set(Array.from(previous).filter((rowId) => availableRowIds.has(rowId)))
      return next.size === previous.size ? previous : next
    })
  }, [items])

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    try {
      const parsed = parseGoogleBookmarks(await file.text())
      if (parsed.items.length === 0) {
        setItems([])
        setAllBookmarkItems([])
        setBookmarkDirectories([])
        setSelectedBookmarkDirectories([])
        setHasChecked(false)
        toast.error('No video codes found in bookmarks')
        return
      }
      setAllBookmarkItems(parsed.items)
      setBookmarkDirectories(parsed.directories)
      setSelectedBookmarkDirectories([])
      setItems([])
      setHasChecked(false)
      setStatus('all')
      toast.success(`Imported ${parsed.items.length} bookmark video code${parsed.items.length === 1 ? '' : 's'}`)
    } catch {
      toast.error('Failed to read bookmarks')
    } finally {
      event.target.value = ''
    }
  }

  const handleRunCheck = async () => {
    const selectedItems = itemsForBookmarkDirectories(selectedBookmarkDirectories)
    if (allBookmarkItems.length === 0) {
      toast.error('Import bookmarks first')
      return
    }
    if (selectedItems.length === 0) {
      toast.error('Select at least one bookmark folder')
      return
    }

    setIsChecking(true)
    try {
      const result = await toolsApi.checkBookmarkVideos(selectedItems, selectedDiskDirectoryIds)
      setItems(result.items)
      setHasChecked(true)
      toast.success(`Checked ${result.total} bookmark video code${result.total === 1 ? '' : 's'}`)
    } catch {
      toast.error('Failed to check bookmark videos')
    } finally {
      setIsChecking(false)
    }
  }

  const openBookmark = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const toggleRowSelection = (item: BookmarkVideoCheckItem, checked: boolean) => {
    const rowId = bookmarkRowId(item)
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
    const rowId = bookmarkRowId(item)
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

  const openSelectedBookmarks = () => {
    let openedCount = 0
    for (const item of selectedItems) {
      const tab = window.open(item.url, '_blank', 'noopener,noreferrer')
      if (tab) openedCount += 1
    }
    if (openedCount < selectedItems.length) {
      toast.error(`Opened ${openedCount} of ${selectedItems.length} selected bookmark${selectedItems.length === 1 ? '' : 's'}`)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background shadow sm:rounded-lg">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            title="Back to tools"
            aria-label="Back to tools"
            className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary sm:h-9 sm:w-9">
            <FileSearch className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Google Bookmark Video Check</h2>
            <p className="truncate text-xs text-muted-foreground">
              {items.length ? `${existingCount} of ${items.length} bookmark codes exist` : 'Bookmark video code checker'}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
          <div className="scrollbar -mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:gap-2 sm:px-0 sm:pb-0">
            <Button
              type="button"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={isChecking}
              className="h-8 shrink-0 gap-2 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
            >
              {isChecking ? <Upload className="h-4 w-4 animate-pulse" aria-hidden /> : <FolderOpen className="h-4 w-4" aria-hidden />}
              Import
            </Button>
            <BookmarkDirectorySelect directories={bookmarkDirectories} selectedDirectories={selectedBookmarkDirectories} onChange={(directories) => {
              setSelectedBookmarkDirectories(directories)
              setItems(itemsForBookmarkDirectories(directories))
              setHasChecked(false)
            }} />
            <DiskDirectorySelect directories={diskDirectories} selectedDirectoryIds={selectedDiskDirectoryIds} onChange={(directoryIds) => {
              setSelectedDiskDirectoryIds(directoryIds)
              setHasChecked(false)
            }} />
            <Button
              type="button"
              size="sm"
              onClick={() => void handleRunCheck()}
              disabled={isChecking || allBookmarkItems.length === 0 || selectedBookmarkDirectories.length === 0}
              className="h-8 shrink-0 gap-2 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
            >
              {isChecking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {isChecking ? 'Checking' : 'Run Check'}
            </Button>
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={handleFileChange} />

      <div className="flex flex-col gap-2 border-b border-border px-3 py-2 sm:flex-row sm:items-center">
        <div className="min-w-0 truncate text-xs text-muted-foreground">
          {fileName ? `${fileName} - ${items.length} code${items.length === 1 ? '' : 's'} from ${bookmarkDirectoryLabel}; searching ${diskDirectoryLabel}` : 'Choose a Google bookmarks HTML export'}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:ml-auto sm:flex-row sm:items-center">
          <div className="flex shrink-0 gap-1.5 sm:gap-2">
            {(['all', 'exists', 'missing'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={status === value ? 'default' : 'outline'}
                onClick={() => setStatus(value)}
                disabled={!hasChecked && value !== 'all'}
                className="h-8 shrink-0 px-2.5 text-xs capitalize"
              >
                {value} ({statusCounts[value]})
              </Button>
            ))}
          </div>
          <div className="relative min-w-0 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search bookmarks"
              className="h-8 pl-9 text-sm"
            />
          </div>
        </div>
      </div>

      {isChecking ? (
        <div className="border-b border-border bg-primary/5 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Checking bookmark codes
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-primary/10">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      ) : null}

      {selectedItems.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/45 px-3 py-2">
          <div className="mr-auto flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setSelectedRowIds(new Set())}
              aria-label="Clear selected bookmarks"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
            <span className="text-sm text-muted-foreground">{selectedItems.length} selected</span>
          </div>
          <Button type="button" size="sm" className="h-8 gap-2" onClick={openSelectedBookmarks}>
            <ExternalLink className="h-4 w-4" aria-hidden />
            Open Selected
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto scrollbar sm:hidden">
        <div className="space-y-2 p-2">
          {filteredItems.length ? filteredItems.map((item) => (
            <article
              key={bookmarkRowId(item)}
              className="cursor-pointer select-none rounded-md border border-border bg-background p-3 shadow-sm"
              onClick={(event) => handleRowClick(item, event)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <Checkbox
                    className="mt-0.5 shrink-0"
                    checked={selectedRowIds.has(bookmarkRowId(item))}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(checked) => toggleRowSelection(item, checked === true)}
                    aria-label={`Select ${item.videoCode}`}
                  />
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-semibold">{item.videoCode}</div>
                    <h3 className="mt-1 truncate text-sm font-medium" title={item.title}>{item.title}</h3>
                  </div>
                </div>
                {hasChecked ? <BookmarkStatusBadge exists={item.fileExists} /> : <span className="text-xs text-muted-foreground">Not checked</span>}
              </div>
              <div className="mt-3 break-all rounded-md bg-secondary/35 px-2 py-1.5 text-xs text-muted-foreground">{item.url}</div>
              <div className="mt-3 rounded-md border border-border/70 px-2 py-2">
                {hasChecked ? <MatchedFilesSummary files={item.matchedFiles} /> : <span className="text-xs text-muted-foreground">Select a bookmark folder and run check</span>}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(event) => {
                  event.stopPropagation()
                  openBookmark(item.url)
                }}
                className="mt-3 h-8 w-full gap-2"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                Open
              </Button>
            </article>
          )) : (
            <div className="px-3 py-14 text-center text-sm text-muted-foreground">No Bookmark Video Codes Found</div>
          )}
        </div>
      </div>

      <div className="hidden min-h-0 flex-1 overflow-auto scrollbar sm:block">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <colgroup>
            <col className="w-12" />
            <col className="w-44" />
            <col className="w-[34%]" />
            <col className="w-[28%]" />
            <col className="w-28" />
            <col className="w-16" />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border bg-background/95 text-xs uppercase text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-semibold">
                <Checkbox
                  checked={visibleSelectionState}
                  onCheckedChange={toggleVisibleSelection}
                  disabled={filteredItems.length === 0}
                  aria-label={allVisibleSelected ? 'Deselect visible bookmarks' : 'Select visible bookmarks'}
                />
              </th>
              <th className="px-3 py-2 font-semibold">Code</th>
              <th className="px-3 py-2 font-semibold">Bookmark</th>
              <th className="px-3 py-2 font-semibold">Matched Local File</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Open</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length ? filteredItems.map((item) => (
              <tr
                key={bookmarkRowId(item)}
                className="cursor-pointer select-none border-b border-border/70 last:border-0 hover:bg-secondary/40"
                onClick={(event) => handleRowClick(item, event)}
              >
                <td className="px-3 py-2 align-top">
                  <Checkbox
                    checked={selectedRowIds.has(bookmarkRowId(item))}
                    onClick={(event) => event.stopPropagation()}
                    onCheckedChange={(checked) => toggleRowSelection(item, checked === true)}
                    aria-label={`Select ${item.videoCode}`}
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2 align-top font-mono font-semibold">{item.videoCode}</td>
                <td className="min-w-0 px-3 py-2 align-top">
                  <div className="whitespace-normal break-words font-medium" title={item.title}>{item.title}</div>
                  <div className="mt-1 whitespace-normal break-all text-xs text-muted-foreground" title={item.url}>{item.url}</div>
                </td>
                <td className="min-w-0 px-3 py-2 align-top">
                  {hasChecked ? <MatchedFilesSummary files={item.matchedFiles} /> : <span className="text-xs text-muted-foreground">Select a bookmark folder and run check</span>}
                </td>
                <td className="px-3 py-2 align-top">{hasChecked ? <BookmarkStatusBadge exists={item.fileExists} /> : <span className="text-xs text-muted-foreground">Not checked</span>}</td>
                <td className="px-3 py-2 text-right align-top">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation()
                      openBookmark(item.url)
                    }}
                    title="Open bookmark"
                    aria-label={`Open ${item.videoCode}`}
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </Button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-3 py-14 text-center text-sm text-muted-foreground">
                  No Bookmark Video Codes Found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function selectionLabel(selectedCount: number, totalCount: number, noun: string) {
  if (selectedCount === 0) return `no ${noun}s selected`
  if (selectedCount === totalCount) return `all ${totalCount} ${noun}${totalCount === 1 ? '' : 's'}`
  return `${selectedCount} ${noun}${selectedCount === 1 ? '' : 's'}`
}

function bookmarkRowId(item: BookmarkVideoCheckItem) {
  return `${item.videoCode}\u0000${item.url}`
}

function diskSelectionLabel(selectedCount: number, totalCount: number) {
  if (selectedCount === 0) return 'all disk directories'
  if (selectedCount === totalCount) return `all ${totalCount} disk director${totalCount === 1 ? 'y' : 'ies'}`
  return `${selectedCount} disk director${selectedCount === 1 ? 'y' : 'ies'}`
}

function toTitleCase(label: string) {
  return label.replace(/\b\w/g, (char) => char.toUpperCase())
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

interface BookmarkDirectoryNode {
  name: string
  path: string
  children: BookmarkDirectoryNode[]
}

const HIDDEN_BOOKMARK_ROOTS = new Set(['Bookmarks bar'])

function buildBookmarkDirectoryTree(directories: string[]) {
  const roots: BookmarkDirectoryNode[] = []
  const nodes = new Map<string, BookmarkDirectoryNode>()

  for (const directory of directories) {
    const parts = directory.split(' / ').filter(Boolean)
    let parentChildren = roots
    let currentPath = ''

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath} / ${part}` : part
      let node = nodes.get(currentPath)
      if (!node) {
        node = { name: part, path: currentPath, children: [] }
        nodes.set(currentPath, node)
        parentChildren.push(node)
      }
      parentChildren = node.children
    }
  }

  const sortNodes = (items: BookmarkDirectoryNode[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name))
    items.forEach((item) => sortNodes(item.children))
  }

  sortNodes(roots)
  return roots.flatMap((node) => HIDDEN_BOOKMARK_ROOTS.has(node.name) ? node.children : [node])
}

function collectBookmarkDirectoryPaths(node: BookmarkDirectoryNode) {
  return [node.path, ...node.children.flatMap(collectBookmarkDirectoryPaths)]
}

function collectExpandableBookmarkDirectoryPaths(nodes: BookmarkDirectoryNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.children.length > 0 ? [node.path] : []),
    ...collectExpandableBookmarkDirectoryPaths(node.children),
  ])
}

function BookmarkDirectorySelect({
  directories,
  selectedDirectories,
  onChange,
}: {
  directories: string[]
  selectedDirectories: string[]
  onChange: (directories: string[]) => void
}) {
  const selectedDirectoryLabel = selectionLabel(selectedDirectories.length, directories.length, 'bookmark folder')
  const [isOpen, setIsOpen] = useState(false)
  const [draftDirectories, setDraftDirectories] = useState<string[]>(selectedDirectories)
  const [expandedDirectories, setExpandedDirectories] = useState<string[]>([])
  const directoryTree = useMemo(() => buildBookmarkDirectoryTree(directories), [directories])
  const expandableDirectories = useMemo(() => collectExpandableBookmarkDirectoryPaths(directoryTree), [directoryTree])

  useEffect(() => {
    if (isOpen) {
      setDraftDirectories(selectedDirectories)
      setExpandedDirectories([])
    }
  }, [isOpen, selectedDirectories])

  const handleDone = () => {
    onChange(draftDirectories)
    setIsOpen(false)
  }

  const toggleDirectoryGroup = (node: BookmarkDirectoryNode) => {
    const groupPaths = collectBookmarkDirectoryPaths(node)
    const groupSet = new Set(groupPaths)
    const selectedSet = new Set(draftDirectories)
    const allSelected = groupPaths.every((path) => selectedSet.has(path))

    setDraftDirectories(allSelected
      ? draftDirectories.filter((directory) => !groupSet.has(directory))
      : Array.from(new Set([...draftDirectories, ...groupPaths])))
  }

  const toggleExpandedDirectory = (path: string) => {
    setExpandedDirectories(toggleValue(expandedDirectories, path))
  }

  const renderDirectoryNode = (node: BookmarkDirectoryNode, depth = 0): React.ReactNode => {
    const groupPaths = collectBookmarkDirectoryPaths(node)
    const selectedCount = groupPaths.filter((path) => draftDirectories.includes(path)).length
    const checked = selectedCount === 0 ? false : selectedCount === groupPaths.length ? true : 'indeterminate'
    const isExpanded = expandedDirectories.includes(node.path)
    const hasChildren = node.children.length > 0
    const checkboxId = `bookmark-dir-${node.path.replace(/[^a-z0-9_-]+/gi, '-')}`

    return (
      <div key={node.path}>
        <div
          className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-secondary/60"
          style={{ paddingLeft: `${8 + depth * 18}px` }}
          onClick={() => toggleDirectoryGroup(node)}
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            onClick={(event) => {
              event.stopPropagation()
              if (hasChildren) toggleExpandedDirectory(node.path)
            }}
            disabled={!hasChildren}
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />
            ) : <span className="h-4 w-4" aria-hidden />}
          </Button>
          <Checkbox
            id={checkboxId}
            checked={checked}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={() => toggleDirectoryGroup(node)}
          />
          <Label htmlFor={checkboxId} className="block min-w-0 flex-1 cursor-pointer truncate text-sm" title={node.path}>
            {node.name}
          </Label>
        </div>
        {hasChildren && isExpanded ? node.children.map((child) => renderDirectoryNode(child, depth + 1)) : null}
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 max-w-64 shrink-0 justify-start gap-2 px-2.5 text-xs font-normal sm:h-9 sm:px-3 sm:text-sm">
          <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{toTitleCase(selectedDirectoryLabel)}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select Bookmark Folder</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-4 scrollbar">
          {directoryTree.map((node) => renderDirectoryNode(node))}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setExpandedDirectories(expandableDirectories)}
              disabled={expandableDirectories.length === 0 || expandedDirectories.length === expandableDirectories.length}
            >
              Expand All
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setExpandedDirectories([])}
              disabled={expandedDirectories.length === 0}
            >
              Collapse All
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDraftDirectories([])}
              disabled={draftDirectories.length === 0}
            >
              Deselect All
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDraftDirectories(directories)}
              disabled={directories.length === 0 || draftDirectories.length === directories.length}
            >
              Select All
            </Button>
            <Button type="button" size="sm" onClick={handleDone}>
              Done
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function directoryDisplayName(directory: DirectoryRecord) {
  return directory.name
}

function isLikelyDirectoryRecord(directory: DirectoryRecord) {
  const name = directory.name.trim()
  if (!name) return false
  return !/\.(?:avi|flv|m4v|mkv|mov|mp4|srt|vtt|wmv)$/i.test(name)
}

function selectableDiskDirectories(directories: DirectoryRecord[]) {
  return directories.filter((directory) => directory.parent_id !== null && isLikelyDirectoryRecord(directory))
}

interface DiskDirectoryNode extends DirectoryRecord {
  children: DiskDirectoryNode[]
}

function buildDiskDirectoryTree(directories: DirectoryRecord[]) {
  const selectableDirectories = selectableDiskDirectories(directories)
  const roots: DiskDirectoryNode[] = []
  const nodes = new Map<string, DiskDirectoryNode>()

  for (const directory of selectableDirectories) {
    nodes.set(directory.id, { ...directory, children: [] })
  }

  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : null
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (items: DiskDirectoryNode[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
    items.forEach((item) => sortNodes(item.children))
  }

  sortNodes(roots)
  return roots
}

function collectDiskDirectoryIds(node: DiskDirectoryNode) {
  return [node.id, ...node.children.flatMap(collectDiskDirectoryIds)]
}

function collectExpandableDiskDirectoryIds(nodes: DiskDirectoryNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.children.length > 0 ? [node.id] : []),
    ...collectExpandableDiskDirectoryIds(node.children),
  ])
}

export function DiskDirectorySelect({
  directories,
  selectedDirectoryIds,
  onChange,
}: {
  directories: DirectoryRecord[]
  selectedDirectoryIds: string[]
  onChange: (directoryIds: string[]) => void
}) {
  const selectableDirectories = selectableDiskDirectories(directories)
  const selectedDirectoryLabel = diskSelectionLabel(selectedDirectoryIds.length, selectableDirectories.length)
  const [isOpen, setIsOpen] = useState(false)
  const [draftDirectoryIds, setDraftDirectoryIds] = useState<string[]>(selectedDirectoryIds)
  const [expandedDirectoryIds, setExpandedDirectoryIds] = useState<string[]>([])
  const directoryTree = useMemo(() => buildDiskDirectoryTree(directories), [directories])
  const expandableDirectoryIds = useMemo(() => collectExpandableDiskDirectoryIds(directoryTree), [directoryTree])

  useEffect(() => {
    if (isOpen) {
      setDraftDirectoryIds(selectedDirectoryIds)
      setExpandedDirectoryIds([])
    }
  }, [isOpen, selectedDirectoryIds])

  const handleDone = () => {
    onChange(draftDirectoryIds)
    setIsOpen(false)
  }

  const toggleDirectoryGroup = (node: DiskDirectoryNode) => {
    const groupIds = collectDiskDirectoryIds(node)
    const groupSet = new Set(groupIds)
    const selectedSet = new Set(draftDirectoryIds)
    const allSelected = groupIds.every((directoryId) => selectedSet.has(directoryId))

    setDraftDirectoryIds(allSelected
      ? draftDirectoryIds.filter((directoryId) => !groupSet.has(directoryId))
      : Array.from(new Set([...draftDirectoryIds, ...groupIds])))
  }

  const toggleExpandedDirectory = (directoryId: string) => {
    setExpandedDirectoryIds(toggleValue(expandedDirectoryIds, directoryId))
  }

  const renderDirectoryNode = (node: DiskDirectoryNode, depth = 0): React.ReactNode => {
    const groupIds = collectDiskDirectoryIds(node)
    const selectedCount = groupIds.filter((directoryId) => draftDirectoryIds.includes(directoryId)).length
    const checked = selectedCount === 0 ? false : selectedCount === groupIds.length ? true : 'indeterminate'
    const isExpanded = expandedDirectoryIds.includes(node.id)
    const hasChildren = node.children.length > 0

    return (
      <div key={node.id}>
        <div
          className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-secondary/60"
          style={{ paddingLeft: `${8 + depth * 18}px` }}
          onClick={() => toggleDirectoryGroup(node)}
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            onClick={(event) => {
              event.stopPropagation()
              if (hasChildren) toggleExpandedDirectory(node.id)
            }}
            disabled={!hasChildren}
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />
            ) : <span className="h-4 w-4" aria-hidden />}
          </Button>
          <Checkbox
            id={`disk-dir-${node.id}`}
            checked={checked}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={() => toggleDirectoryGroup(node)}
          />
          <Label htmlFor={`disk-dir-${node.id}`} className="block min-w-0 flex-1 cursor-pointer truncate text-sm" title={node.path}>
            {directoryDisplayName(node)}
          </Label>
        </div>
        {hasChildren && isExpanded ? node.children.map((child) => renderDirectoryNode(child, depth + 1)) : null}
      </div>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 max-w-64 shrink-0 justify-start gap-2 px-2.5 text-xs font-normal sm:h-9 sm:px-3 sm:text-sm">
          <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{toTitleCase(selectedDirectoryLabel)}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select Disk Directories</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-4 scrollbar">
          {directoryTree.map((node) => renderDirectoryNode(node))}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setExpandedDirectoryIds(expandableDirectoryIds)}
              disabled={expandableDirectoryIds.length === 0 || expandedDirectoryIds.length === expandableDirectoryIds.length}
            >
              Expand All
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setExpandedDirectoryIds([])}
              disabled={expandedDirectoryIds.length === 0}
            >
              Collapse All
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDraftDirectoryIds([])}
              disabled={draftDirectoryIds.length === 0}
            >
              Deselect All
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setDraftDirectoryIds(selectableDirectories.map((directory) => directory.id))}
              disabled={selectableDirectories.length === 0 || draftDirectoryIds.length === selectableDirectories.length}
            >
              Select All
            </Button>
            <Button type="button" size="sm" onClick={handleDone}>
              Done
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
