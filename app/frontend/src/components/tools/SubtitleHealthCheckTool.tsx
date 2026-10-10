import { useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, RefreshCw, Subtitles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { taskApi } from '@/api/tasks'
import { toolsApi, type SubtitleHealthItem, type SubtitleHealthResponse } from '@/api/tools'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useSettings } from '@/hooks/useSettings'
import type { Task } from '@/types/types'
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
import { formatBytes, formatDate } from './toolUtils'

interface SubtitleHealthCheckToolProps {
  onBack: () => void
}

type IssueSection = {
  key: keyof Pick<SubtitleHealthResponse, 'missingSubtitles' | 'missingSubtitleFiles' | 'emptySubtitles' | 'orphanedSubtitles'>
  title: string
  description: string
  tone: 'default' | 'warning' | 'destructive'
  deleteIssue?: SubtitleHealthItem['issue']
  taskIssue?: SubtitleHealthItem['issue']
}

const ISSUE_SECTIONS: IssueSection[] = [
  {
    key: 'missingSubtitles',
    title: 'Videos Missing Subtitles',
    description: 'Indexed videos without a linked or same-name subtitle file.',
    tone: 'warning',
    taskIssue: 'missing_subtitle',
  },
  {
    key: 'missingSubtitleFiles',
    title: 'Missing Subtitle Files',
    description: 'Subtitle records whose files are no longer on disk.',
    tone: 'destructive',
    deleteIssue: 'missing_subtitle_file',
  },
  {
    key: 'emptySubtitles',
    title: 'Empty Subtitles',
    description: 'Subtitle files with zero bytes.',
    tone: 'warning',
    deleteIssue: 'empty_subtitle',
  },
  {
    key: 'orphanedSubtitles',
    title: 'Subtitles Without Videos',
    description: 'Subtitle files with no existing video counterpart.',
    tone: 'destructive',
    deleteIssue: 'orphaned_subtitle',
  },
]

function defaultCollapsedSections() {
  return new Set(ISSUE_SECTIONS.map((section) => section.key))
}

function issueBadgeClass(tone: IssueSection['tone']) {
  if (tone === 'destructive') return 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/10'
  if (tone === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500/10'
  return ''
}

function parentDirectoryName(path: string) {
  const parts = path.replace(/[\\/]+/g, '/').split('/').filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : path
}

function isSrtSubtitleItem(item: SubtitleHealthItem) {
  return item.file.file_type === 'subtitle' && item.file.path.toLowerCase().endsWith('.srt')
}

const LANGUAGE_CODE_TO_NAME: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  pt: 'Portuguese',
  it: 'Italian',
  ru: 'Russian',
}

