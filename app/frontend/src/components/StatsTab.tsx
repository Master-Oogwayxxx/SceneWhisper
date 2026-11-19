import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { RefreshCw, FileVideo, CheckCircle2, Layers } from 'lucide-react'
import { useOverviewStats } from '@/hooks/useStats'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { StatCard } from '@/components/StatCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 10) / 10 + ' ' + sizes[i]
}

function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${Math.round(secs)}s`
  return `${Math.round(secs)}s`
}

function formatBitrate(mbps: number | null | undefined): string {
  if (mbps === null || mbps === undefined) return '—'
  return `${mbps.toFixed(mbps >= 10 ? 1 : 2)} Mbps`
}

function MetricCard({ label, value, className = '' }: { label: string; value: string | number; className?: string }) {
  return (
    <div className={cn('p-4 rounded-lg border border-border bg-card', className)}>
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
    </div>
  )
}

function DistributionBar({
  label,
  value,
  total,
  className = '',
}: {
  label: string
  value: number
  total: number
  className?: string
}) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className={className}>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899']
const HISTORY_KEY = 'scene-whisper-stats-history'
type HistoryPoint = { date: string; files: number; storage: number; completed: number; failed: number; queued: number }

function ChartCard({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <h3 className="mb-4 text-xs font-semibold tracking-wide text-muted-foreground">{title}</h3>
      <div className="h-64">{children}</div>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="flex-1 overflow-auto scrollbar">
      <div className="p-6 space-y-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-24" />
        </div>

        {/* KPI Hero Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>

        {/* Processing Section */}
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>

        {/* Library Section */}
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-48" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-8 w-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>

        {/* Content Analysis Section */}
        <div className="space-y-4">
          <Skeleton className="h-6 w-32" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  )
}

export function StatsTab() {
  const { data, isLoading, isFetching, error } = useOverviewStats()
  const [isRefreshSpinning, setIsRefreshSpinning] = useState(false)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const queryClient = useQueryClient()

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as HistoryPoint[]
      setHistory(saved.filter((point) => Date.now() - new Date(point.date).getTime() <= 90 * 86400000))
    } catch {
      setHistory([])
    }
  }, [])

  useEffect(() => {
    if (!data) return
    const today = new Date().toISOString().slice(0, 10)
    const point: HistoryPoint = {
      date: today,
      files: data.coverage.total_files,
      storage: data.storage.total_bytes,
      completed: data.processing.completed,
      failed: data.processing.failed,
      queued: data.processing.queued,
    }
    setHistory((current) => {
      const next = [...current.filter((item) => item.date !== today), point].slice(-90)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }, [data])

  const handleRefresh = useCallback(async () => {
    setIsRefreshSpinning(true)
    try {
      await queryClient.invalidateQueries({ queryKey: ['stats', 'overview'] })
    } finally {
      window.setTimeout(() => setIsRefreshSpinning(false), 600)
    }
  }, [queryClient])

  const historyChartData = useMemo(() => {
    if (history.length < 2) return history
    const first = history[0]
    const last = history[history.length - 1]
    const days = Math.max(1, (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86400000)
    return [...history, {
      date: '30d forecast',
      files: Math.max(0, Math.round(last.files + ((last.files - first.files) / days) * 30)),
      storage: Math.max(0, Math.round(last.storage + ((last.storage - first.storage) / days) * 30)),
      completed: last.completed,
      failed: last.failed,
      queued: last.queued,
    }]
  }, [history])

  if (isLoading) return <LoadingSkeleton />

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 p-4">
        <div className="text-destructive text-lg font-semibold">Failed to load statistics. Please try again.</div>
        <Button onClick={handleRefresh} variant="outline">
          Retry
        </Button>
      </div>
    )
  }

  if (!data) return null

  const { processing, coverage, storage, scenes, directories } = data
  const statusData = [
    { name: 'Queued', value: processing.queued },
    { name: 'Processing', value: processing.processing },
    { name: 'Completed', value: processing.completed },
    { name: 'Failed', value: processing.failed },
    { name: 'Cancelled', value: processing.cancelled },
  ].filter((item) => item.value > 0)
  const taskTypeData = Object.entries(processing.by_type)
    .filter(([, value]) => (value ?? 0) > 0)
    .map(([name, value]) => ({ name: name.replace(/_/g, ' '), value: value ?? 0 }))
  const formatData = Object.entries(storage.by_format)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value]) => ({ name: name.toUpperCase(), value }))
  const codecData = Object.entries(storage.by_codec)
    .sort(([, a], [, b]) => b - a)
    .map(([name, value]) => ({ name: name.toUpperCase(), value }))
  const resolutionData = [
    { name: '4K', value: storage.res_4k },
    { name: '1080p', value: storage.res_1080p },
    { name: '720p', value: storage.res_720p },
    { name: 'SD', value: storage.res_sd },
  ]
  const directoryData = directories.top_directories.map((dir) => ({ name: dir.name, files: dir.file_count }))

  return (
    <div className="flex-1 overflow-auto scrollbar">
      <div className="p-6 space-y-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Statistics</h1>
          <Button type="button" size="icon" variant="ghost" onClick={() => void handleRefresh()} title="Refresh" aria-label="Refresh statistics">
            <RefreshCw className={`h-4 w-4 ${isRefreshSpinning || isLoading || isFetching ? 'animate-spin' : ''}`} aria-hidden />
          </Button>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="processing">Processing</TabsTrigger>
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="content">Content</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 space-y-4">
            {/* KPI Hero Row */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total Files" value={coverage.total_files} icon={FileVideo} />
              <MetricCard label="Total Storage" value={formatBytes(storage.total_bytes)} />
              <StatCard label="Completed Tasks" value={processing.completed} icon={CheckCircle2} variant="success" />
              <StatCard label="Total Scenes" value={scenes.total_scenes} icon={Layers} />
            </div>
            <h2 className="font-semibold uppercase tracking-wide text-muted-foreground">Overview</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="PROCESSING STATUS">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2}>
                    {statusData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="TASK TYPES">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={taskTypeData} margin={{ left: 8, right: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} tickFormatter={(value) => value.slice(0, 10)} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" name="Tasks" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="LIBRARY COVERAGE">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[{ name: 'Scenes', value: coverage.with_scenes }, { name: 'Split', value: coverage.with_split }, { name: 'Subtitles', value: coverage.with_subtitle }]} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" name="Files" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="RESOLUTION DISTRIBUTION">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={resolutionData} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" name="Files" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="FILE FORMATS">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={formatData} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="75%">
                    {formatData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="CODECS">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={codecData} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="75%">
                    {codecData.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="TOP DIRECTORIES" className="lg:col-span-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={directoryData} layout="vertical" margin={{ left: 24, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="files" name="Files" fill="#a855f7" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
          </TabsContent>

        {/* Processing Section */}
        <TabsContent value="processing" className="mt-0 space-y-4">
          <h2 className="font-semibold text-muted-foreground uppercase tracking-wide">Processing</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <MetricCard label="Total" value={processing.total} />
            <MetricCard label="Queued" value={processing.queued} />
            <MetricCard label="Processing" value={processing.processing} className="bg-primary/10 border-primary/20" />
            <MetricCard label="Completed" value={processing.completed} className="bg-success/10 border-success/20" />
            <MetricCard label="Failed" value={processing.failed} className="bg-destructive/10 border-destructive/20" />
            <MetricCard label="Cancelled" value={processing.cancelled} />
          </div>

          {/* By Type */}
          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">BY TASK TYPE</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Scene" value={processing.by_type.scene} />
              <MetricCard label="Split" value={processing.by_type.split} />
              <MetricCard label="Subtitle" value={processing.by_type.subtitle} />
              <MetricCard label="All" value={processing.by_type.all} />
              <MetricCard label="Remux" value={processing.by_type.remux ?? 0} />
            </div>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
            <MetricCard label="Success Rate" value={`${processing.success_rate.toFixed(1)}%`} />
            <MetricCard label="Error Rate" value={`${processing.error_rate.toFixed(1)}%`} />
            <MetricCard label="Avg Processing Time" value={formatSeconds(processing.avg_elapsed_seconds)} />
            <MetricCard label="Fastest Task" value={formatSeconds(processing.min_elapsed_seconds)} />
            <MetricCard label="Slowest Task" value={formatSeconds(processing.max_elapsed_seconds)} />
            <div className="space-y-2">
              <MetricCard label="Scenes Generated" value={processing.total_scenes_generated} />
              <MetricCard label="Splits Generated" value={processing.total_splits_generated} />
            </div>
          </div>
        </TabsContent>

        {/* Library Section */}
        <TabsContent value="library" className="mt-0 space-y-4">
          <h2 className="font-semibold text-muted-foreground uppercase tracking-wide">Library</h2>

          {/* Coverage */}
          <div className="space-y-3 bg-muted/30 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">FILE COVERAGE</h3>
            <DistributionBar label="With Scenes" value={coverage.with_scenes} total={coverage.total_files} />
            <DistributionBar label="With Split Files" value={coverage.with_split} total={coverage.total_files} />
            <DistributionBar label="With Subtitles" value={coverage.with_subtitle} total={coverage.total_files} />
          </div>

          {/* Format Distribution */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">FORMAT DISTRIBUTION</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(storage.by_format)
                .sort(([, a], [, b]) => b - a)
                .map(([format, count]) => (
                  <MetricCard key={format} label={format} value={count} />
                ))}
            </div>
          </div>

          {/* Codec Distribution */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">CODEC DISTRIBUTION</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(storage.by_codec)
                .sort(([, a], [, b]) => b - a)
                .map(([codec, count]) => (
                  <MetricCard key={codec} label={codec} value={count} />
                ))}
            </div>
          </div>

          {/* Resolution Buckets */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="4K" value={storage.res_4k} icon={FileVideo} />
            <StatCard label="1080p" value={storage.res_1080p} icon={FileVideo} />
            <StatCard label="720p" value={storage.res_720p} icon={FileVideo} />
            <StatCard label="SD" value={storage.res_sd} icon={FileVideo} />
          </div>

          {/* Storage Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <MetricCard label="Total Storage" value={formatBytes(storage.total_bytes)} />
            <MetricCard label="Average File Size" value={formatBytes(storage.avg_bytes)} />
            <MetricCard label="Largest File" value={formatBytes(storage.max_bytes)} />
          </div>

          {/* Video Stats */}
          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-semibold text-muted-foreground mb-2">VIDEO STATS</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Total Runtime" value={formatSeconds(storage.total_duration_seconds)} />
              <MetricCard label="Average Duration" value={formatSeconds(storage.avg_duration_seconds)} />
              <MetricCard label="Shortest Video" value={formatSeconds(storage.min_duration_seconds)} />
              <MetricCard label="Longest Video" value={formatSeconds(storage.max_duration_seconds)} />
              <MetricCard label="Average Bitrate" value={formatBitrate(storage.avg_bitrate_mbps)} />
              <MetricCard label="Video Files" value={storage.video_files} />
              <MetricCard label="Known Durations" value={`${storage.known_duration_files}/${storage.video_files}`} />
              <MetricCard label="Missing Durations" value={storage.missing_duration_files} />
              <MetricCard
                label="Zero-Byte Files"
                value={storage.zero_byte_files}
                className={storage.zero_byte_files > 0 ? 'bg-destructive/10 border-destructive/20' : ''}
              />
            </div>
          </div>
        </TabsContent>

        {/* Content Analysis Section */}
        <TabsContent value="content" className="mt-0 space-y-4">
          <h2 className="font-semibold text-muted-foreground uppercase tracking-wide">Content Analysis</h2>

          {/* Scene Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <StatCard label="Total Scenes" value={scenes.total_scenes} icon={Layers} />
            <MetricCard label="Avg Scenes/File" value={scenes.avg_scenes_per_file.toFixed(1)} />
            <MetricCard label="Avg Scene Duration" value={formatSeconds(scenes.avg_scene_duration_seconds)} />
            <MetricCard label="Shortest Scene" value={formatSeconds(scenes.min_scene_duration_seconds)} />
            <MetricCard label="Longest Scene" value={formatSeconds(scenes.max_scene_duration_seconds)} />
          </div>

          {/* Directories */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-3">TOP DIRECTORIES</h3>
            {directories.top_directories.length > 0 ? (
              <div className="space-y-2">
                {directories.top_directories.map((dir, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{dir.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{dir.path}</div>
                    </div>
                    <div className="font-semibold ml-2">{dir.file_count} files</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground text-sm">No directories</div>
            )}
          </div>

          {/* Monitor Summary */}
          <div className="pt-2 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <StatCard label="Monitored Directories" value={directories.total_directories} icon={FileVideo} />
              <StatCard label="Active Monitors" value={directories.active_monitors} icon={Layers} variant="primary" />
            </div>

            {Object.keys(directories.monitors_by_schedule).length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground mb-2">MONITOR SCHEDULE</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {Object.entries(directories.monitors_by_schedule).map(([schedule, count]) => (
                    <MetricCard key={schedule} label={schedule} value={count} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="history" className="mt-0 space-y-4">
          <div>
            <h2 className="font-semibold uppercase tracking-wide text-muted-foreground">History & Projections</h2>
            <p className="mt-1 text-sm text-muted-foreground">Daily snapshots are retained locally for 90 days. Forecasts extrapolate the observed trend over the next 30 days.</p>
          </div>
          {history.length < 2 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Collecting history. Return tomorrow to see trend and projection charts.</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ChartCard title="FILE COUNT (30-DAY FORECAST)">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip /><Legend />
                    <Line type="monotone" dataKey="files" name="Files" stroke="#6366f1" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="STORAGE (30-DAY FORECAST)">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(value) => formatBytes(value)} width={72} />
                    <Tooltip formatter={(value) => formatBytes(Number(value))} /><Legend />
                    <Line type="monotone" dataKey="storage" name="Storage" stroke="#22c55e" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard title="TASK THROUGHPUT">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip /><Legend />
                    <Line type="monotone" dataKey="completed" name="Completed" stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="queued" name="Queued" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}
        </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
