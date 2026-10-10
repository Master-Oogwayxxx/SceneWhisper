import { useEffect, useMemo, useState } from 'react'
import { MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Checkbox } from '@/components/ui/checkbox'
import type { DownloadQueueItem, TorrentStatus } from '@/types/types'

const STATUS_COLORS: Record<DownloadQueueItem['status'], string> = {
  pending: 'text-muted-foreground animate-pulse',
  processing: 'text-blue-500',
  done: 'text-green-500',
  failed: 'text-destructive',
  skipped: 'text-yellow-500',
}

function getStatusLabel(status: DownloadQueueItem['status'], isQueuedInQbit: boolean): string {
  if (status === 'pending' && isQueuedInQbit) return 'queued'
  if (status === 'done') return 'completed'
  return status
}

type Tab = 'all' | DownloadQueueItem['status']

const TABS: { label: string; value: Tab }[] = [
  { label: 'All', value: 'all' },
  { label: 'Queued', value: 'pending' },
  { label: 'Processing', value: 'processing' },
  { label: 'Completed', value: 'done' },
  { label: 'Skipped', value: 'skipped' },
  { label: 'Failed', value: 'failed' },
]

const TAB_COLORS: Record<Tab, { active: string; inactive: string }> = {
  all: {
    active: 'bg-card border-border text-foreground',
    inactive: 'border-border text-muted-foreground hover:bg-card hover:text-foreground',
  },
  pending: {
    active: 'bg-warning/10 border-warning/20 text-warning',
    inactive: 'border-warning/20 text-warning hover:bg-warning/10',
  },
  processing: {
    active: 'bg-primary/10 border-primary/20 text-primary',
    inactive: 'border-primary/20 text-primary hover:bg-primary/10',
  },
  done: {
    active: 'bg-success/10 border-success/20 text-success',
    inactive: 'border-success/20 text-success hover:bg-success/10',
  },
  skipped: {
    active: 'bg-warning/10 border-warning/20 text-warning',
    inactive: 'border-warning/20 text-warning hover:bg-warning/10',
  },
  failed: {
    active: 'bg-destructive/10 border-destructive/20 text-destructive',
    inactive: 'border-destructive/20 text-destructive hover:bg-destructive/10',
  },
}

