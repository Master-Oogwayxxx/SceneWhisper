import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowLeft, Calendar, Download, FileText, FolderOpen, ListVideo, LoaderCircle, Monitor, RefreshCw, Search, SlidersHorizontal, Wrench, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { fileApi } from '@/api/files'
import { taskApi } from '@/api/tasks'
import { toolsApi, type FramePacingProgress, type FramePacingRunResult } from '@/api/tools'
import type { DirectoryRecord, File, Task } from '@/types/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface Props { onBack: () => void }
interface Result extends FramePacingRunResult { }
interface ScopedFileRow {
  file: File
  result?: Result
  isProcessing: boolean
  processingProgress?: FramePacingProgress
  processingStartedAt?: number
}
interface AnalysisFilters {
  search: string
  dateRange: string
  dateFrom: string
  dateTo: string
  directoryId: string
  format: string
  resolution: string
  status: string
  splitMode: string
}

const EMPTY_FILTERS: AnalysisFilters = { search: '', dateRange: '', dateFrom: '', dateTo: '', directoryId: '', format: '', resolution: '', status: '', splitMode: '' }
const DATE_RANGE_OPTIONS: [string, string][] = [['', 'Any date'], ['today', 'Today'], ['last_7_days', 'Last 7 days'], ['last_30_days', 'Last 30 days'], ['this_month', 'This Month'], ['this_year', 'This Year'], ['last_year', 'Last year'], ['custom', 'Custom Date Range']]

