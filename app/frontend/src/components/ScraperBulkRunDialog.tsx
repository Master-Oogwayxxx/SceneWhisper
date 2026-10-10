import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Play } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScraperSource } from '@/types/types'
import { urlsForScraperSource } from '@/components/ScraperRunDialog'

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

type ScraperBulkRunDialogProps = {
  open: boolean
  sources: ScraperSource[]
  isRunning: boolean
  onOpenChange: (open: boolean) => void
  onRun: (selectedUrls: string[]) => void
}

export function ScraperBulkRunDialog({ open, sources, isRunning, onOpenChange, onRun }: ScraperBulkRunDialogProps) {
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(() => new Set())
  const urlEntries = useMemo(() => {
    const seen = new Map<string, { url: string; label: string }>()
    for (const source of sources) {
      for (const url of urlsForScraperSource(source)) {
        const normalizedUrl = url.trim()
        const label = hostnameFromUrl(normalizedUrl)
        if (!seen.has(label)) {
          seen.set(label, { url: normalizedUrl, label })
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  }, [sources])

  useEffect(() => {
    setSelectedUrls(new Set(urlEntries.map((entry) => entry.url)))
  }, [urlEntries])

  const selectedCount = selectedUrls.size
  const allSelected = urlEntries.length > 0 && selectedUrls.size === urlEntries.length

  const toggleAll = () => {
    setSelectedUrls(allSelected ? new Set() : new Set(urlEntries.map((entry) => entry.url)))
  }

  const handleRun = () => {
    onRun(Array.from(selectedUrls))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Run Selected Scrapers</DialogTitle>
          <DialogDescription>Choose which scraper websites to run across all selected cards.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Scrapers</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={toggleAll}
            >
              {allSelected ? 'Clear All' : 'Select All'}
            </Button>
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Run details</div>
            <div className="mt-1">
              {sources.length > 0
                ? `${sources.length} selected scraper card${sources.length === 1 ? '' : 's'} will run ${selectedCount} scraper${selectedCount === 1 ? '' : 's'}.`
                : 'No scraper cards selected.'}
            </div>
          </div>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto scrollbar rounded-md border border-border p-2">
            {urlEntries.map((entry, index) => {
              const checkboxId = `scraper-bulk-run-${index}`
              return (
                <div key={entry.url} className="flex items-start gap-2 rounded-sm px-1 py-1.5">
                  <Checkbox
                    id={checkboxId}
                    checked={selectedUrls.has(entry.url)}
                    onCheckedChange={() => {
                      setSelectedUrls((prev) => {
                        const next = new Set(prev)
                        if (next.has(entry.url)) {
                          next.delete(entry.url)
                        } else {
                          next.add(entry.url)
                        }
                        return next
                      })
                    }}
                  />
                  <Label htmlFor={checkboxId} className="grid min-w-0 cursor-pointer gap-0.5 text-sm leading-none">
                    <span>{entry.label}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{entry.url}</span>
                  </Label>
                </div>
              )
            })}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleRun} disabled={isRunning || selectedCount === 0}>
            {isRunning ? <LoaderCircle className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run Selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
