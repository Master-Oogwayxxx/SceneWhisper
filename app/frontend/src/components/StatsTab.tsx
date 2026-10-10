import { useCallback, useState } from 'react'
import { RefreshCw, FileVideo, CheckCircle2, Layers } from 'lucide-react'
import { useOverviewStats } from '@/hooks/useStats'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { StatCard } from '@/components/StatCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'

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
  const queryClient = useQueryClient()

  const handleRefresh = useCallback(async () => {
    setIsRefreshSpinning(true)
    try {
      await queryClient.invalidateQueries({ queryKey: ['stats', 'overview'] })
    } finally {
      window.setTimeout(() => setIsRefreshSpinning(false), 600)
    }
  }, [queryClient])

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

        {/* KPI Hero Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Files" value={coverage.total_files} icon={FileVideo} />
          <MetricCard label="Total Storage" value={formatBytes(storage.total_bytes)} />
          <StatCard label="Completed Tasks" value={processing.completed} icon={CheckCircle2} variant="success" />
          <StatCard label="Total Scenes" value={scenes.total_scenes} icon={Layers} />
        </div>

        <Separator />

        {/* Processing Section */}
        <div className="space-y-4">
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
        </div>

        <Separator />

        {/* Library Section */}
        <div className="space-y-4">
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
        </div>

        <Separator />

        {/* Content Analysis Section */}
        <div className="space-y-4">
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
        </div>
      </div>
    </div>
  )
}
