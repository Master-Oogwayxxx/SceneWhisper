import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Play } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScraperSource } from '@/types/types'

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function urlsForScraperSource(source: ScraperSource): string[] {
  return Array.from(new Set((source.urls?.length ? source.urls : [source.url]).map((url) => url.trim()).filter(Boolean)))
}

type ScraperRunDialogProps = {
  source: ScraperSource | null
  isRunning: boolean
  onOpenChange: (open: boolean) => void
  onRun: (source: ScraperSource, urls: string[]) => void
}

export function ScraperRunDialog({ source, isRunning, onOpenChange, onRun }: ScraperRunDialogProps) {
  const urls = useMemo(() => (source ? urlsForScraperSource(source) : []), [source])
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(() => new Set(urls))
  const selectedHosts = useMemo(
    () => Array.from(new Set(urls.filter((url) => selectedUrls.has(url)).map((url) => hostnameFromUrl(url)).filter(Boolean))),
    [selectedUrls, urls],
  )
  const selectedCount = selectedUrls.size

  useEffect(() => {
    setSelectedUrls(new Set(urls))
  }, [urls])

  const allSelected = urls.length > 0 && selectedUrls.size === urls.length

  const toggleUrl = (url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev)
      if (next.has(url)) {
        next.delete(url)
      } else {
        next.add(url)
      }
      return next
    })
  }

  const handleRun = () => {
    if (!source) return
    const urlsToRun = urls.filter((url) => selectedUrls.has(url))
    onRun(source, urlsToRun)
    onOpenChange(false)
  }

  return (
    <Dialog open={source !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run Scraper</DialogTitle>
          <DialogDescription>Choose which scraper websites to run for {source?.name}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Websites</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setSelectedUrls(allSelected ? new Set() : new Set(urls))}
            >
              {allSelected ? 'Clear' : 'Select All'}
            </Button>
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Run details</div>
            <div className="mt-1">
              {source?.name
                ? `${source.name} will run against ${selectedCount} website${selectedCount === 1 ? '' : 's'}.`
                : 'Choose a scraper source to see run details.'}
            </div>
            <div className="mt-1">
              {selectedHosts.length > 0
                ? `Selected websites: ${selectedHosts.join(', ')}`
                : 'No websites selected yet.'}
            </div>
            <div className="mt-1">
              The run will finish with the saved totals and the completion notification will include created, updated, and found counts.
            </div>
          </div>
          <div className="max-h-[95vh] space-y-2 overflow-y-auto scrollbar rounded-md border border-border p-2">
            {urls.map((url, index) => {
              const checkboxId = `scraper-run-url-${index}`
              return (
                <div key={url} className="flex items-start gap-2 rounded-sm px-1 py-1.5">
                  <Checkbox
                    id={checkboxId}
                    checked={selectedUrls.has(url)}
                    onCheckedChange={() => toggleUrl(url)}
                  />
                  <Label htmlFor={checkboxId} className="grid min-w-0 cursor-pointer gap-0.5 text-sm leading-none">
                    <span>{hostnameFromUrl(url)}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">{url}</span>
                  </Label>
                </div>
              )
            })}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleRun} disabled={isRunning || selectedUrls.size === 0}>
            {isRunning ? <LoaderCircle className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
