import { useRef, useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogWarning,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Loader2, Trash2, ScanSearch, FolderSearch, Database, ChevronUp, ChevronDown, Plus, RotateCcw } from 'lucide-react'
import { AppSettings, TaskStatus, DirectoryRecord } from '@/types/types'
import { SelectiveScanDialog } from '@/components/SelectiveScanDialog'
import { SelectiveCleanupDialog } from '@/components/SelectiveCleanupDialog'
import { SelectiveSrtCleanupDialog } from '@/components/SelectiveSrtCleanupDialog'
import { PROCESSING_SETTINGS_DEFAULTS, useSettings } from '@/hooks/useSettings'
import { fileApi } from '@/api/files'
import { settingsApi } from '@/api/settings'
import { taskApi } from '@/api/tasks'
import { scraperApi } from '@/api/scraper'
import { getTopLevelDirectories, TopLevelDirectory } from '@/api/directories'
import { apiUrl } from '@/api/client'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn, formatUtcTimestampToLocal } from '@/lib/utils'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function SettingRow({ label, description, className, children }: { label: string; description?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-2.5 border-b border-border last:border-0 sm:gap-4 sm:py-3", className)}>
      <div className="min-w-0">
        <Label className="text-xs font-medium sm:text-sm">{label}</Label>
        {description && <p className="text-[11px] text-muted-foreground sm:text-xs">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">{children}</div>
    </div>
  )
}

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'it', label: 'Italian' },
  { value: 'ru', label: 'Russian' },
]

const DEFAULT_EXTERNAL_VIDEO_TARGET = {
  label: 'Google',
  url_template: 'https://www.google.com/search?q={videoCode}',
}

const DEFAULT_SCRAPER_TEMPLATE = {
  label: 'JavPlayer',
  url_template: 'https://javplayer.org/model/{actress_name}',
}

type ProcessingDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type ProcessingWindows = AppSettings['processing_hours_windows']

const PROCESSING_DAYS: Array<{ key: ProcessingDayKey; settingKey: keyof Pick<AppSettings, 'processing_mon' | 'processing_tue' | 'processing_wed' | 'processing_thu' | 'processing_fri' | 'processing_sat' | 'processing_sun'>; label: string }> = [
  { key: 'mon', settingKey: 'processing_mon', label: 'Mon' },
  { key: 'tue', settingKey: 'processing_tue', label: 'Tue' },
  { key: 'wed', settingKey: 'processing_wed', label: 'Wed' },
  { key: 'thu', settingKey: 'processing_thu', label: 'Thu' },
  { key: 'fri', settingKey: 'processing_fri', label: 'Fri' },
  { key: 'sat', settingKey: 'processing_sat', label: 'Sat' },
  { key: 'sun', settingKey: 'processing_sun', label: 'Sun' },
]

const compactButtonClass = "h-8 gap-1.5 px-2 text-xs sm:h-9 sm:gap-2 sm:px-3 sm:text-sm"
const compactIconButtonClass = "h-7 w-7 sm:h-9 sm:w-9"
const compactSelectClass = "h-8 text-xs sm:h-9 sm:text-sm"
const compactInputClass = "h-8 text-xs sm:h-9 sm:text-sm"
const compactHelpTextClass = "text-[11px] text-muted-foreground sm:text-xs"

function urlsForScraperSource(source: { url: string; urls?: string[] }): string[] {
  const values = source.urls?.length ? source.urls : [source.url]
  return [...new Set(values.map((url) => url.trim()).filter(Boolean))]
}

function scraperTemplateMatchesUrl(templateUrl: string, url: string): boolean {
  const [prefix, suffix = ''] = templateUrl.split('{actress_name}')
  return Boolean(prefix) && url.startsWith(prefix) && (!suffix || url.endsWith(suffix))
}