const statusVariant = (status: Result['status']) => status === 'severe' ? 'destructive' : status === 'healthy' ? 'secondary' : 'outline'
const isSplitVideo = (file: File) => /-\d{3}(?=\.[^.]+$|$)/.test(file.name)
const formatElapsedTime = (milliseconds: number) => {
  const seconds = milliseconds / 1000
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`
}
const formatAnalysisTime = (result?: Result, startedAt?: number, now?: number) => {
  if (result) return formatElapsedTime(result.analysisTimeMs)
  if (startedAt && now) return formatElapsedTime(now - startedAt)
  return '-'
}
const escapeCsvValue = (value: string | number | null | undefined) => {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const buildResultsCsv = (nextResults: Result[]) => {
  const headers = ['File', 'Path', 'Status', 'Issue score', 'Time', 'Detected FPS', 'Recommended FPS', 'Frames analyzed', 'Irregular frames', 'Irregular percent', 'Repeated frames', 'Large gaps', 'Message']
  const rows = nextResults.map((result) => [
    result.file.name,
    result.file.path,
    result.status,
    result.score,
    formatElapsedTime(result.analysisTimeMs),
    result.detectedFps ?? '',
    result.recommendedFps ?? '',
    result.framesAnalyzed,
    result.irregularFrames,
    result.irregularPercent,
    result.repeatedFrames,
    result.largeGaps,
    result.message ?? '',
  ])
  return [headers, ...rows].map((row) => row.map(escapeCsvValue).join(',')).join('\n')
}
const isDirectoryRecord = (item: unknown): item is DirectoryRecord => {
  if (!item || typeof item !== 'object') return false
  const record = item as Partial<DirectoryRecord> & {
    child_ids?: unknown
    duration?: unknown
    file_type?: unknown
    format?: unknown
    size?: unknown
  }
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.path === 'string' &&
    ('parent_id' in record ? typeof record.parent_id === 'string' || record.parent_id === null : true) &&
    !('child_ids' in record) &&
    !('duration' in record) &&
    !('file_type' in record) &&
    !('format' in record) &&
    !('size' in record)
  )
}
const directoryDisplayName = (directory: DirectoryRecord) => {
  const trimmedName = directory.name.trim()
  if (trimmedName) return trimmedName
  const trimmedPath = directory.path.replace(/[\\/]+$/, '')
  return trimmedPath.split(/[\\/]/).pop() || directory.path
}
const parentDirectoryName = (path: string) => {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : path
}

export function FramePacingAnalyzerTool({ onBack }: Props) {
  const [scopedFiles, setScopedFiles] = useState<File[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [isLoadingScope, setIsLoadingScope] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isQueueing, setIsQueueing] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [overwriteOriginal, setOverwriteOriginal] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [processingFileIds, setProcessingFileIds] = useState<Set<string>>(new Set())
  const [fileProgress, setFileProgress] = useState<Map<string, FramePacingProgress>>(new Map())
  const [fileStartedAt, setFileStartedAt] = useState<Map<string, number>>(new Map())
  const [now, setNow] = useState(() => performance.now())
  const [directories, setDirectories] = useState<DirectoryRecord[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [customDateRangeOpen, setCustomDateRangeOpen] = useState(false)
  const [repairDialogOpen, setRepairDialogOpen] = useState(false)
  const [filters, setFilters] = useState<AnalysisFilters>(EMPTY_FILTERS)
  const [draftFilters, setDraftFilters] = useState<AnalysisFilters>(EMPTY_FILTERS)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const completedRunNotifiedRef = useRef<string | null>(null)
  const lastSelectionAnchorRef = useRef<string | null>(null)
  const selectionShiftKeyRef = useRef(false)

  const applyRun = (run: Awaited<ReturnType<typeof toolsApi.getFramePacingRun>>) => {
    const nextResults = [...run.results].sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name))
    const completedIds = new Set(nextResults.map((result) => result.fileId))
    const runFiles = run.files.length ? run.files : nextResults.map((result) => result.file)
    setResults(nextResults)
    setProgress({ done: run.done, total: run.total })
    const progressMap = new Map(run.progress.map((progress) => [progress.fileId, progress]))
    setFileProgress(progressMap)
    if (runFiles.length) setScopedFiles((files) => files.length ? files : runFiles)
    if (run.status === 'queued' || run.status === 'running') {
      setActiveRunId(run.id)
      setIsAnalyzing(true)
      setFiltersOpen(false)
      const runningIds = Array.from(progressMap.keys()).filter((fileId) => !completedIds.has(fileId))
      setProcessingFileIds(new Set(runningIds))
      setFileStartedAt((previous) => {
        const elapsedSinceRunStart = run.startedAt ? Math.max(0, Date.now() - Date.parse(run.startedAt)) : 0
        const fallbackStartedAt = Math.max(0, performance.now() - elapsedSinceRunStart)
        return new Map(runningIds.map((fileId) => {
          const savedProgressStartedAt = progressMap.get(fileId)?.createdAt
          const parsedProgressStartedAt = savedProgressStartedAt ? Date.parse(savedProgressStartedAt) : NaN
          const elapsedSinceProgressStart = Number.isFinite(parsedProgressStartedAt) ? Math.max(0, Date.now() - parsedProgressStartedAt) : null
          const restoredStartedAt = elapsedSinceProgressStart === null ? fallbackStartedAt : Math.max(0, performance.now() - elapsedSinceProgressStart)
          return [fileId, previous.get(fileId) ?? restoredStartedAt]
        }))
      })
      return
    }
    setActiveRunId(null)
    setIsAnalyzing(false)
    setProcessingFileIds(new Set())
    setFileStartedAt(new Map())
    const repairCandidates = nextResults.filter((result) => result.status === 'severe' || result.status === 'suspect')
    setSelected(new Set(repairCandidates.map((result) => result.fileId)))
    if (run.status === 'completed' && completedRunNotifiedRef.current !== run.id) {
      completedRunNotifiedRef.current = run.id
      toast.success(`Analyzed ${run.done} video${run.done === 1 ? '' : 's'}; ${repairCandidates.length} need review`)
    }
    if (run.status === 'failed' && run.error) toast.error(run.error)
    if (run.status === 'cancelled' && completedRunNotifiedRef.current !== run.id) {
      completedRunNotifiedRef.current = run.id
      toast.info(`Analysis stopped after ${run.done} of ${run.total}`)
    }
  }

  useEffect(() => {
    void fileApi.getDirectories().then((items) => setDirectories(items.filter(isDirectoryRecord))).catch(() => toast.error('Failed to load directories'))
  }, [])

  useEffect(() => {
    void toolsApi.getLatestFramePacingRun().then((run) => {
      if (run) {
        applyRun(run)
        if (run.status !== 'queued' && run.status !== 'running') setFiltersOpen(true)
        return
      }
      setFiltersOpen(true)
    }).catch(() => toast.error('Failed to load last frame pacing analysis'))
  }, [])

  useEffect(() => {
    if (!activeRunId) return
    const timer = window.setInterval(() => {
      void toolsApi.getFramePacingRun(activeRunId).then(applyRun).catch(() => toast.error('Failed to refresh frame pacing analysis'))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [activeRunId])

  useEffect(() => {
    if (!isAnalyzing) return
    const timer = window.setInterval(() => setNow(performance.now()), 500)
    return () => window.clearInterval(timer)
  }, [isAnalyzing])

  const activeFilterCount = [
    filters.search,
    filters.dateRange,
    filters.directoryId,
    filters.format,
    filters.resolution,
    filters.status,
    filters.splitMode,
  ].filter(Boolean).length
  const usesCustomDateRange = draftFilters.dateRange === 'custom'
  const customDateRangeLabel = draftFilters.dateFrom || draftFilters.dateTo
    ? `${draftFilters.dateFrom || 'Any start'} to ${draftFilters.dateTo || 'Any end'}`
    : 'Choose dates'
  const resultMap = useMemo(() => new Map(results.map((result) => [result.fileId, result])), [results])
  const scopedRows = useMemo<ScopedFileRow[]>(() => scopedFiles.map((file) => ({
    file,
    result: resultMap.get(file.id),
    isProcessing: processingFileIds.has(file.id),
    processingProgress: fileProgress.get(file.id),
    processingStartedAt: fileStartedAt.get(file.id),
  })), [fileProgress, fileStartedAt, processingFileIds, resultMap, scopedFiles])
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return scopedRows.filter(({ file }) => !query || file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query))
  }, [scopedRows, search])
  const handleRowSelection = (fileId: string, checked: boolean, useRange: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous)
      const anchorId = lastSelectionAnchorRef.current
      const anchorIndex = anchorId ? visible.findIndex((item) => item.file.id === anchorId) : -1
      const targetIndex = visible.findIndex((item) => item.file.id === fileId)

      if (useRange && anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
        visible.slice(start, end + 1).forEach((item) => {
          if (checked) next.add(item.file.id)
          else next.delete(item.file.id)
        })
      } else if (checked) {
        next.add(fileId)
      } else {
        next.delete(fileId)
      }

      return next
    })
    lastSelectionAnchorRef.current = fileId
  }
  const selectedCount = scopedFiles.filter((file) => selected.has(file.id)).length
  const repairSelectedCount = results.filter((result) => selected.has(result.fileId)).length
  const activeAnalysisCount = processingFileIds.size
  const downloadResults = () => {
    if (!results.length) {
      toast.info('No analysis results to export')
      return
    }
    const blob = new Blob([buildResultsCsv(results)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'frame-pacing-last-analysis.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const loadScope = async (nextFilters = filters) => {
    setIsLoadingScope(true)
    setResults([])
    setSelected(new Set())
    setProgress({ done: 0, total: 0 })
    setProcessingFileIds(new Set())
    setFileProgress(new Map())
    setFileStartedAt(new Map())
    try {
      const response = await fileApi.getFiles({
        page: 1,
        limit: 10000,
        search: nextFilters.search,
        type: 'video',
        format: nextFilters.format || null,
        dateRange: nextFilters.dateRange === 'custom' ? null : nextFilters.dateRange || null,
        dateFrom: nextFilters.dateRange === 'custom' ? nextFilters.dateFrom || null : null,
        dateTo: nextFilters.dateRange === 'custom' ? nextFilters.dateTo || null : null,
        directoryId: nextFilters.directoryId || null,
        resolution: nextFilters.resolution || null,
        status: nextFilters.status || null,
        sortBy: 'name',
        sortDir: 'asc',
      })
      const files = response.files.filter((file) => !file.is_deleted && (nextFilters.splitMode !== 'split' || isSplitVideo(file)))
      setScopedFiles(files)
      setSelected(new Set())
      setProgress({ done: 0, total: files.length })
      toast.success(`Loaded ${files.length} video${files.length === 1 ? '' : 's'} in scope`)
    } catch {
      toast.error('Failed to load scoped videos')
    } finally {
      setIsLoadingScope(false)
    }
  }

  const analyze = async () => {
    if (!scopedFiles.length) {
      toast.info('Choose a scope first')
      setDraftFilters(filters)
      setFiltersOpen(true)
      return
    }

    const filesToAnalyze = scopedFiles.filter((file) => selected.has(file.id))
    if (!filesToAnalyze.length) {
      toast.info('Select at least one video to analyze')
      return
    }

    setIsAnalyzing(true)
    completedRunNotifiedRef.current = null
    setResults([])
    setProgress({ done: 0, total: filesToAnalyze.length })
    setProcessingFileIds(new Set())
    setFileProgress(new Map())
    setFileStartedAt(new Map())
    setNow(performance.now())
    try {
      const run = await toolsApi.startFramePacingRun(filesToAnalyze.map((file) => file.id))
      setActiveRunId(run.id)
      applyRun(run)
      toast.success(`Frame pacing analysis started for ${run.total} video${run.total === 1 ? '' : 's'}`)
    } catch (error) {
      setIsAnalyzing(false)
      setProcessingFileIds(new Set())
      setFileProgress(new Map())
      setFileStartedAt(new Map())
      toast.error(error instanceof Error ? error.message : 'Failed to start frame pacing analysis')
    }
  }

  const queueRepairs = async () => {
    const chosen = results.filter((result) => selected.has(result.fileId))
    if (!chosen.length) {
      toast.info('Select at least one analyzed video to repair')
      return
    }
    setIsQueueing(true)
    let queued = 0
    for (const result of chosen) {
      const task: Task = {
        id: '', file: result.file, type: 'nvenc_frame_pacing', status: 'queued',
        scene_progress: 0, split_progress: 0, subtitle_progress: 0,
        createdAt: new Date(), nvenc_overwrite_original: overwriteOriginal,
      }
      try { await taskApi.addTaskVideo(task); queued += 1 } catch { /* Continue queuing remaining selections. */ }
    }
    setIsQueueing(false)
    setRepairDialogOpen(false)
    toast.success(`Queued ${queued} of ${chosen.length} frame pacing repair task${chosen.length === 1 ? '' : 's'}`)
  }

  const cancelAnalysis = async () => {
    if (!activeRunId) return
    setIsCancelling(true)
    try {
      const run = await toolsApi.cancelFramePacingRun(activeRunId)
      applyRun(run)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to stop frame pacing analysis')
    } finally {
      setIsCancelling(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background shadow sm:rounded-lg">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onBack} title="Back to tools"><ArrowLeft className="h-4 w-4" /></Button>
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary"><Activity className="h-4 w-4" /></span>
          <div><h2 className="text-base font-semibold">Frame Pacing Analyzer</h2><p className="text-xs text-muted-foreground">{isAnalyzing ? `Analyzing ${progress.done} of ${progress.total} · ${activeAnalysisCount} running` : `${scopedFiles.length} in scope · ${selectedCount} selected · ${results.length} analyzed`}</p></div>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 lg:justify-end">
          {isAnalyzing && <Button size="sm" variant="destructive" disabled={isCancelling || !activeRunId} onClick={() => void cancelAnalysis()}>{isCancelling ? 'Stopping...' : 'Stop Background Run'}</Button>}
          <Button size="sm" variant="outline" disabled={isAnalyzing} onClick={() => { setDraftFilters(filters); setFiltersOpen(true) }}><SlidersHorizontal className="mr-2 h-4 w-4" />Scope{activeFilterCount ? ` (${activeFilterCount})` : ''}</Button>
          {!isAnalyzing && <Button size="sm" disabled={isLoadingScope || !selectedCount} onClick={() => void analyze()}><RefreshCw className="mr-2 h-4 w-4" />Analyze selected ({selectedCount})</Button>}
          <Button size="sm" variant="outline" disabled={!repairSelectedCount || isQueueing || isAnalyzing} onClick={() => setRepairDialogOpen(true)}><Wrench className="mr-2 h-4 w-4" />Repair selected ({repairSelectedCount})</Button>
          <Button size="sm" variant="outline" disabled={!results.length || isAnalyzing} onClick={downloadResults}><Download className="mr-2 h-4 w-4" />Export last ({results.length})</Button>
          <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search shown files" className="pl-9" /></div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar">
        <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-border bg-background"><tr><th className="w-14 px-3 py-2"><Checkbox disabled={isAnalyzing || !visible.length} checked={visible.length > 0 && visible.every((item) => selected.has(item.file.id))} onCheckedChange={(value) => setSelected((previous) => { const next = new Set(previous); visible.forEach((item) => value === true ? next.add(item.file.id) : next.delete(item.file.id)); return next })} /></th><th className="px-3 py-2">File</th><th className="w-28 px-3 py-2">Time</th><th className="w-28 px-3 py-2">Analysis</th><th className="w-28 px-3 py-2"><MetricHeader label="Issue score" tooltip="Overall pacing problem score from 0 to 100. Higher means more detected timing, gap, or repeat issues." /></th><th className="w-32 px-3 py-2">FPS</th><th className="w-36 px-3 py-2"><MetricHeader label="Irregular" tooltip="Frames whose timing differs from the detected cadence, including duplicate or backward timestamps." /></th><th className="w-28 px-3 py-2"><MetricHeader label="Repeated" tooltip="Visually repeated frames detected by ffmpeg mpdecimate. Higher counts can indicate stutter." /></th><th className="w-28 px-3 py-2"><MetricHeader label="Large gaps" tooltip="Frame timestamp gaps much larger than the normal cadence. These can appear as hitches or skips." /></th></tr></thead>
          <tbody>{visible.map(({ file, result, isProcessing, processingProgress, processingStartedAt }) => <tr key={file.id} className="border-b border-border/70 hover:bg-secondary/40"><td className="px-3 py-2"><Checkbox disabled={isAnalyzing} checked={selected.has(file.id)} onClick={(event) => { selectionShiftKeyRef.current = event.shiftKey }} onCheckedChange={(value) => handleRowSelection(file.id, value === true, selectionShiftKeyRef.current)} /></td><td className="min-w-0 px-3 py-2"><div className="truncate font-medium" title={file.name}>{file.name}</div><div className="truncate text-xs text-muted-foreground" title={file.path}>{parentDirectoryName(file.path)}</div>{result?.message && <div className="text-xs text-destructive">{result.message}</div>}</td><td className="px-3 py-2 text-muted-foreground">{formatAnalysisTime(result, processingStartedAt, now)}</td><td className="px-3 py-2">{result ? <Badge variant={statusVariant(result.status)} className="capitalize">{result.status}</Badge> : isProcessing ? <ProcessingProgress value={processingProgress?.progress ?? 0} framesAnalyzed={processingProgress?.framesAnalyzed ?? 0} message={processingProgress?.message} /> : <span className="text-muted-foreground">-</span>}</td><td className="px-3 py-2 font-medium">{result?.score ?? '-'}</td><td className="px-3 py-2 text-muted-foreground">{result ? `${result.detectedFps?.toFixed(3) ?? 'Unknown'}${result.recommendedFps ? ` / ${result.recommendedFps.toFixed(3)}` : ''}` : '-'}</td><td className="px-3 py-2 text-muted-foreground">{result ? `${result.irregularFrames.toLocaleString()} (${result.irregularPercent.toFixed(2)}%)` : '-'}</td><td className="px-3 py-2 text-muted-foreground">{result ? result.repeatedFrames.toLocaleString() : '-'}</td><td className="px-3 py-2 text-muted-foreground">{result ? result.largeGaps.toLocaleString() : '-'}</td></tr>)}</tbody>
        </table>
        {!visible.length && <div className="px-3 py-14 text-center text-sm text-muted-foreground">{isLoadingScope ? 'Loading scoped videos...' : scopedFiles.length ? 'No files match the table search' : 'Choose a scope to review matching videos before analysis'}</div>}
      </div>

      <Dialog open={filtersOpen && !isAnalyzing} onOpenChange={setFiltersOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Choose videos to analyze</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pacing-name-filter" className="flex items-center gap-2">
                <Search className="h-3.5 w-3.5" />
                Filename
              </Label>
              <Input id="pacing-name-filter" value={draftFilters.search} onChange={(event) => setDraftFilters((value) => ({ ...value, search: event.target.value }))} placeholder="Contains…" />
            </div>
            <FilterSelect
              label="Date Added"
              icon={Calendar}
              value={draftFilters.dateRange}
              onChange={(value) => {
                setDraftFilters((filters) => ({ ...filters, dateRange: value, dateFrom: value === 'custom' ? filters.dateFrom : '', dateTo: value === 'custom' ? filters.dateTo : '' }))
                if (value === 'custom') setCustomDateRangeOpen(true)
              }}
              options={DATE_RANGE_OPTIONS}
            />
            {usesCustomDateRange && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5" />
                  Custom range
                </Label>
                <Button type="button" variant="outline" className="w-full justify-start font-normal" onClick={() => setCustomDateRangeOpen(true)}>
                  {customDateRangeLabel}
                </Button>
              </div>
            )}
            {directories.length > 0 && (
              <DirectorySelect
                directories={directories}
                selectedDirectoryId={draftFilters.directoryId}
                onChange={(directoryId) => setDraftFilters((filters) => ({ ...filters, directoryId }))}
              />
            )}
            <FilterSelect icon={FileText} label="Format" value={draftFilters.format} onChange={(value) => setDraftFilters((filters) => ({ ...filters, format: value }))} options={[['', 'Any format'], ['mp4', 'MP4'], ['mkv', 'MKV'], ['mov', 'MOV'], ['avi', 'AVI'], ['wmv', 'WMV'], ['webm', 'WEBM'], ['flv', 'FLV']]} />
            <FilterSelect icon={Monitor} label="Resolution" value={draftFilters.resolution} onChange={(value) => setDraftFilters((filters) => ({ ...filters, resolution: value }))} options={[['', 'Any resolution'], ['480p', '480p'], ['720p', '720p'], ['1080p', '1080p'], ['1440p', '1440p'], ['4k', '4K']]} />
            <FilterSelect icon={Activity} label="Processing status" value={draftFilters.status} onChange={(value) => setDraftFilters((filters) => ({ ...filters, status: value }))} options={[['', 'Any status'], ['unprocessed', 'Unprocessed'], ['processing', 'Processing'], ['done', 'Done'], ['error', 'Error']]} />
            <FilterSelect icon={ListVideo} label="Video set" value={draftFilters.splitMode} onChange={(value) => setDraftFilters((filters) => ({ ...filters, splitMode: value }))} options={[['', 'All videos'], ['split', 'Split videos']]} />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={() => setDraftFilters(EMPTY_FILTERS)}>Reset</Button>
            <Button onClick={() => { setFilters(draftFilters); setFiltersOpen(false); void loadScope(draftFilters) }}>Show files in scope</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={customDateRangeOpen && !isAnalyzing} onOpenChange={setCustomDateRangeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Custom Date Range</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pacing-date-from" className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" />
                From
              </Label>
              <Input id="pacing-date-from" type="date" value={draftFilters.dateFrom} onChange={(event) => setDraftFilters((filters) => ({ ...filters, dateFrom: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pacing-date-to" className="flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" />
                To
              </Label>
              <Input id="pacing-date-to" type="date" value={draftFilters.dateTo} onChange={(event) => setDraftFilters((filters) => ({ ...filters, dateTo: event.target.value }))} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={() => setDraftFilters((filters) => ({ ...filters, dateFrom: '', dateTo: '' }))}>Clear</Button>
            <Button onClick={() => setCustomDateRangeOpen(false)}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={repairDialogOpen} onOpenChange={setRepairDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Queue frame pacing repair</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-muted-foreground">
              Queue repair tasks for {repairSelectedCount} selected analyzed video{repairSelectedCount === 1 ? '' : 's'}.
            </div>
            <label className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
              <Checkbox checked={overwriteOriginal} onCheckedChange={(value) => setOverwriteOriginal(value === true)} />
              <span className="space-y-1">
                <span className="block font-medium">Overwrite originals</span>
                <span className="block text-xs text-muted-foreground">Replace each source video instead of creating a separate frame-pacing-repaired file.</span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepairDialogOpen(false)}>Cancel</Button>
            <Button disabled={!repairSelectedCount || isQueueing} onClick={() => void queueRepairs()}>{isQueueing ? 'Queueing...' : 'Queue repair'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FilterSelect({ label, icon: Icon, value, onChange, options }: { label: string; icon?: LucideIcon; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </Label>
      <Select value={value || '__all__'} onValueChange={(next) => onChange(next === '__all__' ? '' : next)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue || '__all__'} value={optionValue || '__all__'}>{optionLabel}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

function DirectorySelect({
  directories,
  selectedDirectoryId,
  onChange,
}: {
  directories: DirectoryRecord[]
  selectedDirectoryId: string
  onChange: (directoryId: string) => void
}) {
  const selectableDirectories = directories.filter((directory) => {
    if (directory.parent_id === null) return false
    const parent = directories.find((candidate) => candidate.id === directory.parent_id)
    return parent?.parent_id === null
  })
  const selectedDirectory = directories.find((directory) => directory.id === selectedDirectoryId)
  const selectedDirectoryLabel = selectedDirectory ? directoryDisplayName(selectedDirectory) : 'All directories'

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-2">
        <FolderOpen className="h-3.5 w-3.5" />
        Directory
      </Label>
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-start font-normal">
            {selectedDirectoryLabel}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select Directory</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-4 scrollbar">
            <div className="flex cursor-pointer items-center gap-3 rounded p-2" onClick={() => onChange('')}>
              <Checkbox
                id="pacing-dir-all"
                checked={!selectedDirectoryId}
                onClick={(event) => event.stopPropagation()}
                onCheckedChange={() => onChange('')}
              />
              <Label htmlFor="pacing-dir-all" className="flex-1 cursor-pointer">All</Label>
            </div>
            {selectableDirectories.map((directory) => (
              <div key={directory.id} className="flex cursor-pointer items-center gap-3 rounded p-2" onClick={() => onChange(directory.id)}>
                <Checkbox
                  id={`pacing-dir-${directory.id}`}
                  checked={selectedDirectoryId === directory.id}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={() => onChange(directory.id)}
                />
                <div className="min-w-0 flex-1">
                  <Label htmlFor={`pacing-dir-${directory.id}`} className="block cursor-pointer truncate text-sm">
                    {directoryDisplayName(directory)}
                  </Label>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MetricHeader({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="cursor-help text-left font-medium underline decoration-dotted underline-offset-4">
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-relaxed">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

function ProcessingProgress({ value, framesAnalyzed, message }: { value: number; framesAnalyzed: number; message?: string | null }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className="w-24 space-y-1">
      <Badge variant="outline" className="gap-1.5">
        <LoaderCircle className="h-3 w-3 animate-spin" />
        {percent}%
      </Badge>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>
      {message ? <div className="text-[10px] leading-none text-muted-foreground">{message}</div> : framesAnalyzed > 0 && <div className="text-[10px] leading-none text-muted-foreground">{framesAnalyzed.toLocaleString()} frames</div>}
    </div>
  )
}
