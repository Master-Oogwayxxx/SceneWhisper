import { Activity, Calendar, Download, FileVideo, Filter, Tag } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { ActressWorksFilterState, ActressWorkLocalFileStatusFilter, ActressWorkResolutionFilter, ActressWorkTorrentStatusFilter } from '@/lib/actress-works-filters'

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 15 }, (_, i) => CURRENT_YEAR - i)
const TORRENT_STATUS_OPTIONS: { value: ActressWorkTorrentStatusFilter; label: string }[] = [
  { value: 'queued', label: 'Queued' },
  { value: 'downloading', label: 'Downloading' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
]
const LOCAL_FILE_STATUS_OPTIONS: { value: ActressWorkLocalFileStatusFilter; label: string }[] = [
  { value: 'present', label: 'Found' },
  { value: 'deleted', label: 'Deleted' },
  { value: 'missing', label: 'Missing' },
]
const RESOLUTION_OPTIONS: { value: ActressWorkResolutionFilter; label: string }[] = [
  { value: 'sd', label: 'SD' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '1440p', label: '1440p' },
  { value: '4k', label: '4K' },
]

interface Props {
  isFilterActive: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: ActressWorksFilterState
  onDraftChange: (patch: Partial<ActressWorksFilterState>) => void
  onApply: () => void
  onReset: () => void
  openedSiteOptions: string[]
}

function TriStateControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean | null
  onChange: (v: boolean | null) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="flex flex-1 overflow-hidden rounded-md border text-xs">
        {([
          { label: 'Yes', value: true },
          { label: 'Any', value: null },
          { label: 'No', value: false },
        ] as const).map((option, index) => (
          <button
            key={option.label}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 py-1.5 transition-colors ${index === 1 ? 'border-x' : ''} ${value === option.value
              ? option.value === null
                ? 'bg-muted font-medium text-foreground'
                : 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted'
              }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ActressWorksFilterDialog({
  isFilterActive,
  open,
  onOpenChange,
  draft,
  onDraftChange,
  onApply,
  onReset,
  openedSiteOptions,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="relative shrink-0">
        <DialogTrigger asChild>
          <Button
            variant={isFilterActive ? 'default' : 'outline'}
            className="h-8 gap-1 px-2 text-xs sm:h-10 sm:gap-1.5 sm:px-3 sm:text-sm"
            aria-label="Filter works"
          >
            <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">Filter</span>
          </Button>
        </DialogTrigger>
        {isFilterActive && (
          <button
            type="button"
            aria-label="Clear work filters"
            className="absolute -right-[7.5px] top-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-background bg-primary-foreground text-sm leading-none text-primary shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:-right-1.5 sm:top-0"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onReset()
            }}
          >
            ×
          </button>
        )}
      </div>
      <DialogContent className="max-h-[95vh] max-w-md overflow-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Filter Works</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar pr-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2 pl-0.5">
              <Label className="flex items-center gap-2 text-sm font-medium"><FileVideo className="h-3.5 w-3.5" />Local file</Label>
              <Select
                value={draft.localFileStatus ?? (draft.fileExists === null ? 'all' : draft.fileExists ? 'present' : 'missing')}
                onValueChange={(v) => onDraftChange({
                  localFileStatus: v === 'all' ? null : v as ActressWorkLocalFileStatusFilter,
                  fileExists: null,
                })}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {LOCAL_FILE_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-2 text-sm font-medium"><Activity className="h-3.5 w-3.5" />Resolution</Label>
              <Select
                value={draft.resolution ?? 'all'}
                onValueChange={(v) => onDraftChange({ resolution: v === 'all' ? null : v as ActressWorkResolutionFilter })}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All resolutions</SelectItem>
                  {RESOLUTION_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2 pl-0.5">
              <Label className="flex items-center gap-2 text-sm font-medium"><Calendar className="h-3.5 w-3.5" />Release year</Label>
              <Select
                value={draft.releaseYear === null ? 'all' : String(draft.releaseYear)}
                onValueChange={(v) => onDraftChange({ releaseYear: v === 'all' ? null : Number(v) })}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All years</SelectItem>
                  {YEAR_OPTIONS.map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-2 text-sm font-medium"><Download className="h-3.5 w-3.5" />Torrent status</Label>
              <Select
                value={draft.torrentStatus ?? 'all'}
                onValueChange={(v) => onDraftChange({ torrentStatus: v === 'all' ? null : v as ActressWorkTorrentStatusFilter })}
              >
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {TORRENT_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-3 border-t pt-4">
              <Label className="flex items-center gap-2 text-sm font-medium"><Tag className="h-3.5 w-3.5" />Badges</Label>
              <div className="flex flex-col gap-2">
                <TriStateControl label="Uncensored" value={draft.uncensored} onChange={(v) => onDraftChange({ uncensored: v })} />
                <TriStateControl label="Censored" value={draft.censored} onChange={(v) => onDraftChange({ censored: v })} />
                <TriStateControl label="Subtitled" value={draft.subtitled} onChange={(v) => onDraftChange({ subtitled: v })} />
                <TriStateControl label="Opened" value={draft.opened} onChange={(v) => onDraftChange({ opened: v })} />
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">Site</span>
                  <Select value={draft.openedSite ?? 'all'} onValueChange={(v) => onDraftChange({ openedSite: v === 'all' ? null : v })}>
                    <SelectTrigger className="h-9 flex-1 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sites</SelectItem>
                      {openedSiteOptions.map((site) => <SelectItem key={site} value={site}>{site}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between border-t pt-4">
          <Button variant="outline" size="sm" onClick={onReset}>
            Reset
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" className="bg-primary hover:bg-primary/90" onClick={() => { onApply(); onOpenChange(false) }}>
              Apply Filters
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
