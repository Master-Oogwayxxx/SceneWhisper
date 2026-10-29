import { type ComponentType, type MouseEvent, type ReactNode, useEffect, useState } from 'react'

import { AlertCircle, Ban, Check, CheckCircle2, Clock, Copy, Download, Eye, Film, Info, LoaderCircle, MoreHorizontal, RefreshCw, Trash2, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ActressWorkTorrentDialog } from '@/components/ActressWorkTorrentDialog'
import { r18Api } from '@/api/r18'
import { useSettings } from '@/hooks/useSettings'
import { buildExternalVideoTargetUrl, isValidExternalVideoTarget } from '@/lib/external-video-targets'
import { copyTextToClipboard } from '@/lib/utils'
import { r18Keys } from '@/hooks/useR18'
import type { ActressWork, DownloadQueueItem, TorrentStatus } from '@/types/types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { useQueryClient } from '@tanstack/react-query'

const OPEN_EXTERNAL_LINK_DELAY_MS = 3000

interface ActressWorkCardProps {
  work: ActressWork
  actressName?: string | null
  defaultSavePath?: string | null
  showCover?: boolean
  className?: string
  downloadStatus?: TorrentStatus
  queueItem?: DownloadQueueItem
  selected?: boolean
  showTitle?: boolean
  onToggleSelect?: (videoCode: string, shiftKey?: boolean) => void
  onDownloadAgain?: () => void
  onCancelDownload?: () => void
}

type ActionMenuItemComponent = ComponentType<{
  children?: ReactNode
  className?: string
  onSelect?: (event: Event) => void
}>

type ActionMenuSubTriggerComponent = ComponentType<{
  children?: ReactNode
  onClick?: (event: MouseEvent) => void
}>

type ActionMenuSubComponent = ComponentType<{ children?: ReactNode }>

