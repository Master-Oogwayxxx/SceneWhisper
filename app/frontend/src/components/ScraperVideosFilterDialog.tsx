import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScraperVideoFilters } from '@/api/scraper'
import { Info } from 'lucide-react'
import { useEffect, useState } from 'react'

type FilterKey = Exclude<keyof ScraperVideoFilters, 'website' | 'localMatchTraits' | 'localMatchResolution'>
type FilterValue = 'any' | 'yes' | 'no'

const FILTER_CONTROLS: Array<{ key: FilterKey; label: string }> = [
  { key: 'uncensored', label: 'Uncensored' },
  { key: 'censored', label: 'Censored' },
  { key: 'subtitled', label: 'Subtitled' },
  { key: 'opened', label: 'Opened' },
  { key: 'fileExists', label: 'Local' },
]
const filterRowClass = 'grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3'
const filterLabelClass = 'text-sm font-medium text-muted-foreground'
const filterSelectTriggerClass = 'h-8 w-full text-xs'

export function activeScraperVideoFilterCount(filters: ScraperVideoFilters): number {
  const websiteCount = filters.website?.length ?? 0
  return websiteCount + [
    filters.fileExists,
    filters.uncensored,
    filters.censored,
    filters.subtitled,
    filters.opened,
  ].filter((value) => value !== null && value !== undefined).length
}

function filterToSelectValue(value: boolean | null | undefined): FilterValue {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return 'any'
}

function selectValueToFilter(value: FilterValue): boolean | null {
  if (value === 'yes') return true
  if (value === 'no') return false
  return null
}

function filterButtonClass(value: FilterValue, activeValue: FilterValue, borderClass = ''): string {
  const activeClass = value === 'any'
    ? 'bg-muted text-foreground font-medium'
    : 'bg-primary text-primary-foreground'
  const inactiveClass = value === 'any'
    ? 'hover:bg-muted'
    : 'hover:bg-muted text-muted-foreground'

  return `flex-1 py-1.5 transition-colors ${borderClass} ${activeValue === value ? activeClass : inactiveClass}`
}

function websiteDisplayLabel(websiteOptions: string[], selectedWebsites: string[] | null | undefined): string {
  if (!selectedWebsites || selectedWebsites.length === 0) return 'All'
  if (selectedWebsites.length === 1) {
    return websiteOptions.find((website) => website === selectedWebsites[0]) ?? selectedWebsites[0]
  }
  return `${selectedWebsites.length} selected`
}

interface ScraperVideosFilterDialogProps {
  open: boolean
  websiteOptions: string[]
  filters: ScraperVideoFilters
  onOpenChange: (open: boolean) => void
  onFilterChange: (filters: ScraperVideoFilters) => void
}

export function ScraperVideosFilterDialog({
  open,
  websiteOptions,
  filters,
  onOpenChange,
  onFilterChange,
}: ScraperVideosFilterDialogProps) {
  const [draftFilters, setDraftFilters] = useState<ScraperVideoFilters>(filters)

  useEffect(() => {
    if (open) {
      setDraftFilters(filters)
    }
  }, [open, filters])

  const filterCount = activeScraperVideoFilterCount(draftFilters)
  const localMatchTraits = draftFilters.localMatchTraits ?? true
  const localMatchResolution = draftFilters.localMatchResolution ?? 'any'

  const clearFilters = () => {
    setDraftFilters({})
  }

  const handleDone = () => {
    onFilterChange(draftFilters)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Filter Videos</DialogTitle>
          <DialogDescription>Choose which scraped videos to show.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className={filterRowClass}>
            <span className={filterLabelClass}>Website</span>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className={filterSelectTriggerClass}>
                  <span className="truncate">{websiteDisplayLabel(websiteOptions, draftFilters.website)}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
                <div className="max-h-64 overflow-auto scrollbar">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => setDraftFilters({ ...draftFilters, website: null })}
                  >
                    <Checkbox checked={!draftFilters.website || draftFilters.website.length === 0} />
                    <span>All</span>
                  </button>
                  {websiteOptions.map((website) => {
                    const selectedWebsites = draftFilters.website ?? []
                    const isChecked = selectedWebsites.includes(website)
                    return (
                      <button
                        key={website}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                        onClick={() => {
                          const nextWebsites = isChecked
                            ? selectedWebsites.filter((value) => value !== website)
                            : [...selectedWebsites, website]
                          setDraftFilters({
                            ...draftFilters,
                            website: nextWebsites.length > 0 ? nextWebsites : null,
                          })
                        }}
                      >
                        <Checkbox checked={isChecked} />
                        <span className="truncate">{website}</span>
                      </button>
                    )
                  })}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          {FILTER_CONTROLS.map((control) => (
            <div key={control.key} className={control.key === 'fileExists' ? 'grid gap-2 border-t border-border pt-3' : 'grid gap-2'}>
              <div className={filterRowClass}>
                <span className={filterLabelClass}>{control.label}</span>
                <div className="flex rounded-md border overflow-hidden text-xs flex-1">
                  {(['any', 'yes', 'no'] as FilterValue[]).map((value, index) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDraftFilters({
                        ...draftFilters,
                        [control.key]: selectValueToFilter(value),
                        ...(control.key === 'fileExists' && value !== 'no' ? { localMatchResolution: null } : {}),
                      })}
                      className={filterButtonClass(
                        value,
                        filterToSelectValue(draftFilters[control.key]),
                        index === 0 ? '' : 'border-l',
                      )}
                    >
                      {value === 'any' ? 'Any' : value === 'yes' ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              </div>
              {control.key === 'fileExists' && draftFilters.fileExists === false && (
                <div className="grid gap-1">
                  <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
                    <span />
                    <div className="flex h-8 items-center justify-between px-3 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                        <span>Same Variant Only</span>
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-72 text-xs leading-relaxed">
                              <p>
                                When enabled, a scraped video that is uncensored, only counts as local if the matching local file is uncensored.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Switch
                        checked={localMatchTraits}
                        onCheckedChange={(checked) => setDraftFilters({ ...draftFilters, localMatchTraits: checked })}
                        aria-label="Require local files to match the censored or uncensored variant"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
                    <span />
                    <div className="flex h-8 items-center justify-between px-3 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                        <span>Treat as Not Local</span>
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-72 text-xs leading-relaxed">
                              <p>
                                Choose a local resolution range to treat as not local. For example, selecting 720p and below makes videos with local 480p or 720p files appear under Local: No.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Select
                        value={localMatchResolution}
                        onValueChange={(value) => setDraftFilters({
                          ...draftFilters,
                          localMatchResolution: value === 'any' ? null : value,
                        })}
                      >
                        <SelectTrigger className="h-8 w-44 text-xs" aria-label="Local resolution match">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any resolution</SelectItem>
                          <SelectItem value="480p">480p and below</SelectItem>
                          <SelectItem value="720p">720p and below</SelectItem>
                          <SelectItem value="1080p">1080p</SelectItem>
                          <SelectItem value="1440p">1440p</SelectItem>
                          <SelectItem value="4k">2160p / 4K</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={clearFilters} disabled={filterCount === 0}>Reset</Button>
          <Button type="button" onClick={handleDone}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