function formatEta(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function ScanAnimation({ isScanning, percentage }: { isScanning: boolean; percentage: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const angleRef = useRef(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const size = canvas.width
    const cx = size / 2
    const cy = size / 2
    const radius = size * 0.38

    const blips: { x: number; y: number; age: number }[] = []
    const maxBlips = Math.floor((percentage / 100) * 14)
    const rng = (seed: number) => {
      const s = seed * 9301 + 49297
      return (s % 233280) / 233280
    }
    for (let i = 0; i < maxBlips; i++) {
      const r = rng(i * 3 + 1) * radius * 0.85
      const a = rng(i * 3 + 2) * Math.PI * 2
      blips.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), age: rng(i * 3 + 3) })
    }

    const draw = () => {
      ctx.clearRect(0, 0, size, size)
        ;[0.25, 0.5, 0.75, 1].forEach(f => {
          ctx.beginPath()
          ctx.arc(cx, cy, radius * f, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(99,102,241,0.15)'
          ctx.lineWidth = 1
          ctx.stroke()
        })
      ctx.strokeStyle = 'rgba(99,102,241,0.12)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke()

      if (isScanning) {
        const trailLen = Math.PI * 0.75
        for (let i = 0; i < 40; i++) {
          const alpha = (i / 40) * 0.35
          const startA = angleRef.current - trailLen * (1 - i / 40)
          const endA = angleRef.current - trailLen * (1 - (i + 1) / 40)
          ctx.beginPath(); ctx.moveTo(cx, cy)
          ctx.arc(cx, cy, radius, startA, endA)
          ctx.closePath()
          ctx.fillStyle = `rgba(99,102,241,${alpha})`
          ctx.fill()
        }
        ctx.beginPath(); ctx.moveTo(cx, cy)
        ctx.lineTo(cx + radius * Math.cos(angleRef.current), cy + radius * Math.sin(angleRef.current))
        ctx.strokeStyle = 'rgba(165,180,252,0.9)'
        ctx.lineWidth = 1.5
        ctx.stroke()
        angleRef.current += 0.025
      } else {
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(99,102,241,0.5)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      blips.forEach((b, i) => {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400 + i * 1.7)
        ctx.beginPath()
        ctx.arc(b.x, b.y, 2.5 + pulse, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(165,180,252,${0.5 + pulse * 0.5})`
        ctx.fill()
        ctx.beginPath()
        ctx.arc(b.x, b.y, 5 + pulse * 2, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(99,102,241,${0.12 * pulse})`
        ctx.fill()
      })

      ctx.beginPath()
      ctx.arc(cx, cy, 3, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(165,180,252,0.9)'
      ctx.fill()

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isScanning, percentage])

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={160}
      className="mx-auto"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}

function ActionProgressPanel({
  animationActive,
  currentFile,
  deleted,
  label,
  percentage,
  processed,
  total,
  eta,
}: {
  animationActive: boolean
  currentFile: string
  deleted?: number
  label: string
  percentage: number
  processed: number
  total: number
  eta?: string
}) {
  return (
    <div className="sticky top-0 z-20 space-y-3 p-4 rounded-lg bg-background border border-primary/20 shadow-sm">
      <ScanAnimation isScanning={animationActive} percentage={percentage} />
      <span className="block text-center text-xs uppercase tracking-widest text-primary/70 font-semibold">
        {label}
      </span>

      <div>
        <div className="flex justify-between text-xs font-semibold uppercase mb-1">
          <span className="text-primary">Progress</span>
          <span className="text-muted-foreground">{percentage}%</span>
        </div>
        <div className="overflow-hidden h-2 rounded-full bg-primary-foreground border border-border">
          <div
            style={{ width: `${percentage}%` }}
            className="h-full bg-primary transition-all duration-500 ease-out"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">{deleted === undefined ? 'Processed' : 'Checked'}</p>
          <p className="text-sm font-mono">{processed}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Total</p>
          <p className="text-sm font-mono">{total}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">{deleted === undefined ? 'ETA' : 'Deleted'}</p>
          <p className="text-sm font-mono">{deleted === undefined ? eta : deleted}</p>
        </div>
      </div>

      <p className="text-xs truncate text-muted-foreground bg-muted/50 p-2 rounded border border-border">
        {currentFile}
      </p>
    </div>
  )
}

const clampHour = (hour: number): number => Math.max(0, Math.min(23, Math.round(hour)))
const buildProcessingWindows = (settings: AppSettings): ProcessingWindows => {
  const windows = settings.processing_hours_windows
  return PROCESSING_DAYS.reduce((acc, { key }) => {
    acc[key] = {
      start: windows?.[key]?.start ?? settings.processing_hours_start,
      end: windows?.[key]?.end ?? settings.processing_hours_end,
    }
    return acc
  }, {} as ProcessingWindows)
}
const processingWindowsToLocal = (settings: AppSettings): ProcessingWindows => {
  const windows = buildProcessingWindows(settings)
  return PROCESSING_DAYS.reduce((acc, { key }) => {
    acc[key] = {
      start: clampHour(windows[key].start),
      end: clampHour(windows[key].end),
    }
    return acc
  }, {} as ProcessingWindows)
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { settings, patchSettings } = useSettings()
  const queryClient = useQueryClient()
  const [isScanning, setIsScanning] = useState(false)
  const [isSelectiveScan, setIsSelectiveScan] = useState(false)
  const [isCleaningStream, setIsCleaningStream] = useState(false)
  const [cleanupProgress, setCleanupProgress] = useState({ percentage: 0, current_file: '', processed: 0, total: 0, deleted: 0 })
  const cleanupEventSourceRef = useRef<EventSource | null>(null)
  const [cleanupDirectoryPath, setCleanupDirectoryPath] = useState<string>('all')
  const [cleanupDirectories, setCleanupDirectories] = useState<DirectoryRecord[]>([])
  const [isClearingStatus, setIsClearingStatus] = useState<Record<TaskStatus, boolean>>({
    queued: false,
    processing: false,
    completed: false,
    failed: false,
    cancelled: false,
    paused: false,
  })
  const [progress, setProgress] = useState({ percentage: 0, current_file: '', processed: 0, total: 0, eta_seconds: null as number | null })
  const [scanError, setScanError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const [selectiveScanOpen, setSelectiveScanOpen] = useState(false)
  const [selectiveCleanupOpen, setSelectiveCleanupOpen] = useState(false)
  const [selectiveSrtCleanupOpen, setSelectiveSrtCleanupOpen] = useState(false)
  const [topLevelDirs, setTopLevelDirs] = useState<TopLevelDirectory[]>([])
  const [topLevelError, setTopLevelError] = useState<string | null>(null)
  const [selectedDirs, setSelectedDirs] = useState<string[]>([])
  const [isDeletingSrts, setIsDeletingSrts] = useState(false)
  const [isClearingTorrentDatabase, setIsClearingTorrentDatabase] = useState(false)
  const [isClearTorrentDialogOpen, setIsClearTorrentDialogOpen] = useState(false)
  const [srtCleanupProgress, setSrtCleanupProgress] = useState({ percentage: 0, current_file: '', processed: 0, total: 0, deleted: 0 })
  const srtCleanupEventSourceRef = useRef<EventSource | null>(null)
  const [externalVideoTargetsDraft, setExternalVideoTargetsDraft] = useState(() => settings.external_video_targets)
  const [scraperTemplatesDraft, setScraperTemplatesDraft] = useState(() => settings.scraper_templates)

  // Local state for editing processing hours (in user's timezone)
  const [localProcessingWindows, setLocalProcessingWindows] = useState(() => processingWindowsToLocal(settings))

  // Update local hours when settings change
  useEffect(() => {
    setLocalProcessingWindows(processingWindowsToLocal(settings))
  }, [settings.processing_hours_start, settings.processing_hours_end, settings.processing_hours_windows])

  useEffect(() => {
    setExternalVideoTargetsDraft(settings.external_video_targets)
  }, [settings.external_video_targets])

  useEffect(() => {
    setScraperTemplatesDraft(settings.scraper_templates)
  }, [settings.scraper_templates])

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
      cleanupEventSourceRef.current?.close()
      srtCleanupEventSourceRef.current?.close()
    }
  }, [])

  const updateProcessingWindow = (day: ProcessingDayKey, field: 'start' | 'end', localHourValue: number) => {
    const localHour = clampHour(localHourValue)
    const nextLocalWindows = {
      ...localProcessingWindows,
      [day]: {
        ...localProcessingWindows[day],
        [field]: localHour,
      },
    }
    const currentWindows = buildProcessingWindows(settings)
    const nextWindows = {
      ...currentWindows,
      [day]: {
        ...currentWindows[day],
        [field]: localHour,
      },
    }
    setLocalProcessingWindows(nextLocalWindows)
    patchSettings({ processing_hours_windows: nextWindows })
  }

  useEffect(() => {
    if (!open) return
    fileApi.getDirectories().then(setCleanupDirectories).catch(() => { })
  }, [open])

  const startScan = () => {
    setIsScanning(true)
    setScanError(null)
    setProgress({ percentage: 0, current_file: 'Initializing...', processed: 0, total: 0, eta_seconds: null })

    const es = new EventSource(apiUrl('/directory/scan_all/stream'))
    eventSourceRef.current = es

    es.addEventListener('progress', (event) => {
      setProgress(JSON.parse(event.data))
    })

    es.addEventListener('done', async (event) => {
      setProgress(JSON.parse(event.data))
      setIsScanning(false)
      es.close()
      queryClient.invalidateQueries({ queryKey: ['files'] })
      if (settings.auto_cleanup_on_scan) {
        try {
          await fileApi.cleanupMissingFiles()
          queryClient.invalidateQueries({ queryKey: ['files'] })
        } catch {
          // non-fatal
        }
      }
    })

    es.addEventListener('scan_error', (event) => {
      setScanError(event.data || 'Scan failed.')
      setIsScanning(false)
      es.close()
    })

    es.onerror = () => {
      setScanError('Connection lost. Server may have timed out or restarted.')
      setIsScanning(false)
      es.close()
    }
  }

  const stopScan = () => {
    eventSourceRef.current?.close()
    setIsScanning(false)
    setIsSelectiveScan(false)
  }

  const stopCleanup = () => {
    cleanupEventSourceRef.current?.close()
    setIsCleaningStream(false)
  }

  const stopSrtCleanup = () => {
    srtCleanupEventSourceRef.current?.close()
    setIsDeletingSrts(false)
  }

  const openSelectiveScan = async () => {
    setTopLevelError(null)
    setSelectedDirs(settings?.selected_scan_directories ?? [])
    try {
      const dirs = await getTopLevelDirectories()
      setTopLevelDirs(dirs)
    } catch {
      setTopLevelError('Failed to load directories.')
      setTopLevelDirs([])
    }
    setSelectiveScanOpen(true)
  }

  const openSelectiveCleanup = async () => {
    setTopLevelError(null)
    setSelectedDirs(settings?.selected_scan_directories ?? [])
    try {
      const dirs = await getTopLevelDirectories()
      setTopLevelDirs(dirs)
    } catch {
      setTopLevelError('Failed to load directories.')
      setTopLevelDirs([])
    }
    setSelectiveCleanupOpen(true)
  }

  const openSelectiveSrtCleanup = async () => {
    setTopLevelError(null)
    setSelectedDirs(settings?.selected_scan_directories ?? [])
    try {
      const dirs = await getTopLevelDirectories()
      setTopLevelDirs(dirs)
    } catch {
      setTopLevelError('Failed to load directories.')
      setTopLevelDirs([])
    }
    setSelectiveSrtCleanupOpen(true)
  }

  const saveSelectiveScanSelection = async () => {
    await patchSettings({ selected_scan_directories: selectedDirs })
  }

  const saveSelectiveCleanupSelection = async () => {
    await patchSettings({ selected_scan_directories: selectedDirs })
  }

  const saveSrtCleanupSelection = async () => {
    await patchSettings({ selected_scan_directories: selectedDirs })
  }

  const startSelectiveScan = async () => {
    setSelectiveScanOpen(false)
    const query = selectedDirs.length > 0 ? `?directories=${selectedDirs.map(encodeURIComponent).join(",")}` : ""
    const es = new EventSource(
      apiUrl("/directory/scan_all/stream" + query)
    )
    setIsScanning(true)
    setIsSelectiveScan(true)
    setScanError(null)
    setProgress({ percentage: 0, current_file: 'Initializing...', processed: 0, total: 0, eta_seconds: null })
    eventSourceRef.current = es

    es.addEventListener('progress', (event) => {
      setProgress(JSON.parse(event.data))
    })

    es.addEventListener('done', async (event) => {
      setProgress(JSON.parse(event.data))
      setIsScanning(false)
      setIsSelectiveScan(false)
      es.close()
      queryClient.invalidateQueries({ queryKey: ['files'] })
      if (settings.auto_cleanup_on_scan) {
        try {
          await fileApi.cleanupMissingFiles()
          queryClient.invalidateQueries({ queryKey: ['files'] })
        } catch {
          // non-fatal
        }
      }
    })

    es.addEventListener('scan_error', (event) => {
      setScanError(event.data || 'Scan failed.')
      setIsScanning(false)
      setIsSelectiveScan(false)
      es.close()
    })

    es.onerror = () => {
      setScanError('Connection lost. Server may have timed out or restarted.')
      setIsScanning(false)
      setIsSelectiveScan(false)
      es.close()
    }
  }

  const runCleanup = () => {
    setIsCleaningStream(true)
    setCleanupProgress({ percentage: 0, current_file: 'Initializing...', processed: 0, total: 0, deleted: 0 })

    const streamUrl = cleanupDirectoryPath && cleanupDirectoryPath !== "all"
      ? apiUrl(`/directory/cleanup/stream?directory_path=${encodeURIComponent(cleanupDirectoryPath)}`)
      : apiUrl('/directory/cleanup/stream')
    const es = new EventSource(streamUrl)
    cleanupEventSourceRef.current = es

    es.addEventListener('progress', (event) => {
      setCleanupProgress(JSON.parse(event.data))
    })

    es.addEventListener('done', (event) => {
      const data = JSON.parse(event.data)
      setCleanupProgress(data)
      setIsCleaningStream(false)
      es.close()
      queryClient.invalidateQueries({ queryKey: ['files'] })
      toast.success(`Cleaned up ${data.deleted} missing entr${data.deleted === 1 ? 'y' : 'ies'}`)
    })

    es.onerror = () => {
      toast.error('Cleanup failed')
      setIsCleaningStream(false)
      es.close()
    }
  }

  const startSelectiveCleanup = async () => {
    setSelectiveCleanupOpen(false)
    const query = selectedDirs.length > 0 ? `?directories=${selectedDirs.map(encodeURIComponent).join(",")}` : ""
    const es = new EventSource(
      apiUrl("/directory/cleanup/stream" + query)
    )
    setIsCleaningStream(true)
    setCleanupProgress({ percentage: 0, current_file: 'Initializing...', processed: 0, total: 0, deleted: 0 })

    es.addEventListener('progress', (event) => {
      setCleanupProgress(JSON.parse(event.data))
    })

    es.addEventListener('done', (event) => {
      const data = JSON.parse(event.data)
      setCleanupProgress(data)
      setIsCleaningStream(false)
      es.close()
      queryClient.invalidateQueries({ queryKey: ['files'] })
      toast.success(`Cleaned up ${data.deleted} missing entr${data.deleted === 1 ? 'y' : 'ies'}`)
    })

    es.onerror = () => {
      toast.error('Cleanup failed')
      setIsCleaningStream(false)
      es.close()
    }
  }

  const startSelectiveSrtCleanup = async () => {
    setSelectiveSrtCleanupOpen(false)
    const query = selectedDirs.length > 0 ? `?directories=${selectedDirs.map(encodeURIComponent).join(",")}` : ""
    const es = new EventSource(
      apiUrl("/directory/cleanup-subtitles/stream" + query)
    )
    setIsDeletingSrts(true)
    setSrtCleanupProgress({ percentage: 0, current_file: 'Initializing...', processed: 0, total: 0, deleted: 0 })
    srtCleanupEventSourceRef.current = es

    es.addEventListener('progress', (event) => {
      setSrtCleanupProgress(JSON.parse(event.data))
    })

    es.addEventListener('done', (event) => {
      const data = JSON.parse(event.data)
      setSrtCleanupProgress(data)
      setIsDeletingSrts(false)
      es.close()
      queryClient.invalidateQueries({ queryKey: ['files'] })
      toast.success(`Deleted ${data.deleted} unused SRT file${data.deleted !== 1 ? 's' : ''}`)
    })

    es.onerror = () => {
      toast.error('SRT cleanup failed')
      setIsDeletingSrts(false)
      es.close()
    }
  }

  const runSrtCleanup = () => {
    setIsDeletingSrts(true)
    setSrtCleanupProgress({ percentage: 0, current_file: 'Initializing...', processed: 0, total: 0, deleted: 0 })

    const es = new EventSource(apiUrl('/directory/cleanup-subtitles/stream'))
    srtCleanupEventSourceRef.current = es

    es.addEventListener('progress', (event) => {
      setSrtCleanupProgress(JSON.parse(event.data))
    })

    es.addEventListener('done', (event) => {
      const data = JSON.parse(event.data)
      setSrtCleanupProgress(data)
      setIsDeletingSrts(false)
      es.close()
      queryClient.invalidateQueries({ queryKey: ['files'] })
      toast.success(`Deleted ${data.deleted} unused SRT file${data.deleted !== 1 ? 's' : ''}`)
    })

    es.onerror = () => {
      toast.error('SRT cleanup failed')
      setIsDeletingSrts(false)
      es.close()
    }
  }

  const handleClearStatus = async (status: TaskStatus) => {
    setIsClearingStatus(prev => ({ ...prev, [status]: true }))
    try {
      const { deleted } = await taskApi.clearTasksByStatus(status)
      toast.success(`Deleted ${deleted} ${status} task${deleted !== 1 ? 's' : ''}.`)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear tasks')
    } finally {
      setIsClearingStatus(prev => ({ ...prev, [status]: false }))
    }
  }

  const handleClearTorrentDatabase = async () => {
    setIsClearingTorrentDatabase(true)
    try {
      const result = await settingsApi.clearTorrentDatabase()
      setIsClearTorrentDialogOpen(false)
      toast.success(result.message)
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['files'] })
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['r18'] })
      queryClient.invalidateQueries({ queryKey: ['directory-monitors'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear torrent database')
    } finally {
      setIsClearingTorrentDatabase(false)
    }
  }

  const updateExternalVideoTargetDraft = (index: number, field: 'label' | 'url_template', value: string) => {
    setExternalVideoTargetsDraft((current) => {
      const next = [...current]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const commitExternalVideoTargets = () => {
    if (JSON.stringify(externalVideoTargetsDraft) === JSON.stringify(settings.external_video_targets)) {
      return
    }

    patchSettings({ external_video_targets: externalVideoTargetsDraft })
  }

  const removeExternalVideoTarget = (index: number) => {
    const next = externalVideoTargetsDraft.filter((_, currentIndex) => currentIndex !== index)
    setExternalVideoTargetsDraft(next)
    patchSettings({ external_video_targets: next })
  }

  const moveExternalVideoTarget = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= externalVideoTargetsDraft.length) {
      return
    }

    const next = [...externalVideoTargetsDraft]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
    setExternalVideoTargetsDraft(next)
    patchSettings({ external_video_targets: next })
  }

  const addExternalVideoTarget = () => {
    const next = [
      ...externalVideoTargetsDraft,
      { ...DEFAULT_EXTERNAL_VIDEO_TARGET },
    ]
    setExternalVideoTargetsDraft(next)
    patchSettings({ external_video_targets: next })
  }

  const updateScraperTemplateDraft = (index: number, field: 'label' | 'url_template', value: string) => {
    setScraperTemplatesDraft((current) => {
      const next = [...current]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const commitScraperTemplates = () => {
    if (JSON.stringify(scraperTemplatesDraft) === JSON.stringify(settings.scraper_templates)) {
      return
    }

    patchSettings({ scraper_templates: scraperTemplatesDraft })
  }

  const removeScraperTemplate = async (index: number) => {
    const removedTemplate = scraperTemplatesDraft[index]
    const next = scraperTemplatesDraft.filter((_, currentIndex) => currentIndex !== index)
    setScraperTemplatesDraft(next)
    await patchSettings({ scraper_templates: next })

    if (!removedTemplate?.url_template.includes('{actress_name}')) {
      return
    }

    try {
      const sources = await scraperApi.getSources()
      let updatedCount = 0
      let deletedCount = 0

      await Promise.all(sources.map(async (source) => {
        const originalUrls = urlsForScraperSource(source)
        const keptUrlIndexes = originalUrls
          .map((url, currentIndex) => ({ url, currentIndex }))
          .filter(({ url }) => !scraperTemplateMatchesUrl(removedTemplate.url_template, url))

        if (keptUrlIndexes.length === originalUrls.length) {
          return
        }

        if (keptUrlIndexes.length === 0) {
          await scraperApi.deleteSource(source.id)
          deletedCount += 1
          return
        }

        const nextUrls = keptUrlIndexes.map(({ url }) => url)
        const nextUrlActressNameReversed = keptUrlIndexes.map(({ currentIndex }) => (
          source.urlActressNameReversed?.[currentIndex] ?? false
        ))

        await scraperApi.updateSource({
          ...source,
          url: nextUrls[0],
          urls: nextUrls,
          urlActressNameReversed: nextUrlActressNameReversed,
        })
        updatedCount += 1
      }))

      if (updatedCount || deletedCount) {
        queryClient.invalidateQueries({ queryKey: ['scraper'] })
        toast.success('Removed scraper website from saved scraper cards')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update scraper cards')
      queryClient.invalidateQueries({ queryKey: ['scraper'] })
    }
  }

  const moveScraperTemplate = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= scraperTemplatesDraft.length) {
      return
    }

    const next = [...scraperTemplatesDraft]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
    setScraperTemplatesDraft(next)
    patchSettings({ scraper_templates: next })
  }

  const addScraperTemplate = () => {
    const next = [
      ...scraperTemplatesDraft,
      { ...DEFAULT_SCRAPER_TEMPLATE },
    ]
    setScraperTemplatesDraft(next)
    patchSettings({ scraper_templates: next })
  }

  const isBusy = isScanning || isCleaningStream || isDeletingSrts
  const actionProgressPanel = isScanning ? (
    <ActionProgressPanel
      animationActive={isScanning}
      currentFile={progress.current_file || 'Reading directory...'}
      eta={formatEta(progress.eta_seconds)}
      label="Scanning"
      percentage={progress.percentage}
      processed={progress.processed}
      total={progress.total}
    />
  ) : isCleaningStream ? (
    <ActionProgressPanel
      animationActive={isCleaningStream}
      currentFile={cleanupProgress.current_file || 'Checking records...'}
      deleted={cleanupProgress.deleted}
      label="Cleaning"
      percentage={cleanupProgress.percentage}
      processed={cleanupProgress.processed}
      total={cleanupProgress.total}
    />
  ) : isDeletingSrts ? (
    <ActionProgressPanel
      animationActive={isDeletingSrts}
      currentFile={srtCleanupProgress.current_file || 'Checking subtitles...'}
      deleted={srtCleanupProgress.deleted}
      label="Deleting"
      percentage={srtCleanupProgress.percentage}
      processed={srtCleanupProgress.processed}
      total={srtCleanupProgress.total}
    />
  ) : null

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next && isBusy) return; onOpenChange(next) }}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none sm:h-auto sm:max-h-[95vh] sm:w-full sm:max-w-xl sm:rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">Settings</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="actions" className="w-full flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Fixed tab bar at top */}
            <div className="sticky top-0 z-10 shrink-0 bg-background pb-2">
              <TabsList className="w-full">
                <TabsTrigger value="actions" className="flex-1 px-2 text-xs sm:px-3 sm:text-sm">Actions</TabsTrigger>
                <TabsTrigger value="behavior" className="flex-1 px-2 text-xs sm:px-3 sm:text-sm">App Behavior</TabsTrigger>
                <TabsTrigger value="processing" className="flex-1 px-2 text-xs sm:px-3 sm:text-sm">Processing</TabsTrigger>
              </TabsList>
            </div>

            {/* Scrollable content area */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar pr-2 sm:pr-4">
              <TabsContent value="actions" className="mt-0">
                {actionProgressPanel && (
                  <div className="pb-3">
                    {actionProgressPanel}
                  </div>
                )}

                {/* Scan */}
                <div className="border-b border-border pb-1 mb-1">
                  <div className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-3">
                    <div className="min-w-0">
                      <Label className="text-xs font-medium sm:text-sm">Scan</Label>
                      <p className="text-[11px] text-muted-foreground sm:text-xs">Re-index video files in watched directories or chosen directories</p>
                    </div>
                    <div className="flex items-center gap-1.5 sm:flex-wrap sm:justify-end sm:gap-2">
                      {isScanning ? (
                        <Button variant="destructive" size="sm" onClick={stopScan} className={cn(compactButtonClass, "flex-1 sm:flex-none")}>
                          <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" />
                          Stop
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={startScan} disabled={isBusy} className={cn(compactButtonClass, "flex-1 sm:flex-none")}>
                          <ScanSearch className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          Scan All
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={openSelectiveScan} disabled={isBusy} className={cn(compactButtonClass, "flex-1 sm:flex-none")}>
                        <FolderSearch className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        Selective
                      </Button>
                    </div>
                  </div>
                  <SettingRow label="Auto-cleanup on scan" className="border-0 pt-0">
                    <Switch
                      checked={settings.auto_cleanup_on_scan}
                      onCheckedChange={(v) => patchSettings({ auto_cleanup_on_scan: v })}
                    />
                  </SettingRow>
                  <div className="mt-3 rounded-md border border-border p-3 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <p className="text-xs font-medium sm:text-sm">Scheduled scan</p>
                        <p className="text-[11px] text-muted-foreground sm:text-xs">
                          Automatically run the scan every day at the selected local time.
                        </p>
                      </div>
                      <Switch
                        checked={settings.scan_schedule_enabled}
                        onCheckedChange={(checked) => {
                          if (!checked) {
                            patchSettings({ scan_schedule_enabled: false })
                            return
                          }
                          patchSettings({
                            scan_schedule_enabled: true,
                            scan_schedule_time: settings.scan_schedule_time ?? '09:00',
                            scan_schedule_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                          })
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="scan-schedule-time" className="text-xs sm:text-sm">Run time</Label>
                      <Input
                        id="scan-schedule-time"
                        type="time"
                        className="h-8 text-xs sm:h-9 sm:text-sm"
                        value={settings.scan_schedule_time ?? '09:00'}
                        onChange={(e) => {
                          const nextTime = e.target.value
                          patchSettings({
                            scan_schedule_time: nextTime || null,
                            scan_schedule_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                          })
                        }}
                        disabled={!settings.scan_schedule_enabled}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="scan-schedule-mode" className="text-xs sm:text-sm">Scan scope</Label>
                      <Select
                        value={settings.scan_schedule_mode ?? 'all'}
                        onValueChange={(value) => patchSettings({ scan_schedule_mode: value === 'selected' ? 'selected' : 'all' })}
                        disabled={!settings.scan_schedule_enabled}
                      >
                        <SelectTrigger id="scan-schedule-mode" className="h-8 text-xs sm:h-9 sm:text-sm">
                          <SelectValue placeholder="Scan all" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Scan all</SelectItem>
                          <SelectItem value="selected">Selective scan</SelectItem>
                        </SelectContent>
                      </Select>
                      {settings.scan_schedule_mode === 'selected' && (
                        <p className="text-[11px] text-muted-foreground sm:text-xs">
                          Scheduled selective scans use the directories selected in the Scan section.
                        </p>
                      )}
                    </div>
                    <div className="space-y-1 text-[11px] text-muted-foreground sm:text-xs">
                      <p>Last run: {settings.scan_schedule_last_run ? formatUtcTimestampToLocal(settings.scan_schedule_last_run) : 'Not scheduled'}</p>
                      <p>Next run: {settings.scan_schedule_next_run ? formatUtcTimestampToLocal(settings.scan_schedule_next_run) : 'Not scheduled'}</p>
                    </div>
                    {settings.scan_schedule_last_error && (
                      <p className="text-xs text-destructive">{settings.scan_schedule_last_error}</p>
                    )}
                  </div>

                  {scanError && (
                    <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded p-2 mb-3">
                      {scanError}
                    </p>
                  )}
                </div>

                {/* Cleanup */}
                <div className="border-b border-border pb-1 mb-1">
                  <div className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-3">
                    <div className="min-w-0">
                      <Label className="text-xs font-medium sm:text-sm">Cleanup</Label>
                      <p className="text-[11px] text-muted-foreground sm:text-xs">Remove missing-file DB entries globally or in chosen directories</p>
                    </div>
                    <div className="flex items-center gap-1.5 sm:flex-wrap sm:justify-end sm:gap-2">
                      {isCleaningStream ? (
                        <Button variant="destructive" size="sm" onClick={stopCleanup} className={cn(compactButtonClass, "flex-1 sm:flex-none")}>
                          <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" />
                          Stop
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={runCleanup} disabled={isBusy} className={cn(compactButtonClass, "flex-1 sm:flex-none")}>
                          <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          Cleanup All
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={openSelectiveCleanup} disabled={isBusy} className={cn(compactButtonClass, "flex-1 sm:flex-none")}>
                        <FolderSearch className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        Selective
                      </Button>
                    </div>
                  </div>

                </div>

                {/* Delete Unused Subtitles */}
                <div className="border-b border-border pb-1 mb-1">
                  <div className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-3">
                    <div className="min-w-0">
                      <Label className="text-xs font-medium sm:text-sm">Delete Unused Subtitles</Label>
                      <p className="text-[11px] text-muted-foreground sm:text-xs">Remove orphan subtitle files globally or in chosen directories</p>
                    </div>
                    <div className="flex items-center gap-1.5 sm:flex-wrap sm:justify-end sm:gap-2">
                      {isDeletingSrts ? (
                        <Button variant="destructive" size="sm" onClick={stopSrtCleanup} className={cn(compactButtonClass, "flex-1 sm:flex-none")}>
                          <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" />
                          Stop
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={runSrtCleanup} disabled={isBusy} className={cn(compactButtonClass, "flex-1 sm:flex-none")}>
                          <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          Delete All
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={openSelectiveSrtCleanup} disabled={isBusy} className={cn(compactButtonClass, "flex-1 sm:flex-none")}>
                        <FolderSearch className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        Selective
                      </Button>
                    </div>
                  </div>

                </div>

                {/* Task Type Priority */}
                {(() => {
                  const DEFAULT_PRIORITY = ['all', 'merge', 'subtitle', 'split', 'scene', 'analyze_frame_pacing', 'nvenc_frame_pacing', 'remux']
                  const TASK_TYPE_LABELS: Record<string, string> = {
                    all: 'All',
                    merge: 'Merge',
                    subtitle: 'Subtitle',
                    split: 'Split',
                    scene: 'Scene',
                    analyze_frame_pacing: 'Analyze + Frame Pacing Repair',
                    nvenc_frame_pacing: 'Frame Pacing Repair',
                    remux: 'Remux',
                  }
                  const priority: string[] = [
                    ...(settings.task_type_priority?.length ? settings.task_type_priority : DEFAULT_PRIORITY),
                    ...DEFAULT_PRIORITY.filter((type) => !settings.task_type_priority?.includes(type)),
                  ]

                  const move = (index: number, direction: -1 | 1) => {
                    const next = [...priority]
                    const target = index + direction
                      ;[next[index], next[target]] = [next[target], next[index]]
                    patchSettings({ task_type_priority: next })
                  }

                  return (
                    <div className="flex flex-col gap-2.5 py-2.5 sm:gap-3 sm:py-3">
                      <div>
                        <Label className="text-xs font-medium sm:text-sm">Task Type Priority</Label>
                        <p className="text-[11px] text-muted-foreground sm:text-xs">Processing order when multiple task types are queued</p>
                      </div>
                      <div className="flex flex-col gap-1">
                        {priority.map((type, index) => (
                          <div key={type} className="flex items-center justify-between rounded border border-border bg-muted/40 px-2.5 py-1 sm:px-3 sm:py-1.5">
                            <span className="text-xs sm:text-sm">{TASK_TYPE_LABELS[type] ?? type}</span>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5.5 w-5.5 sm:h-7 sm:w-7"
                                disabled={index === 0}
                                onClick={() => move(index, -1)}
                              >
                                <ChevronUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5.5 w-5.5 sm:h-7 sm:w-7"
                                disabled={index === priority.length - 1}
                                onClick={() => move(index, 1)}
                              >
                                <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* Export Database */}
                <SettingRow label="Export Database" description="Download the SQLite database file">
                  <Button
                    variant="outline"
                    size="sm"
                    className={compactButtonClass}
                    onClick={() => {
                      const a = document.createElement('a')
                      a.href = apiUrl('/settings/export-db')
                      a.download = 'videoprocessor.db'
                      a.click()
                    }}
                  >
                    <Database className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Export DB
                  </Button>
                </SettingRow>

                <SettingRow
                  label="Clear Torrent Database"
                  description="Remove app torrent, file, task, queue, and notification records without touching the r18.dev dump database"
                >
                  <Button
                    variant="destructive"
                    size="sm"
                    className={compactButtonClass}
                    onClick={() => setIsClearTorrentDialogOpen(true)}
                    disabled={isBusy || isClearingTorrentDatabase}
                  >
                    {isClearingTorrentDatabase ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" /> : <Database className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
                    Clear Torrent DB
                  </Button>
                </SettingRow>

                {/* Clear Tasks */}
                <div className="flex flex-col gap-3 py-3 border-b border-border">
                  <div>
                    <Label className="text-sm font-medium">Clear Tasks</Label>
                    <p className="text-xs text-muted-foreground">Delete all tasks by status</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['queued', 'processing', 'completed', 'failed', 'cancelled'] as const).map((status) => (
                      <Button
                        key={status}
                        variant="outline"
                        size="sm"
                        onClick={() => handleClearStatus(status)}
                        disabled={isClearingStatus[status]}
                        className={compactButtonClass}
                      >
                        {isClearingStatus[status] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>

                <SettingRow label="Processing Hours" description="Only process tasks during a set time window. Start and end use your local 24-hour clock: 0 is midnight and 23 is 11 PM." className={settings.processing_hours_enabled ? "border-0" : ""}>
                  <Switch
                    checked={settings.processing_hours_enabled}
                    onCheckedChange={(v) => patchSettings({ processing_hours_enabled: v })}
                  />
                </SettingRow>

                {settings.processing_hours_enabled && (
                  <div className="rounded-lg overflow-hidden bg-muted/30 p-3">
                    <div className="grid grid-cols-[3rem_1fr] items-center gap-2 px-1 pb-2 text-[11px] font-medium text-muted-foreground sm:grid-cols-[4rem_1fr] sm:gap-3 sm:text-xs">
                      <span>Day</span>
                      <div className="grid grid-cols-[3.5rem_3.25rem_3.25rem] justify-end gap-1.5 text-right sm:grid-cols-[4rem_4rem_4rem] sm:gap-2">
                        <span>Run</span>
                        <span>Start</span>
                        <span>End</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {PROCESSING_DAYS.map(({ key, settingKey, label }) => (
                        <div key={key} className="grid grid-cols-[3rem_1fr] items-center gap-2 rounded-md px-1 py-1.5 sm:grid-cols-[4rem_1fr] sm:gap-3">
                          <Label className="text-xs font-medium sm:text-sm">{label}</Label>
                          <div className="grid grid-cols-[3.5rem_3.25rem_3.25rem] justify-end gap-1.5 sm:grid-cols-[4rem_4rem_4rem] sm:gap-2">
                            <div className="flex h-8 items-center justify-end">
                              <Switch
                                checked={Boolean(settings[settingKey])}
                                onCheckedChange={(v) => patchSettings({ [settingKey]: v })}
                              />
                            </div>
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={localProcessingWindows[key].start}
                              onChange={(e) => updateProcessingWindow(key, 'start', Number(e.target.value))}
                              className="h-8 w-[3.25rem] text-right text-xs sm:w-16 sm:text-sm"
                            />
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={localProcessingWindows[key].end}
                              onChange={(e) => updateProcessingWindow(key, 'end', Number(e.target.value))}
                              className="h-8 w-[3.25rem] text-right text-xs sm:w-16 sm:text-sm"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="behavior" className="mt-0">
                <SettingRow label="Default task type">
                  <Select
                    value={settings.default_task_type}
                    onValueChange={(v) => patchSettings({ default_task_type: v as AppSettings['default_task_type'] })}
                  >
                    <SelectTrigger className={cn(compactSelectClass, "w-32 sm:w-36")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scene">Scene</SelectItem>
                      <SelectItem value="split">Split</SelectItem>
                      <SelectItem value="subtitle">Subtitle</SelectItem>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="analyze_frame_pacing">Analyze + Frame Pacing Repair</SelectItem>
                      <SelectItem value="nvenc_frame_pacing">Frame Pacing Repair</SelectItem>
                      <SelectItem value="remux">Remux</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Default file layout">
                  <Select
                    value={settings.default_layout === 'tree' ? 'tree' : 'grid'}
                    onValueChange={(v) => patchSettings({ default_layout: v as 'grid' | 'tree' })}
                  >
                    <SelectTrigger className={cn(compactSelectClass, "w-32 sm:w-36")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="grid">Grid</SelectItem>
                      <SelectItem value="tree">Folder</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Default sort field">
                  <Select
                    value={settings.default_sort_field}
                    onValueChange={(v) => patchSettings({ default_sort_field: v })}
                  >
                    <SelectTrigger className={cn(compactSelectClass, "w-32 sm:w-36")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="name">Name</SelectItem>
                      <SelectItem value="size">Size</SelectItem>
                      <SelectItem value="created_at">Created</SelectItem>
                      <SelectItem value="modified_at">Modified</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Default sort direction">
                  <Select
                    value={settings.default_sort_direction}
                    onValueChange={(v) => patchSettings({ default_sort_direction: v as 'asc' | 'desc' })}
                  >
                    <SelectTrigger className={cn(compactSelectClass, "w-32 sm:w-36")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc">Ascending</SelectItem>
                      <SelectItem value="desc">Descending</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Show stats panel on load">
                  <Switch
                    checked={settings.show_stats_panel}
                    onCheckedChange={(v) => patchSettings({ show_stats_panel: v })}
                  />
                </SettingRow>
                <SettingRow label="Default subtitle language">
                  <Select
                    value={settings.default_subtitle_language}
                    onValueChange={(v) => patchSettings({ default_subtitle_language: v })}
                  >
                    <SelectTrigger className={cn(compactSelectClass, "w-32 sm:w-36")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="File Ignore Patterns">
                  <div className="w-full">
                    <Textarea
                      className="min-h-[72px] font-mono text-xs sm:min-h-[80px]"
                      placeholder={"*sample*\n*trailer*\n.avi"}
                      defaultValue={settings.ignore_patterns.join('\n')}
                      key={settings.ignore_patterns.join('\n')}
                      onBlur={(e) => {
                        const patterns = e.target.value
                          .split('\n')
                          .map((p) => p.trim())
                          .filter(Boolean)
                        patchSettings({ ignore_patterns: patterns })
                      }}
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">
                      One entry per line. Glob patterns (e.g. <code>*sample*</code>) or extensions (e.g. <code>.avi</code>).
                    </p>
                  </div>
                </SettingRow>
                <div className="flex flex-col gap-2.5 py-2.5 border-b border-border sm:gap-3 sm:py-3">
                  <div>
                    <Label className="text-sm font-semibold tracking-tight text-foreground sm:text-base">Actresses</Label>
                    <p className={compactHelpTextClass}>Settings for actress works, external lookups, qBittorrent, and bulk downloads.</p>
                  </div>
                  <div className="flex flex-col">
                    <SettingRow label="Show actress work covers" className="border-0">
                      <Switch
                        checked={settings.show_actress_work_covers}
                        onCheckedChange={(v) => patchSettings({ show_actress_work_covers: v })}
                      />
                    </SettingRow>
                    <SettingRow label="Show actress work titles" className="border-0">
                      <Switch
                        checked={settings.show_actress_work_titles}
                        onCheckedChange={(v) => patchSettings({ show_actress_work_titles: v })}
                      />
                    </SettingRow>
                    <div className="flex flex-col gap-2.5 py-2.5 sm:gap-3 sm:py-3">
                      <div>
                        <Label className="text-xs font-medium sm:text-sm">External video code links</Label>
                        <p className={compactHelpTextClass}>Use {'{videoCode}'} and optional {'{actress}'} in the URL template. The actress work card menu shows one action per valid row.</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        {externalVideoTargetsDraft.map((target, index) => (
                          <div key={index} className="grid grid-cols-[minmax(0,96px)_minmax(0,1fr)_auto] gap-1.5 items-center pl-1 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] sm:gap-2">
                            <Input
                              value={target.label}
                              onChange={(e) => updateExternalVideoTargetDraft(index, 'label', e.target.value)}
                              onBlur={commitExternalVideoTargets}
                              placeholder="Google"
                              className="h-8 text-xs sm:h-9 sm:text-sm"
                            />
                            <Input
                              value={target.url_template}
                              onChange={(e) => updateExternalVideoTargetDraft(index, 'url_template', e.target.value)}
                              onBlur={commitExternalVideoTargets}
                              placeholder="https://www.google.com/search?q={videoCode}+{actress}"
                              className="h-8 text-xs font-mono sm:h-9 sm:text-sm"
                            />
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className={compactIconButtonClass}
                                onClick={() => moveExternalVideoTarget(index, -1)}
                                disabled={index === 0}
                                aria-label={`Move external video target ${target.label || index + 1} up`}
                              >
                                <ChevronUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className={compactIconButtonClass}
                                onClick={() => moveExternalVideoTarget(index, 1)}
                                disabled={index === externalVideoTargetsDraft.length - 1}
                                aria-label={`Move external video target ${target.label || index + 1} down`}
                              >
                                <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className={compactIconButtonClass}
                                onClick={() => removeExternalVideoTarget(index)}
                                aria-label={`Remove external video target ${target.label || index + 1}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center justify-between gap-3">
                          <p className={compactHelpTextClass}>Invalid rows stay in settings but do not appear on the card menu.</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={compactButtonClass}
                            onClick={addExternalVideoTarget}
                          >
                            <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            Add Link
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2.5 py-2.5 sm:gap-3 sm:py-3">
                      <div>
                        <Label className="text-xs font-medium sm:text-sm">Scraper websites</Label>
                        <p className={compactHelpTextClass}>Add reusable actress-page URLs. Include {'{actress_name}'} where the entered actress name should go.</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        {scraperTemplatesDraft.map((template, index) => (
                          <div key={index} className="grid grid-cols-[minmax(0,96px)_minmax(0,1fr)_auto] gap-1.5 items-center pl-1 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] sm:gap-2">
                            <Input
                              value={template.label}
                              onChange={(e) => updateScraperTemplateDraft(index, 'label', e.target.value)}
                              onBlur={commitScraperTemplates}
                              placeholder="Website label, e.g. JavPlayer"
                              className="h-8 text-xs sm:h-9 sm:text-sm"
                            />
                            <Input
                              value={template.url_template}
                              onChange={(e) => updateScraperTemplateDraft(index, 'url_template', e.target.value)}
                              onBlur={commitScraperTemplates}
                              placeholder="https://javplayer.org/model/{actress_name}"
                              className="h-8 text-xs font-mono sm:h-9 sm:text-sm"
                            />
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className={compactIconButtonClass}
                                onClick={() => moveScraperTemplate(index, -1)}
                                disabled={index === 0}
                                aria-label={`Move scraper website ${template.label || index + 1} up`}
                              >
                                <ChevronUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className={compactIconButtonClass}
                                onClick={() => moveScraperTemplate(index, 1)}
                                disabled={index === scraperTemplatesDraft.length - 1}
                                aria-label={`Move scraper website ${template.label || index + 1} down`}
                              >
                                <ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className={compactIconButtonClass}
                                onClick={() => removeScraperTemplate(index)}
                                aria-label={`Remove scraper website ${template.label || index + 1}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center justify-between gap-3">
                          <p className={compactHelpTextClass}>Rows without a label or {'{actress_name}'} stay saved but are hidden from the template dropdown.</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={compactButtonClass}
                            onClick={addScraperTemplate}
                          >
                            <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            Add Website
                          </Button>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2.5 py-2.5 sm:gap-3 sm:py-3">
                      <div>
                        <Label className="text-xs font-medium sm:text-sm">qBittorrent</Label>
                        <p className={compactHelpTextClass}>Web UI credentials for sending torrents</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Label className="w-16 shrink-0 text-[11px] text-muted-foreground sm:w-20 sm:text-xs">URL</Label>
                          <Input
                            type="text"
                            placeholder="http://unraid:8080"
                            value={settings.qbittorrent_url}
                            onChange={(e) => patchSettings({ qbittorrent_url: e.target.value })}
                            className={cn(compactInputClass, "flex-1")}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="w-16 shrink-0 text-[11px] text-muted-foreground sm:w-20 sm:text-xs">Username</Label>
                          <Input
                            type="text"
                            placeholder="admin"
                            value={settings.qbittorrent_username}
                            onChange={(e) => patchSettings({ qbittorrent_username: e.target.value })}
                            className={cn(compactInputClass, "flex-1")}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="w-16 shrink-0 text-[11px] text-muted-foreground sm:w-20 sm:text-xs">Password</Label>
                          <Input
                            type="password"
                            placeholder="••••••••"
                            value={settings.qbittorrent_password}
                            onChange={(e) => patchSettings({ qbittorrent_password: e.target.value })}
                            className={cn(compactInputClass, "flex-1")}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2.5 py-2.5 sm:gap-3 sm:py-3">
                      <div>
                        <Label className="text-xs font-medium sm:text-sm">Bulk Download</Label>
                        <p className={compactHelpTextClass}>Queue timing settings for actress work downloads</p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Label className="w-28 shrink-0 text-[11px] text-muted-foreground sm:w-36 sm:text-xs">Base delay (seconds)</Label>
                          <Input
                            type="number"
                            min={0}
                            value={settings.queue_base_delay_seconds}
                            onChange={(e) => patchSettings({ queue_base_delay_seconds: Number(e.target.value) })}
                            className={cn(compactInputClass, "flex-1")}
                          />
                        </div>
                        <p className="pl-[7.5rem] text-[11px] text-muted-foreground sm:pl-[9.5rem] sm:text-xs">Wait between each download</p>
                        <div className="flex items-center gap-2">
                          <Label className="w-28 shrink-0 text-[11px] text-muted-foreground sm:w-36 sm:text-xs">Jitter (seconds)</Label>
                          <Input
                            type="number"
                            min={0}
                            value={settings.queue_jitter_seconds}
                            onChange={(e) => patchSettings({ queue_jitter_seconds: Number(e.target.value) })}
                            className={cn(compactInputClass, "flex-1")}
                          />
                        </div>
                        <p className="pl-[7.5rem] text-[11px] text-muted-foreground sm:pl-[9.5rem] sm:text-xs">Random ±variation added to base delay</p>
                        <div className="flex items-center gap-2">
                          <Label className="w-28 shrink-0 text-[11px] text-muted-foreground sm:w-36 sm:text-xs">Window start (UTC hour)</Label>
                          <Input
                            type="number"
                            min={0}
                            max={23}
                            value={settings.queue_window_start_hour}
                            onChange={(e) => patchSettings({ queue_window_start_hour: Number(e.target.value) })}
                            className={cn(compactInputClass, "flex-1")}
                          />
                        </div>
                        <p className="pl-[7.5rem] text-[11px] text-muted-foreground sm:pl-[9.5rem] sm:text-xs">0 = always on; set both start and end to enable a window</p>
                        <div className="flex items-center gap-2">
                          <Label className="w-28 shrink-0 text-[11px] text-muted-foreground sm:w-36 sm:text-xs">Window end (UTC hour)</Label>
                          <Input
                            type="number"
                            min={0}
                            max={23}
                            value={settings.queue_window_end_hour}
                            onChange={(e) => patchSettings({ queue_window_end_hour: Number(e.target.value) })}
                            className={cn(compactInputClass, "flex-1")}
                          />
                        </div>
                        <p className="pl-[7.5rem] text-[11px] text-muted-foreground sm:pl-[9.5rem] sm:text-xs">Downloads only run between start and end hour (UTC)</p>
                        <div className="flex items-center gap-2">
                          <Label className="w-28 shrink-0 text-[11px] text-muted-foreground sm:w-36 sm:text-xs">Time limit (minutes)</Label>
                          <Input
                            type="number"
                            min={0}
                            value={settings.queue_download_time_limit_minutes}
                            onChange={(e) => patchSettings({ queue_download_time_limit_minutes: Number(e.target.value) })}
                            className={cn(compactInputClass, "flex-1")}
                          />
                        </div>
                        <p className="pl-[7.5rem] text-[11px] text-muted-foreground sm:pl-[9.5rem] sm:text-xs">0 disables it; timed-out torrents are removed from qBittorrent and marked failed</p>
                      </div>
                    </div>
                  </div>
                </div>

              </TabsContent>

              <TabsContent value="processing" className="mt-2 sm:mt-4">
                <div className="mb-2 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => patchSettings({ ...PROCESSING_SETTINGS_DEFAULTS })}
                    className={compactButtonClass}
                  >
                    <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Reset
                  </Button>
                </div>
                <SettingRow label="Task poll interval (ms)">
                  <Input type="number" min={500} step={500} value={settings.task_poll_interval_ms}
                    onChange={(e) => patchSettings({ task_poll_interval_ms: Number(e.target.value) })} className={cn(compactInputClass, "w-20 sm:w-24")} />
                </SettingRow>
                <SettingRow label="Task stall threshold (minutes)" description="Auto-cancel tasks with no progress for this long">
                  <Input
                    type="number"
                    min={1}
                    value={settings.task_stall_minutes}
                    onChange={(e) => patchSettings({ task_stall_minutes: Number(e.target.value) })}
                    className={cn(compactInputClass, "w-20 sm:w-24")}
                  />
                </SettingRow>

                <SettingRow label="Scene timeout (minutes)" description="Auto-cancel scene detection tasks (default: 60 min)">
                  <Input
                    type="number"
                    min={1}
                    value={settings.scene_timeout_minutes ?? ''}
                    onChange={(e) => patchSettings({ scene_timeout_minutes: e.target.value ? Number(e.target.value) : null })}
                    className={cn(compactInputClass, "w-20 sm:w-24")}
                    placeholder="60"
                  />
                </SettingRow>
                <SettingRow label="Scene detector">
                  <Select
                    value={settings.scene_detector}
                    onValueChange={(v) => patchSettings({ scene_detector: v as AppSettings['scene_detector'] })}
                  >
                    <SelectTrigger className={cn(compactSelectClass, "w-32 sm:w-36")}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="content">Content</SelectItem>
                      <SelectItem value="adaptive">Adaptive</SelectItem>
                      <SelectItem value="threshold">Threshold</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>

                {settings.scene_detector === 'content' && (
                  <SettingRow label={`Content threshold: ${settings.scene_content_threshold}`}>
                    <Slider min={1} max={100} step={1} value={[settings.scene_content_threshold]}
                      onValueChange={([v]) => patchSettings({ scene_content_threshold: v })} className="w-28 sm:w-36" />
                  </SettingRow>
                )}

                {settings.scene_detector === 'adaptive' && (
                  <SettingRow label={`Adaptive threshold: ${settings.scene_adaptive_threshold}`} description="Sensitivity for gradual transitions (1–10)">
                    <Slider min={1} max={10} step={0.1} value={[settings.scene_adaptive_threshold]}
                      onValueChange={([v]) => patchSettings({ scene_adaptive_threshold: v })} className="w-28 sm:w-36" />
                  </SettingRow>
                )}

                {settings.scene_detector === 'threshold' && (
                  <>
                    <SettingRow label={`Black threshold: ${settings.scene_black_threshold}`} description="Luminance floor for fade-to-black (0–255)">
                      <Slider min={0} max={255} step={1} value={[settings.scene_black_threshold]}
                        onValueChange={([v]) => patchSettings({ scene_black_threshold: v })} className="w-28 sm:w-36" />
                    </SettingRow>
                    <SettingRow label={`White threshold: ${settings.scene_white_threshold}`} description="Luminance ceiling for fade-to-white (0–255)">
                      <Slider min={0} max={255} step={1} value={[settings.scene_white_threshold]}
                        onValueChange={([v]) => patchSettings({ scene_white_threshold: v })} className="w-28 sm:w-36" />
                    </SettingRow>
                  </>
                )}

                <SettingRow label="Min scene length (seconds)">
                  <Input type="number" min={1} value={settings.min_scene_length_frames}
                    onChange={(e) => patchSettings({ min_scene_length_frames: Number(e.target.value) })} className={cn(compactInputClass, "w-20 sm:w-24")} />
                </SettingRow>
                <SettingRow label="Scene detection concurrency" description="Max videos analyzed for scenes in parallel (max: 3). Later processing stages remain sequential.">
                  <Select
                    value={String(settings.scene_detection_concurrency)}
                    onValueChange={(v) => patchSettings({ scene_detection_concurrency: Number(v) })}
                  >
                    <SelectTrigger className={cn(compactSelectClass, "w-20 sm:w-24")}><span className="w-3 sm:w-4" /><SelectValue className="flex-1 text-center" /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 3 }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Frame pacing analyzer concurrency" description="Max videos scanned in parallel by the Tools frame pacing analyzer (max: 8)">
                  <Select
                    value={String(settings.frame_pacing_analyzer_concurrency)}
                    onValueChange={(v) => patchSettings({ frame_pacing_analyzer_concurrency: Number(v) })}
                  >
                    <SelectTrigger className={cn(compactSelectClass, "w-20 sm:w-24")}><span className="w-3 sm:w-4" /><SelectValue className="flex-1 text-center" /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Frame pacing analyzer timeout (minutes)" description="Stop an individual frame pacing scan after this long (max: 240)">
                  <Input
                    type="number"
                    min={1}
                    max={240}
                    value={settings.frame_pacing_analyzer_timeout_minutes}
                    onChange={(e) => patchSettings({ frame_pacing_analyzer_timeout_minutes: Number(e.target.value) })}
                    className={cn(compactInputClass, "w-20 sm:w-24")}
                  />
                </SettingRow>
                <SettingRow label="Split timeout (minutes)" description="Auto-cancel video splitting tasks (default: 60 min)">
                  <Input
                    type="number"
                    min={1}
                    value={settings.split_timeout_minutes ?? ''}
                    onChange={(e) => patchSettings({ split_timeout_minutes: e.target.value ? Number(e.target.value) : null })}
                    className={cn(compactInputClass, "w-20 sm:w-24")}
                    placeholder="60"
                  />
                </SettingRow>
                <SettingRow label="Split concurrency" description="Max parallel ffmpeg processes during video splitting (max: 3)">
                  <Select
                    value={String(settings.split_concurrency)}
                    onValueChange={(v) => patchSettings({ split_concurrency: Number(v) })}
                  >
                    <SelectTrigger className={cn(compactSelectClass, "w-20 sm:w-24")}><span className="w-3 sm:w-4" /><SelectValue className="flex-1 text-center" /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 3 }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Subtitle timeout (minutes)" description="Auto-cancel subtitle generation tasks (default: 60 min)">
                  <Input
                    type="number"
                    min={1}
                    value={settings.subtitle_timeout_minutes ?? ''}
                    onChange={(e) => patchSettings({ subtitle_timeout_minutes: e.target.value ? Number(e.target.value) : null })}
                    className={cn(compactInputClass, "w-20 sm:w-24")}
                    placeholder="60"
                  />
                </SettingRow>
                <SettingRow label="Subtitle concurrency" description="Max parallel Whisper jobs during subtitle generation. Capped at 2 by the Whisper thread pool (max: 2)">
                  <Select
                    value={String(settings.subtitle_concurrency)}
                    onValueChange={(v) => patchSettings({ subtitle_concurrency: Number(v) })}
                  >
                    <SelectTrigger className={cn(compactSelectClass, "w-20 sm:w-24")}><span className="w-3 sm:w-4" /><SelectValue className="flex-1 text-center" /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 2 }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Prevent split under (seconds)" description="Skip video splitting when the source video is shorter than this threshold. Use 0 to disable.">
                  <Input
                    type="number"
                    min={0}
                    value={settings.split_min_video_duration_seconds}
                    onChange={(e) => patchSettings({ split_min_video_duration_seconds: Number(e.target.value) })}
                    className={cn(compactInputClass, "w-20 sm:w-24")}
                  />
                </SettingRow>
              </TabsContent>

            </div>
          </Tabs>
        </DialogContent>


      </Dialog>

      <AlertDialog open={isClearTorrentDialogOpen} onOpenChange={setIsClearTorrentDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear torrent database?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes app records for torrents, files, tasks, queue items, notifications, and logs. Your
              `r18.dev` dump database is not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogWarning message="Active processing must be stopped before this can run." />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearingTorrentDatabase}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleClearTorrentDatabase()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isClearingTorrentDatabase ? 'Clearing...' : 'Clear App Torrent Data'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SelectiveScanDialog
        open={selectiveScanOpen}
        onOpenChange={setSelectiveScanOpen}
        topLevelDirs={topLevelDirs}
        topLevelError={topLevelError}
        selectedDirs={selectedDirs}
        setSelectedDirs={setSelectedDirs}
        onSaveSelection={saveSelectiveScanSelection}
        onStartScan={startSelectiveScan}
      />

      <SelectiveCleanupDialog
        open={selectiveCleanupOpen}
        onOpenChange={setSelectiveCleanupOpen}
        topLevelDirs={topLevelDirs}
        topLevelError={topLevelError}
        selectedDirs={selectedDirs}
        setSelectedDirs={setSelectedDirs}
        onSaveSelection={saveSelectiveCleanupSelection}
        onStartCleanup={startSelectiveCleanup}
      />

      <SelectiveSrtCleanupDialog
        open={selectiveSrtCleanupOpen}
        onOpenChange={setSelectiveSrtCleanupOpen}
        topLevelDirs={topLevelDirs}
        topLevelError={topLevelError}
        selectedDirs={selectedDirs}
        setSelectedDirs={setSelectedDirs}
        onSaveSelection={saveSrtCleanupSelection}
        onStartSrtCleanup={startSelectiveSrtCleanup}
      />
    </>
  )
}