export const ActressWorkCard = ({ work, actressName, defaultSavePath, showCover = false, showTitle = true, className, downloadStatus, queueItem, selected, onToggleSelect, onDownloadAgain, onCancelDownload }: ActressWorkCardProps) => {
  const title = work.title_en ?? work.title_ja ?? 'Untitled'
  const formattedId = work.video_code ?? work.dvd_id ?? work.content_id ?? ''
  const fileExists = work.file_exists ?? false
  const isUncensored = work.is_uncensored ?? false
  const isCensored = fileExists && !isUncensored
  const isSubtitled = work.is_subtitled ?? false
  const resolutionLabel = work.resolution === '4k' ? '4K' : work.resolution === 'sd' ? 'SD' : work.resolution
  const fileDeleted = !fileExists && work.local_file_state === 'deleted'
  const { settings } = useSettings()
  const queryClient = useQueryClient()
  const externalVideoTargets = settings.external_video_targets.filter(isValidExternalVideoTarget)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [videoInfoOpen, setVideoInfoOpen] = useState(false)
  const [torrentInfoOpen, setTorrentInfoOpen] = useState(false)
  const [titleCopied, setTitleCopied] = useState(false)
  const [openedSites, setOpenedSites] = useState<string[]>(work.opened_sites ?? [])
  const qbitQueuedStates = new Set(['queuedDL', 'metaDL', 'stalledDL', 'checkingDL', 'checkingResumeData', 'pausedDL', 'stoppedDL'])
  const isAwaitingQbitMatch = Boolean(
    downloadStatus &&
    downloadStatus.status === 'downloading' &&
    !downloadStatus.torrent_hash &&
    !downloadStatus.state &&
    downloadStatus.progress === 0 &&
    downloadStatus.speed === 0 &&
    Date.now() - new Date(downloadStatus.added_at).getTime() < 5 * 60 * 1000
  )
  const isQueuedInQbit = Boolean(
    downloadStatus &&
    downloadStatus.status === 'downloading' &&
    downloadStatus.state &&
    qbitQueuedStates.has(downloadStatus.state)
  )
  const isStalledInQbit = downloadStatus?.state === 'stalledDL'

  useEffect(() => {
    setOpenedSites(work.opened_sites ?? [])
  }, [work.content_id, work.opened_sites])

  const shouldShowDownloadProgress = Boolean(
    downloadStatus?.status === 'downloading' &&
    !isQueuedInQbit
  )

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const formatEta = (seconds: number): string => {
    if (seconds < 0) return '∞'
    if (seconds < 60) return `${seconds}s`
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    if (m < 60) return `${m}m ${s}s`
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }

  const formatDateTime = (value: string | number | null | undefined): string => {
    if (!value) return 'Unknown'
    const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return date.toLocaleString('en-US', { timeZoneName: 'short' })
  }

  const formatValue = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined || value === '') return 'Unavailable'
    return String(value)
  }

  const torrentInfoRows = downloadStatus ? [
    ['Torrent name', downloadStatus.torrent_name],
    ['Status', downloadStatus.state ?? downloadStatus.status],
    ['Seeders', downloadStatus.seeders ?? null],
    ['Progress', `${Math.round(downloadStatus.progress * 100)}%`],
    ['Speed', downloadStatus.speed > 0 ? `${formatBytes(downloadStatus.speed)}/s` : '0 B/s'],
    ['ETA', formatEta(downloadStatus.eta)],
    ['Size', downloadStatus.total_size ?? downloadStatus.size ? formatBytes(downloadStatus.total_size ?? downloadStatus.size ?? 0) : null],
    ['Hash', downloadStatus.torrent_hash],
    ['Created', formatDateTime(downloadStatus.created_at)],
    ['Tracked since', formatDateTime(downloadStatus.added_at)],
    ['Completed', downloadStatus.completed_at ? formatDateTime(downloadStatus.completed_at) : null],
    ['Save path', downloadStatus.save_path],
  ] : []

  const videoInfoRows = [
    ['Actress', actressName],
    ['Title', title],
    ['Japanese title', work.title_ja],
    ['Video code', work.video_code],
    ['DVD ID', work.dvd_id],
    ['Content ID', work.content_id],
    ['Release date', work.release_date],
    ['Resolution', resolutionLabel],
    ['File state', fileDeleted ? 'Deleted from disk' : fileExists ? 'Found on disk' : 'Not found on disk'],
    ['Uncensored', isUncensored ? 'Yes' : 'No'],
    ['Subtitled', isSubtitled ? 'Yes' : 'No'],
    ['Opened sites', openedSites.length ? openedSites.join(', ') : 'None'],
    ['Image URL', work.image_url],
  ]

  const handleOpenExternalVideoTarget = (label: string, urlTemplate: string) => {
    if (!formattedId) return
    persistOpenedState(label)
    window.open(buildExternalVideoTargetUrl({ label: '', url_template: urlTemplate }, formattedId, actressName ?? ''), '_blank', 'noopener,noreferrer')
  }

  const openExternalVideoTargetsConsecutively = async () => {
    if (!formattedId) return
    externalVideoTargets.forEach((target) => persistOpenedState(target.label))

    const openedTabs: Window[] = []

    for (const target of externalVideoTargets) {
      const tab = window.open('about:blank', '_blank')
      if (!tab) {
        continue
      }

      try {
        tab.opener = null
      } catch {
        // Some browsers block reassignment; opening still works without it.
      }

      openedTabs.push(tab)
    }

    for (let index = 0; index < openedTabs.length; index += 1) {
      const tab = openedTabs[index]
      const target = externalVideoTargets[index]
      tab.location.href = buildExternalVideoTargetUrl(target, formattedId, actressName ?? '')
      if (index < openedTabs.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, OPEN_EXTERNAL_LINK_DELAY_MS))
      }
    }
  }

  const handleCopyTitle = () => {
    if (!formattedId) return
    void copyTextToClipboard(formattedId)
      .then(() => {
        setTitleCopied(true)
        window.setTimeout(() => setTitleCopied(false), 1500)
      })
      .catch(() => {
        // Keep the card quiet if clipboard access is unavailable.
      })
  }

  const handleMenuAction = (event: Event, action: () => void) => {
    event.stopPropagation()
    action()
  }

  const persistOpenedState = (site: string) => {
    const sites = site.split(', ').filter(Boolean)
    setOpenedSites((current) => [...new Set([...current, ...sites])])
    void r18Api.markActressWorkOpened(work.content_id, site)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: r18Keys.all() })
      })
      .catch(() => {
        // Keep the UI responsive even if the persisted flag fails to save.
      })
  }

  const handleOpenDetails = (event: Event) => {
    handleMenuAction(event, () => {
      setDialogOpen(true)
    })
  }

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open)
  }

  const ActressWorkActionMenuItems = ({
    Item,
    Sub,
    SubContent,
    SubTrigger,
  }: {
    Item: ActionMenuItemComponent
    Sub: ActionMenuSubComponent
    SubContent: ActionMenuSubComponent
    SubTrigger: ActionMenuSubTriggerComponent
  }) => (
    <>
      <Item onSelect={(event) => handleMenuAction(event, () => setVideoInfoOpen(true))}>
        <Film className="h-5 w-5 mr-2" />
        View Video Info
      </Item>
      {downloadStatus && (
        <Item onSelect={(event) => handleMenuAction(event, () => setTorrentInfoOpen(true))}>
          <Info className="h-5 w-5 mr-2" />
          View Torrent Info
        </Item>
      )}
      <Item onSelect={handleOpenDetails}>
        <Download className="h-5 w-5 mr-2" />
        Download
      </Item>
      {externalVideoTargets.length > 0 && (
        <Sub>
          <SubTrigger onClick={(e) => e.stopPropagation()}>
            <Info className="h-5 w-5 mr-2" />
            Open in
          </SubTrigger>
          <SubContent>
            {externalVideoTargets.length > 1 && (
              <Item
                onSelect={(event) => handleMenuAction(event, () => void openExternalVideoTargetsConsecutively())}
              >
                All sites
              </Item>
            )}
            {externalVideoTargets.map((target) => (
              <Item
                key={target.label + target.url_template}
                onSelect={(event) => handleMenuAction(event, () => handleOpenExternalVideoTarget(target.label, target.url_template))}
              >
                {target.label}
              </Item>
            ))}
          </SubContent>
        </Sub>
      )}
      {(queueItem?.status === 'done' || queueItem?.status === 'failed' || queueItem?.status === 'skipped') && onDownloadAgain && (
        <Item onSelect={(event) => handleMenuAction(event, onDownloadAgain)}>
          <RefreshCw className="h-5 w-5 mr-2" />
          {queueItem.status === 'done' ? 'Download Again' : 'Retry Download'}
        </Item>
      )}
      {((queueItem && (queueItem.status === 'pending' || queueItem.status === 'processing')) ||
        (downloadStatus?.status === 'downloading' && queueItem?.status !== 'done')) &&
        onCancelDownload && (
          <Item
            onSelect={(event) => handleMenuAction(event, () => setCancelConfirmOpen(true))}
            className="text-destructive focus:text-destructive"
          >
            <XCircle className="h-5 w-5 mr-2" />
            Cancel
          </Item>
        )}
    </>
  )

  const handleCardPointerDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!onToggleSelect) return
    if (event.button !== 0) return

    const target = event.target
    if (target instanceof Element && target.closest('[role="menu"], [role="menuitem"]')) {
      return
    }

    if (window.getSelection()?.toString()) {
      return
    }

    event.preventDefault()
    onToggleSelect(work.content_id, event.shiftKey)
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Card
            className={cn(
              'overflow-hidden h-full relative group flex flex-col border-2 transition-colors select-none',
              selected ? 'border-primary' : 'border-transparent',
              className
            )}
            onMouseDown={handleCardPointerDown}
            draggable={false}
            role={onToggleSelect ? 'button' : undefined}
            aria-pressed={onToggleSelect ? (selected ?? false) : undefined}
          >
        {formattedId && (
          <div className={cn('absolute top-1 right-1 z-10 transition-opacity', menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
            <DropdownMenu onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-black/25 text-muted-foreground hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <ActressWorkActionMenuItems
                  Item={DropdownMenuItem}
                  Sub={DropdownMenuSub}
                  SubContent={DropdownMenuSubContent}
                  SubTrigger={DropdownMenuSubTrigger}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {showCover && (
          <div className="aspect-[147/200] bg-muted relative">
            {work.image_url ? (
              <img
                src={work.image_url}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-contain"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <Film className="h-10 w-10" />
              </div>
            )}
            {(fileExists || fileDeleted || isUncensored || isCensored || isSubtitled || resolutionLabel) && (
              <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                {fileExists && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <CheckCircle2 className="h-5 w-5 text-green-500 drop-shadow" />
                    </TooltipTrigger>
                    <TooltipContent side="right">Found on disk</TooltipContent>
                  </Tooltip>
                )}
                {fileDeleted && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Trash2 className="h-5 w-5 text-red-500 drop-shadow" />
                    </TooltipTrigger>
                    <TooltipContent side="right">Deleted from disk</TooltipContent>
                  </Tooltip>
                )}
                {isUncensored && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-amber-500 text-white hover:bg-amber-500 shadow-sm">
                        RM
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="right">Uncensored</TooltipContent>
                  </Tooltip>
                )}
                {isCensored && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-zinc-500 text-white hover:bg-zinc-500 shadow-sm">
                        CEN
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="right">Censored</TooltipContent>
                  </Tooltip>
                )}
                {isSubtitled && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-sky-500 text-white hover:bg-sky-500 shadow-sm">
                        SUB
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="right">Subtitled</TooltipContent>
                  </Tooltip>
                )}
                {resolutionLabel && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-violet-500 text-white hover:bg-violet-500 shadow-sm">
                        {resolutionLabel}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="right">Resolution: {resolutionLabel}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
        )}

        <CardContent className="flex flex-1 flex-col p-3 space-y-2">
          {formattedId && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <p className="text-md font-mono font-semibold text-primary uppercase tracking-wide">
                  {formattedId}
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      className={cn(
                        'h-6 w-6 rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100',
                        titleCopied && 'opacity-100'
                      )}
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCopyTitle()
                      }}
                      aria-label={`Copy video code ${formattedId}`}
                    >
                      {titleCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {titleCopied ? 'Copied' : 'Copy video code'}
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}
          {showTitle && (
            <>
              {work.release_date && (
                <p className="text-xs italic text-muted-foreground">
                  {work.release_date}
                </p>
              )}
              <p className="font-medium text-sm leading-snug line-clamp-2" title={title}>
                {title}
              </p>
            </>
          )}
          {(openedSites.length > 0 || queueItem || downloadStatus?.status === 'completed' || downloadStatus?.status === 'error' || ((fileExists || fileDeleted || isUncensored || isCensored || isSubtitled || resolutionLabel) && !showCover)) && (
            <div className="flex flex-1 items-center gap-1.5">
              {openedSites.length > 0 && (
                <div className="flex min-w-0 flex-wrap items-center gap-1" aria-label={`Opened on ${openedSites.join(', ')}`}>
                  <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {openedSites.map((site) => (
                    <Badge key={site} variant="secondary" className="max-w-full truncate px-1.5 text-[10px]" title={site}>
                      {site}
                    </Badge>
                  ))}
                </div>
              )}
              {queueItem?.status === 'skipped' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 w-5 justify-center p-0" aria-label="Skipped: No torrent results found">
                      <Ban className="h-4 w-4 text-white" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Skipped: No torrent results found</TooltipContent>
                </Tooltip>
              )}
              {downloadStatus?.status === 'completed' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 w-5 justify-center bg-green-500 p-0 hover:bg-green-500" aria-label="Downloaded">
                      <CheckCircle2 className="h-4 w-4 text-white" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Downloaded</TooltipContent>
                </Tooltip>
              )}
              {queueItem?.status === 'pending' && !downloadStatus && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 w-5 justify-center p-0" aria-label="Queued">
                      <Clock className="h-4 w-4 text-white" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Queued</TooltipContent>
                </Tooltip>
              )}
              {queueItem?.status === 'processing' && !downloadStatus && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 w-5 justify-center bg-blue-500 p-0 hover:bg-blue-500" aria-label="Processing">
                      <LoaderCircle className="h-4 w-4 text-white" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Processing</TooltipContent>
                </Tooltip>
              )}
              {queueItem?.status === 'done' && !downloadStatus && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 w-5 justify-center bg-green-500 p-0 hover:bg-green-500" aria-label="Done">
                      <CheckCircle2 className="h-4 w-4 text-white" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Done</TooltipContent>
                </Tooltip>
              )}
              {queueItem?.status === 'failed' && !downloadStatus && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 w-5 justify-center bg-red-500 p-0 hover:bg-red-500" aria-label={`Failed: ${queueItem.error ?? 'Unknown download error'}`}>
                      <AlertCircle className="h-4 w-4 text-white" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Failed: {queueItem.error ?? 'Unknown download error'}</TooltipContent>
                </Tooltip>
              )}
              {downloadStatus?.status === 'error' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 w-5 justify-center bg-red-500 p-0 hover:bg-red-500" aria-label="Download error">
                      <AlertCircle className="h-4 w-4 text-white" />
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Download error</TooltipContent>
                </Tooltip>
              )}
              {fileExists && !showCover && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="right">Found on disk</TooltipContent>
                </Tooltip>
              )}
              {fileDeleted && !showCover && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Trash2 className="h-6 w-6 text-red-500 shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="right">Deleted from disk</TooltipContent>
                </Tooltip>
              )}
              {isUncensored && !showCover && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-amber-500 text-white hover:bg-amber-500">
                      RM
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Uncensored</TooltipContent>
                </Tooltip>
              )}
              {isCensored && !showCover && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-zinc-500 text-white hover:bg-zinc-500">
                      CEN
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Censored</TooltipContent>
                </Tooltip>
              )}
              {isSubtitled && !showCover && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-sky-500 text-white hover:bg-sky-500">
                      SUB
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Subtitled</TooltipContent>
                </Tooltip>
              )}
              {resolutionLabel && !showCover && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-violet-500 text-white hover:bg-violet-500">
                      {resolutionLabel}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="right">Resolution: {resolutionLabel}</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          {downloadStatus?.status === 'downloading' && (
            <div className="pt-1">
              <div className="space-y-1">
                {shouldShowDownloadProgress && (
                  <Progress value={Math.round(downloadStatus.progress * 100)} className="h-1.5" />
                )}
                {isQueuedInQbit && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500/70" />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {isAwaitingQbitMatch
                    ? 'Waiting for qBittorrent...'
                    : isStalledInQbit
                      ? 'Stalled in qBittorrent'
                      : isQueuedInQbit
                        ? 'Queued in qBittorrent'
                        : `${formatBytes(downloadStatus.speed)}/s · ETA ${formatEta(downloadStatus.eta)}`}
                </p>
              </div>
            </div>
          )}
        </CardContent>
          </Card>
        </ContextMenuTrigger>
        {formattedId && (
          <ContextMenuContent>
            <ActressWorkActionMenuItems
              Item={ContextMenuItem}
              Sub={ContextMenuSub}
              SubContent={ContextMenuSubContent}
              SubTrigger={ContextMenuSubTrigger}
            />
          </ContextMenuContent>
        )}
      </ContextMenu>

      {formattedId && (
        <ActressWorkTorrentDialog
          videoCode={formattedId}
          contentId={work.content_id}
          actressName={actressName}
          defaultSavePath={defaultSavePath}
          open={dialogOpen}
          onOpenChange={handleDialogOpenChange}
        />
      )}

      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel download?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the torrent and delete any partially downloaded files. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep downloading</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onCancelDownload?.()}
            >
              Cancel download
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={videoInfoOpen} onOpenChange={setVideoInfoOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Video Info</DialogTitle>
            <DialogDescription className="font-mono text-xs uppercase tracking-wide">
              {formattedId || work.content_id}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {videoInfoRows
              .filter(([, value]) => value !== null && value !== undefined && value !== '')
              .map(([label, value]) => (
                <div key={label} className="grid grid-cols-[120px_1fr] gap-3 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="break-all">{formatValue(value)}</span>
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={torrentInfoOpen} onOpenChange={setTorrentInfoOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Torrent Info</DialogTitle>
            <DialogDescription className="font-mono text-xs uppercase tracking-wide">
              {formattedId || work.content_id}
            </DialogDescription>
          </DialogHeader>
          {downloadStatus && (
            <div className="space-y-2">
              {torrentInfoRows
                .filter(([, value]) => value !== null && value !== undefined)
                .map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[120px_1fr] gap-3 text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="break-all">{formatValue(value)}</span>
                  </div>
                ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
