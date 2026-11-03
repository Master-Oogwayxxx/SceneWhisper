import { RefObject } from 'react'
import { Database, Download } from 'lucide-react'
import { MetadataScraperProgress } from '@/lib/metadata-scraper'
import { useSettings } from '@/hooks/useSettings'
import { R18AutoRefreshSection } from './ActressScheduleEditor'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Progress } from './ui/progress'

interface ActressImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileInputRef: RefObject<HTMLInputElement>
  importing: boolean
  onImportLatest: () => void
  metadataScraperProgress: MetadataScraperProgress | null
  settings: ReturnType<typeof useSettings>['settings']
  onPatchSettings: (updates: Parameters<React.ComponentProps<typeof R18AutoRefreshSection>['onPatch']>[0]) => void
}

export function ActressImportDialog({ open, onOpenChange, fileInputRef, importing, onImportLatest, metadataScraperProgress, settings, onPatchSettings }: ActressImportDialogProps) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md">
    <DialogHeader><DialogTitle>Load r18.dev dump</DialogTitle><DialogDescription>Choose whether to import a local dump file or download the latest dump from r18.dev.</DialogDescription></DialogHeader>
    <div className="grid gap-3 pt-2 sm:grid-cols-2">
      <button type="button" className="group flex min-w-0 flex-col items-start gap-2 rounded-md border border-input bg-background px-4 py-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50" disabled={importing} onClick={() => fileInputRef.current?.click()}>
        <span className="flex min-w-0 items-center gap-2 font-medium"><Database className="h-4 w-4" />Import local dump</span>
        <span className="min-w-0 whitespace-normal break-words text-sm font-normal text-muted-foreground group-hover:text-accent-foreground">Pick a `.sql.gz` dump file from disk and import it into SceneWhisper.</span>
      </button>
      <button type="button" className="group flex min-w-0 flex-col items-start gap-2 rounded-md border border-input bg-background px-4 py-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50" disabled={importing} onClick={onImportLatest}>
        <span className="flex min-w-0 items-center gap-2 font-medium"><Download className="h-4 w-4" />Download latest dump</span>
        <span className="min-w-0 whitespace-normal break-words text-sm font-normal text-muted-foreground group-hover:text-accent-foreground">Fetch the current dump from `r18.dev` and start the import automatically.</span>
      </button>
    </div>
    {metadataScraperProgress && <div className="space-y-2 rounded-md border border-border bg-card px-3 py-2 text-sm"><div className="flex items-center justify-between gap-3"><span className="truncate">Scraping metadata{metadataScraperProgress.currentUrl ? `: ${metadataScraperProgress.currentUrl}` : ''}</span><span className="shrink-0 text-muted-foreground">{metadataScraperProgress.pagesScraped} / {metadataScraperProgress.totalPages || '?'} pages</span></div><Progress value={metadataScraperProgress.totalPages ? metadataScraperProgress.progress : undefined} className="h-2" aria-label="Metadata scraper progress" /></div>}
    <R18AutoRefreshSection settings={settings} onPatch={onPatchSettings} />
  </DialogContent></Dialog>
}