function IssueTable({ items }: { items: SubtitleHealthItem[] }) {
  if (!items.length) {
    return <div className="px-3 py-8 text-center text-sm text-muted-foreground">No issues found</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] border-collapse text-left text-sm">
        <thead className="border-b border-border text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">File</th>
            <th className="w-28 px-3 py-2 font-semibold">Size</th>
            <th className="w-40 px-3 py-2 font-semibold">Modified</th>
            <th className="px-3 py-2 font-semibold">Related Video</th>
            <th className="px-3 py-2 font-semibold">Issue</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.file.id} className="border-b border-border/70 last:border-0 hover:bg-secondary/40">
              <td className="min-w-0 px-3 py-2 align-top">
                <div className="truncate font-medium" title={item.file.name}>{item.file.name}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground" title={item.file.path}>{parentDirectoryName(item.file.path)}</div>
              </td>
              <td className="px-3 py-2 align-top text-muted-foreground">{formatBytes(item.file.size)}</td>
              <td className="px-3 py-2 align-top text-muted-foreground">{formatDate(item.file.modified_at)}</td>
              <td className="min-w-0 px-3 py-2 align-top">
                {item.relatedVideo ? (
                  <>
                    <div className="truncate font-medium" title={item.relatedVideo.name}>{item.relatedVideo.name}</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground" title={item.relatedVideo.path}>{parentDirectoryName(item.relatedVideo.path)}</div>
                  </>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </td>
              <td className="px-3 py-2 align-top text-muted-foreground">{item.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SubtitleHealthCheckTool({ onBack }: SubtitleHealthCheckToolProps) {
  const { settings } = useSettings()
  const [health, setHealth] = useState<SubtitleHealthResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isQueueingSubtitles, setIsQueueingSubtitles] = useState(false)
  const [deleteSection, setDeleteSection] = useState<IssueSection | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Set<IssueSection['key']>>(defaultCollapsedSections)

  const issueCount = useMemo(() => health
    ? health.missingSubtitles.length + health.missingSubtitleFiles.length + health.emptySubtitles.length + health.orphanedSubtitles.length
    : 0, [health])

  const loadHealth = async () => {
    setIsLoading(true)
    try {
      const result = await toolsApi.scanSubtitleHealth()
      setHealth(result)
      setCollapsedSections(defaultCollapsedSections())
      toast.success(`Checked ${result.totalVideos} videos and ${result.totalSubtitles} subtitles`)
    } catch {
      toast.error('Failed to scan subtitle health')
    } finally {
      setIsLoading(false)
    }
  }

  const toggleSection = (sectionKey: IssueSection['key']) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionKey)) {
        next.delete(sectionKey)
      } else {
        next.add(sectionKey)
      }
      return next
    })
  }

  const deleteSectionSrtFiles = async () => {
    if (!health || !deleteSection?.deleteIssue) return
    const srtItems = health[deleteSection.key].filter(isSrtSubtitleItem)
    if (!srtItems.length) return

    try {
      const result = await toolsApi.deleteSubtitleHealthSrtFiles(srtItems.map((item) => item.file.id), deleteSection.deleteIssue)
      toast.success(`Removed ${result.deleted} SRT file${result.deleted === 1 ? '' : 's'} from ${deleteSection.title}`)
      setDeleteSection(null)
      await loadHealth()
    } catch {
      toast.error(`Failed to remove SRT files from ${deleteSection.title}`)
    }
  }

  const deleteSectionItems = health && deleteSection ? health[deleteSection.key].filter(isSrtSubtitleItem) : []

  const queueSubtitleTasks = async (items: SubtitleHealthItem[]) => {
    const videos = items.filter((item) => item.issue === 'missing_subtitle' && item.file.file_type === 'video')
    if (!videos.length) return

    setIsQueueingSubtitles(true)
    let queued = 0
    let skipped = 0
    const subtitleLanguage = LANGUAGE_CODE_TO_NAME[settings.default_subtitle_language] ?? 'English'

    for (const item of videos) {
      const task: Task = {
        id: '',
        file: item.file,
        type: 'subtitle',
        status: 'queued',
        scene_progress: 0,
        split_progress: 0,
        subtitle_progress: 0,
        subtitleLanguage,
        createdAt: new Date(),
        overwrite_subtitles: false,
        delete_video_after_completion: false,
      }

      try {
        const result = await taskApi.addTaskVideo(task)
        if (result.duplicate || result.tasks.length === 0) {
          skipped += 1
        } else {
          queued += 1
        }
      } catch {
        skipped += 1
      }
    }

    setIsQueueingSubtitles(false)
    toast.success(`Queued ${queued} of ${videos.length} subtitle task${videos.length === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}`)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background shadow sm:rounded-lg">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={onBack} title="Back to tools" aria-label="Back to tools" className="h-8 w-8 shrink-0 sm:h-9 sm:w-9">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary sm:h-9 sm:w-9">
            <Subtitles className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Subtitle Health Check</h2>
            <p className="truncate text-xs text-muted-foreground">
              {health ? `${issueCount} issue${issueCount === 1 ? '' : 's'} from ${health.totalVideos} videos and ${health.totalSubtitles} subtitles` : 'Find missing, empty, and orphaned subtitles'}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 gap-2 lg:justify-end">
          <Button type="button" size="sm" onClick={() => void loadHealth()} disabled={isLoading} className="h-8 shrink-0 gap-2 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden />
            Analyze
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="border-b border-border bg-primary/5 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Checking subtitle health
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-primary/10">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto scrollbar p-2 sm:p-3">
        {health ? (
          <div className="space-y-3">
            {ISSUE_SECTIONS.map((section) => {
              const items = health[section.key]
              const isCollapsed = collapsedSections.has(section.key)
              const srtItems = items.filter(isSrtSubtitleItem)
              return (
                <section key={section.key} className="rounded-md border border-border bg-background shadow-sm">
                  <div className={`flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-start sm:justify-between ${isCollapsed ? '' : 'border-b border-border'}`}>
                    <button
                      type="button"
                      onClick={() => toggleSection(section.key)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-expanded={!isCollapsed}
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
                        {isCollapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{section.title}</span>
                        <span className="block text-xs text-muted-foreground">{section.description}</span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline" className={`w-fit ${issueBadgeClass(section.tone)}`}>
                        {items.length}
                      </Badge>
                      {section.taskIssue ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void queueSubtitleTasks(items)}
                          disabled={!items.length || isLoading || isQueueingSubtitles}
                          className="h-8 shrink-0 gap-2 px-2.5 text-xs"
                          title={`Create subtitle tasks for ${items.length} video${items.length === 1 ? '' : 's'}`}
                        >
                          {isQueueingSubtitles ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Subtitles className="h-4 w-4" aria-hidden />}
                          Create Tasks
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeleteSection(section)}
                        disabled={!section.deleteIssue || !srtItems.length || isLoading}
                        className="h-8 shrink-0 gap-2 px-2.5 text-xs"
                        title={section.deleteIssue ? `Remove ${srtItems.length} SRT file${srtItems.length === 1 ? '' : 's'} from ${section.title}` : 'This group has no SRT files to remove'}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        Delete SRTs
                      </Button>
                    </div>
                  </div>
                  {!isCollapsed && <IssueTable items={items} />}
                </section>
              )
            })}
          </div>
        ) : (
          <div className="px-3 py-14 text-center text-sm text-muted-foreground">Run Analyze to scan subtitle health</div>
        )}
      </div>

      <AlertDialog open={deleteSection !== null} onOpenChange={(open) => !open && setDeleteSection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete SRT files from {deleteSection?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes {deleteSectionItems.length} .srt file{deleteSectionItems.length === 1 ? '' : 's'} from this group and removes their database records. Videos and non-SRT subtitle files are skipped, and each row is rechecked before deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void deleteSectionSrtFiles()}>
              Delete SRTs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
