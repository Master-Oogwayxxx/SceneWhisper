import { useEffect, useRef, useState, type MouseEvent } from 'react'

import { Check, Copy, Download, Link, Loader2, Magnet } from 'lucide-react'
import { toast } from 'sonner'

import { r18Api } from '@/api/r18'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { NyaaResult } from '@/types/types'
import { copyTextToClipboard } from '@/lib/utils'

interface ActressWorkTorrentDialogProps {
  videoCode: string
  contentId: string
  actressName?: string | null
  defaultSavePath?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type DownloadState = 'idle' | 'loading' | 'results' | 'sending'
type CopyAction = 'torrent' | 'magnet' | 'title'

export const ActressWorkTorrentDialog = ({ videoCode, contentId, actressName, defaultSavePath, open, onOpenChange }: ActressWorkTorrentDialogProps) => {
  const [downloadState, setDownloadState] = useState<DownloadState>('idle')
  const [nyaaResults, setNyaaResults] = useState<NyaaResult[]>([])
  const [savePath, setSavePath] = useState('')
  const [showSavePath, setShowSavePath] = useState<{ [key: string]: boolean }>({})
  const [downloadingTorrent, setDownloadingTorrent] = useState<string | null>(null)
  const [magnetLoading, setMagnetLoading] = useState<{ [key: string]: boolean }>({})
  const [resolvedMagnets, setResolvedMagnets] = useState<{ [key: string]: string }>({})
  const [torrentsWithSavePaths, setTorrentsWithSavePaths] = useState<{ [key: string]: string }>({})
  const [copiedActions, setCopiedActions] = useState<{ [key: string]: CopyAction | null }>({})
  const copiedResetTimers = useRef<{ [key: string]: number }>({})

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setDownloadState('idle')
      setNyaaResults([])
      setSavePath(defaultSavePath ?? '')
      setShowSavePath({})
      setDownloadingTorrent(null)
      setMagnetLoading({})
      setResolvedMagnets({})
      setTorrentsWithSavePaths({})
      setCopiedActions({})
    }
    onOpenChange(next)
  }

  const handlePickResult = async (result: NyaaResult) => {
    setDownloadingTorrent(result.torrent_url)
    setDownloadState('sending')
    try {
      await r18Api.sendToQbittorrent(result.torrent_url, videoCode, contentId, {
        category: 'Scene Whisper',
        tags: actressName ? [actressName] : undefined,
        savePath: savePath.trim() || undefined,
      })
      toast.success(`Added to qBittorrent: ${result.title}`)
      handleOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send to qBittorrent')
      setDownloadState('results')
    }
  }

  const clearCopiedAction = (torrentUrl: string) => {
    const timer = copiedResetTimers.current[torrentUrl]
    if (timer) {
      window.clearTimeout(timer)
      delete copiedResetTimers.current[torrentUrl]
    }
  }

  const markCopiedAction = (torrentUrl: string, action: CopyAction) => {
    clearCopiedAction(torrentUrl)
    setCopiedActions(prev => ({ ...prev, [torrentUrl]: action }))
    copiedResetTimers.current[torrentUrl] = window.setTimeout(() => {
      setCopiedActions(prev => (prev[torrentUrl] === action ? { ...prev, [torrentUrl]: null } : prev))
      delete copiedResetTimers.current[torrentUrl]
    }, 2000)
  }

  const copyValue = async (value: string, label: string) => {
    try {
      await copyTextToClipboard(value)
      console.log(`Copied value: ${value}`)
      toast.success(`Copied ${label}`)
      return true
    } catch {
      toast.error(`Failed to copy ${label}`)
      return false
    }
  }

  const handleCopy = async (event: MouseEvent, value: string, label: string, torrentUrl: string, action: CopyAction) => {
    event.stopPropagation()
    const copied = await copyValue(value, label)
    if (copied) {
      markCopiedAction(torrentUrl, action)
    }
  }

  const handleCopyMagnet = async (event: MouseEvent, result: NyaaResult) => {
    event.stopPropagation()
    setMagnetLoading(prev => ({ ...prev, [result.torrent_url]: true }))
    try {
      const resolvedMagnetUrl =
        resolvedMagnets[result.torrent_url]?.trim() ||
        result.magnet_url?.trim() ||
        (await r18Api.getNyaaMagnet(result.torrent_url, result.title)).magnet_url?.trim()
      if (!resolvedMagnetUrl) {
        throw new Error('Missing magnet URL')
      }
      setResolvedMagnets(prev => ({ ...prev, [result.torrent_url]: resolvedMagnetUrl }))
      const copied = await copyValue(resolvedMagnetUrl, 'magnet link')
      if (copied) {
        markCopiedAction(result.torrent_url, 'magnet')
      }
    } catch {
      toast.error(`Failed to copy magnet link for ${result.title}`)
    } finally {
      setMagnetLoading(prev => {
        const next = { ...prev }
        delete next[result.torrent_url]
        return next
      })
    }
  }

  const handleDownloadClick = (torrentUrl: string) => {
    setShowSavePath(prev => ({ ...prev, [torrentUrl]: true }))
  }

  const handleCancelDownload = (torrentUrl: string) => {
    setShowSavePath(prev => {
      const newShowSavePath = { ...prev }
      delete newShowSavePath[torrentUrl]
      return newShowSavePath
    })
    setDownloadingTorrent(null)
  }

  const handleSavePathChange = (torrentUrl: string, value: string) => {
    setSavePath(value)
    setTorrentsWithSavePaths(prev => ({ ...prev, [torrentUrl]: value }))
  }

  useEffect(() => {
    if (!open) return
    setSavePath(defaultSavePath ?? '')
    setShowSavePath({})
    setDownloadingTorrent(null)
    setMagnetLoading({})
    setResolvedMagnets({})
    setTorrentsWithSavePaths({})
    let cancelled = false
    setDownloadState('loading')
    r18Api.getNyaaResults(videoCode, contentId)
      .then((results) => { if (!cancelled) { setNyaaResults(results); setDownloadState('results') } })
      .catch(() => { if (!cancelled) { setNyaaResults([]); setDownloadState('results') } })
    return () => { cancelled = true }
  }, [contentId, defaultSavePath, open, videoCode])

  useEffect(() => {
    if (!open || window.isSecureContext || nyaaResults.length === 0) return

    let cancelled = false

    nyaaResults.forEach((result) => {
      if (result.magnet_url?.trim() || resolvedMagnets[result.torrent_url]) return

      void r18Api.getNyaaMagnet(result.torrent_url, result.title)
        .then(({ magnet_url }) => {
          if (cancelled) return
          const resolved = magnet_url?.trim()
          if (!resolved) return
          setResolvedMagnets(prev => {
            if (prev[result.torrent_url] === resolved) return prev
            return { ...prev, [result.torrent_url]: resolved }
          })
        })
        .catch(() => {
          // Keep the copy button behavior unchanged if background resolution fails.
        })
    })

    return () => {
      cancelled = true
    }
  }, [nyaaResults, open, resolvedMagnets])

  useEffect(() => {
    return () => {
      Object.values(copiedResetTimers.current).forEach((timer) => window.clearTimeout(timer))
      copiedResetTimers.current = {}
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[95vh] lg:max-w-3xl scrollbar">
        <DialogHeader>
          <DialogTitle>Download Torrents for {videoCode.toUpperCase()}</DialogTitle>
        </DialogHeader>

        {downloadState === 'loading' && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Searching nyaa…</span>
          </div>
        )}

        {(downloadState === 'results' || downloadState === 'sending') && (
          <>
            {nyaaResults.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No results found on sukebei.nyaa.si</p>
            ) : (
              <ul className="space-y-1 overflow-y-auto">
                {nyaaResults.map((result) => (
                  <li
                    key={result.torrent_url}
                    className={`flex items-stretch gap-1 rounded `}
                  >
                    <div className={`min-w-0 flex-1 px-3 py-2 text-sm ${showSavePath[result.torrent_url] ? 'bg-accent/15' : ''
                      }`}>
                      <div className="flex items-start justify-between gap-3">
                        <p className={`font-medium line-clamp-1 ${result.was_tried ? 'text-muted-foreground' : ''}`}>{result.title}</p>
                        {result.was_tried && (
                          <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide text-amber-600 border-amber-500/50">
                            Tried
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-foreground/60 mt-0.5">
                        {result.size} · {result.seeders} seeders
                      </p>
                    </div>
                    <div className="flex items-center gap-1 pr-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        disabled={downloadState === 'sending'}
                        aria-label={`Download ${result.title}`}
                        title="Download"
                        onClick={() => handleDownloadClick(result.torrent_url)}
                      >
                        <Download size={18} />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        disabled={downloadState === 'sending'}
                        aria-label={`Copy torrent link for ${result.title}`}
                        title="Copy Torrent Link"
                        onClick={(event) => void handleCopy(event, result.torrent_url, 'torrent link', result.torrent_url, 'torrent')}
                      >
                        {copiedActions[result.torrent_url] === 'torrent' ? <Check size={18} /> : <Link size={18} />}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        disabled={downloadState === 'sending' || Boolean(magnetLoading[result.torrent_url])}
                        aria-label={`Copy magnet link for ${result.title}`}
                        title="Copy Magnet Link"
                        onClick={(event) => void handleCopyMagnet(event, result)}
                      >
                        {magnetLoading[result.torrent_url] ? <Loader2 size={18} className="animate-spin" /> : copiedActions[result.torrent_url] === 'magnet' ? <Check size={18} /> : <Magnet size={18} />}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        disabled={downloadState === 'sending'}
                        aria-label={`Copy title for ${result.title}`}
                        title="Copy Title"
                        onClick={(event) => void handleCopy(event, result.title, 'title', result.torrent_url, 'title')}
                      >
                        {copiedActions[result.torrent_url] === 'title' ? <Check size={18} /> : <Copy size={18} />}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {downloadState === 'sending' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending to qBittorrent…
              </div>
            )}

            {nyaaResults.map((result) => (
              showSavePath[result.torrent_url] && (
                <div key={`save-path-${result.torrent_url}`} className="mt-4 space-y-2">
                  <Label htmlFor={`actress-torrent-save-path-${result.torrent_url}`}>Save path</Label>
                  <Input
                    id={`actress-torrent-save-path-${result.torrent_url}`}
                    value={savePath}
                    onChange={(e) => handleSavePathChange(result.torrent_url, e.target.value)}
                    placeholder="Use qBittorrent default"
                    disabled={downloadState === 'sending'}
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleCancelDownload(result.torrent_url)}
                      disabled={downloadState === 'sending'}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => handlePickResult(result)}
                      disabled={downloadState === 'sending' || downloadingTorrent === result.torrent_url || !savePath.trim()}
                    >
                      Download
                    </Button>
                  </div>
                </div>
              )
            ))}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
