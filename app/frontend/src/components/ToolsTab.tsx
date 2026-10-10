import { useState } from 'react'
import { Activity, FileCode2, FileSearch, Layers3, ListChecks, Subtitles } from 'lucide-react'
import { BookmarkVideoCheckTool } from './tools/BookmarkVideoCheckTool'
import { DuplicateFinderTool } from './tools/DuplicateFinderTool'
import { VideoCodeMatcherTool } from './tools/VideoCodeMatcherTool'
import { FramePacingAnalyzerTool } from './tools/FramePacingAnalyzerTool'
import { SubtitleHealthCheckTool } from './tools/SubtitleHealthCheckTool'
import { HtmlPageVideoCheckTool } from './tools/HtmlPageVideoCheckTool'

type ActiveTool = 'bookmarks' | 'html-page-videos' | 'duplicates' | 'codes' | 'frame-pacing' | 'subtitle-health' | null

const AVAILABLE_TOOLS = [
  {
    id: 'frame-pacing' as const,
    name: 'Frame Pacing Analyzer',
    description: 'Scan indexed videos for irregular frame timestamps and queue selected repair tasks.',
    Icon: Activity,
  },
  {
    id: 'bookmarks' as const,
    name: 'Google Bookmark Video Check',
    description: 'Import a Google bookmarks export, extract video codes, and check which videos already exist locally.',
    Icon: FileSearch,
  },
  {
    id: 'html-page-videos' as const,
    name: 'HTML Page Video Check',
    description: 'Import page HTML, extract video links and title codes, and check which videos already exist locally.',
    Icon: FileCode2,
  },
  {
    id: 'subtitle-health' as const,
    name: 'Subtitle Health Check',
    description: 'Find missing, empty, and orphaned subtitles, then remove subtitles with no video counterpart.',
    Icon: Subtitles,
  },
  {
    id: 'duplicates' as const,
    name: 'Duplicate Finder',
    description: 'Group indexed videos by exact filename and surface duplicates with metadata and file paths.',
    Icon: Layers3,
  },
  {
    id: 'codes' as const,
    name: 'Video Code Matcher',
    description: 'Paste video codes and return matching local files with metadata in a table.',
    Icon: ListChecks,
  },
]

export function ToolsTab() {
  const [activeTool, setActiveTool] = useState<ActiveTool>(null)

  if (activeTool === 'bookmarks') {
    return <BookmarkVideoCheckTool onBack={() => setActiveTool(null)} />
  }

  if (activeTool === 'html-page-videos') {
    return <HtmlPageVideoCheckTool onBack={() => setActiveTool(null)} />
  }

  if (activeTool === 'duplicates') {
    return <DuplicateFinderTool onBack={() => setActiveTool(null)} />
  }

  if (activeTool === 'codes') {
    return <VideoCodeMatcherTool onBack={() => setActiveTool(null)} />
  }

  if (activeTool === 'frame-pacing') {
    return <FramePacingAnalyzerTool onBack={() => setActiveTool(null)} />
  }

  if (activeTool === 'subtitle-health') {
    return <SubtitleHealthCheckTool onBack={() => setActiveTool(null)} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background shadow sm:rounded-lg">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary sm:h-9 sm:w-9">
            <FileSearch className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Tools</h2>
            <p className="truncate text-xs text-muted-foreground">{AVAILABLE_TOOLS.length} available</p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {AVAILABLE_TOOLS.map(({ id, name, description, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTool(id)}
              className="flex min-h-32 items-center gap-3 rounded-md border border-border bg-background p-4 text-left shadow-sm transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{name}</span>
                <span className="mt-1 block text-sm leading-5 text-muted-foreground">{description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