const QBIT_QUEUED_STATES = new Set([
  'queuedDL',
  'metaDL',
  'stalledDL',
  'checkingDL',
  'checkingResumeData',
  'pausedDL',
  'stoppedDL',
])

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1_048_576) return `${(bytesPerSec / 1_048_576).toFixed(1)} MB/s`
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${bytesPerSec} B/s`
}

function formatEta(seconds: number): string {
  if (seconds < 0 || seconds > 86400 * 7) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: DownloadQueueItem[]
  downloadsMap?: Map<string, TorrentStatus>
  onDeleteItem: (item: DownloadQueueItem) => Promise<void>
  onRetryItem: (item: DownloadQueueItem) => Promise<void>
  onRefresh: () => void
}

export function ActressWorkQueueDialog({
  open,
  onOpenChange,
  items,
  downloadsMap,
  onDeleteItem,
  onRetryItem,
  onRefresh,
}: Props) {
  const [tab, setTab] = useState<Tab>('all')
  const [confirmItem, setConfirmItem] = useState<DownloadQueueItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set())

  const getDisplayStatus = (item: DownloadQueueItem): DownloadQueueItem['status'] => {
    const ts = downloadsMap?.get(item.content_id || item.video_code)
    const isQueuedInQbit = Boolean(
      item.status === 'processing' &&
      ts &&
      ts.status === 'downloading' &&
      ts.state &&
      QBIT_QUEUED_STATES.has(ts.state)
    )

    return isQueuedInQbit ? 'pending' : item.status
  }

  const sorted = [...items].sort((a, b) => {
    const order = { processing: 0, pending: 1, failed: 2, skipped: 3, done: 4 }
    return (order[getDisplayStatus(a)] ?? 5) - (order[getDisplayStatus(b)] ?? 5)
  })
  const filtered = tab === 'all' ? sorted : sorted.filter((i) => getDisplayStatus(i) === tab)
  const filteredIds = useMemo(() => new Set(filtered.map((item) => item.id)), [filtered])

  useEffect(() => {
    setSelectedItems((prev) => {
      if (prev.size === 0) return prev

      const next = new Set(Array.from(prev).filter((id) => filteredIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filteredIds])

  function handleDeleteClick(item: DownloadQueueItem) {
    if (item.status === 'processing') {
      setConfirmItem(item)
    } else {
      doDelete(item)
    }
  }

  function handleSelectItem(itemId: number) {
    setSelectedItems(prev => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  function handleSelectAll() {
    if (selectedItems.size === filtered.length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(filtered.map(item => item.id)))
    }
  }

  function isItemSelected(itemId: number) {
    return selectedItems.has(itemId)
  }

  function getSelectedCount() {
    return selectedItems.size
  }

  async function doDeleteSelected() {
    if (selectedItems.size === 0) return

    const selectedItemsArray = Array.from(selectedItems)
    const deletePromises = selectedItemsArray.map(id => {
      const item = items.find(i => i.id === id)
      if (item) return onDeleteItem(item)
      return Promise.resolve()
    })

    try {
      await Promise.all(deletePromises)
      onRefresh()
      setSelectedItems(new Set())
    } catch (error) {
      console.error('Error deleting selected items:', error)
    }
  }

  async function doDelete(item: DownloadQueueItem) {
    setDeleting(true)
    try {
      await onDeleteItem(item)
      onRefresh()
    } finally {
      setDeleting(false)
      setConfirmItem(null)
    }
  }

  async function doRetry(item: DownloadQueueItem) {
    setDeleting(true)
    try {
      await onRetryItem(item)
      onRefresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-3xl flex flex-col gap-3 h-[95vh]">
          <DialogHeader className="flex flex-row items-center justify-between">
            <DialogTitle>Download Queue</DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            {TABS.map(({ label, value }) => {
              const count = value === 'all' ? items.length : items.filter((i) => getDisplayStatus(i) === value).length
              return (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  className={`px-3 py-1.5 rounded border text-sm font-medium transition-colors ${tab === value
                    ? TAB_COLORS[value].active
                    : TAB_COLORS[value].inactive
                    }`}
                >
                  {label}
                  {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
                </button>
              )
            })}
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No items.</p>
          ) : (
            <ul className="flex-1 overflow-y-auto space-y-2 scrollbar pr-2">
              {filtered.map((item, idx) => {
                const ts = downloadsMap?.get(item.content_id || item.video_code)
                const displayStatus = getDisplayStatus(item)
                const isDownloading = item.status === 'processing' && ts && ts.status === 'downloading'
                const isQueuedInQbit = Boolean(
                  isDownloading &&
                  ts &&
                  ts.state &&
                  QBIT_QUEUED_STATES.has(ts.state)
                )
                const isAwaitingQbitMatch = Boolean(
                  isDownloading &&
                  ts &&
                  !ts.torrent_hash &&
                  !ts.state &&
                  ts.progress === 0 &&
                  ts.speed === 0 &&
                  Date.now() - new Date(ts.added_at).getTime() < 5 * 60 * 1000
                )
                return (
                  <li
                    key={item.id}
                    className={`flex items-stretch gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm shadow-sm ${isItemSelected(item.id) ? 'border-primary border-2' : ''}`}
                    onClick={() => handleSelectItem(item.id)}
                  >
                    <div className="flex flex-col flex-1 gap-1.5 min-w-0 justify-center">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 w-5 text-right text-muted-foreground">{idx + 1}.</span>
                        <span className="flex-1 truncate font-medium uppercase">{item.video_code}</span>
                      </div>
                      {item.status === 'skipped' && (
                        <div className="pl-7 text-xs text-muted-foreground break-words">
                          No torrent results found
                        </div>
                      )}
                      {item.error && (
                        <div className="pl-7 text-xs text-destructive break-words" title={item.error}>
                          {item.error}
                        </div>
                      )}
                      {isDownloading && !isQueuedInQbit && (
                        <div className="flex flex-col gap-1 pl-7">
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all duration-500"
                              style={{ width: `${Math.round(ts.progress * 100)}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            {isAwaitingQbitMatch ? (
                              <span>Waiting for qBittorrent...</span>
                            ) : (
                              <>
                                <span>{Math.round(ts.progress * 100)}% · {formatSpeed(ts.speed)}</span>
                                <span>ETA {formatEta(ts.eta)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-center text-center">
                      <span className={`capitalize ${STATUS_COLORS[displayStatus]}`}>
                        {getStatusLabel(displayStatus, isQueuedInQbit)}
                      </span>
                    </div>
                    <div className="flex items-center shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal size={18} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(item.status === 'done' || item.status === 'failed' || item.status === 'skipped') && (
                            <DropdownMenuItem onClick={() => void doRetry(item)}>
                              <RefreshCw size={14} className="mr-2" />
                              {item.status === 'done' ? 'Download Again' : 'Retry Download'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive focus:bg-destructive/10"
                            onClick={() => handleDeleteClick(item)}
                          >
                            <Trash2 size={14} className="mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {selectedItems.size > 0 && (
            <div className="flex justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
              >
                {selectedItems.size > 0 && selectedItems.size === filtered.length ? 'Deselect All' : 'Select All'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => doDeleteSelected()}
                disabled={deleting}
              >
                <Trash2 size={14} className="mr-2" />
                Delete {selectedItems.size} Selected
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmItem !== null} onOpenChange={(open) => { if (!open) setConfirmItem(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {confirmItem?.video_code}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will also remove the torrent and its downloaded files from qBittorrent. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setConfirmItem(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmItem && doDelete(confirmItem)}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
