import { useEffect, useState } from 'react'
import { ActressDetail, MetadataScraperConfig, MetadataScraperTemplate, ScraperSource } from '@/types/types'
import { SCRAPER_METADATA_FIELDS } from '@/lib/metadata-scraper'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'

interface MetadataScraperDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: ActressDetail | null | undefined
  actressName?: string
  actressUrl: string
  onActressUrlChange: (value: string) => void
  config: MetadataScraperConfig
  onConfigChange: (config: MetadataScraperConfig) => void
  templates: MetadataScraperTemplate[]
  onSaveTemplate: (label: string, config: MetadataScraperConfig) => void
  templateOnly?: boolean
  templateLabel?: string
  selectors: Record<string, string>
  onSelectorsChange: (selectors: Record<string, string>) => void
  onSave: () => void
  schedule?: ScraperSource['schedule']
  onScheduleChange?: (schedule: ScraperSource['schedule']) => void
  scheduleActive?: boolean
  onScheduleActiveChange?: (active: boolean) => void
}

export function MetadataScraperDialog({ open, onOpenChange, detail, actressName, actressUrl, onActressUrlChange, config, onConfigChange, selectors, onSelectorsChange, templates, onSaveTemplate, onSave, schedule = { interval: 'daily', time: '03:00' }, onScheduleChange = () => undefined, scheduleActive = false, onScheduleActiveChange = () => undefined, templateOnly = false, templateLabel = '' }: MetadataScraperDialogProps) {
  const [templateNameDraft, setTemplateNameDraft] = useState(templateLabel)
  const [selectedTemplate, setSelectedTemplate] = useState('current')

  useEffect(() => {
    if (open) {
      setTemplateNameDraft(templateLabel)
      setSelectedTemplate('current')
    }
  }, [open, templateLabel])

  const effectiveTemplateLabel = templateNameDraft.trim()

  const applyTemplate = (template: MetadataScraperTemplate) => {
    onConfigChange({ ...template.config, available_fields: [...template.config.available_fields] })
    try { onSelectorsChange(JSON.parse(template.config.selectors || '{}') as Record<string, string>) } catch { onSelectorsChange({}) }
    if (!templateOnly && template.config.actress_url) {
      onActressUrlChange(template.config.actress_url.split('{actress_name}').join(encodeURIComponent(actressName ?? '')))
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{templateOnly ? 'Add metadata scraper template' : 'Run metadata scraper'}</DialogTitle>
          <DialogDescription>{templateOnly ? 'Save a reusable scraper configuration for multiple actresses.' : 'Configure and run the metadata scraper for this actress.'}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto scrollbar pr-2">
          <div className="grid gap-x-3 gap-y-5 py-2 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="scraper-template">Saved scraper template</Label>
              <div className="flex gap-2">
                <Select value={selectedTemplate} onValueChange={(value) => { setSelectedTemplate(value); const template = templates[Number(value)]; if (template) applyTemplate(template) }}>
                  <SelectTrigger id="scraper-template" className="h-9 min-w-0 flex-1 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">Start from current configuration</SelectItem>
                    {templates.map((template, index) => <SelectItem key={`${template.label}-${index}`} value={String(index)}>{template.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input value={templateNameDraft} onChange={(e) => setTemplateNameDraft(e.target.value)} placeholder="Template name" className="w-40" />
              </div>
            </div>
            {templateOnly && <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="scraper-actress-url-template">Actress page URL template</Label>
              <Input id="scraper-actress-url-template" type="url" value={config.actress_url} placeholder="https://www.example.com/model/{actress_name}" onChange={(e) => onConfigChange({ ...config, actress_url: e.target.value })} />
              <p className="text-xs text-muted-foreground">Use {'{actress_name}'} where the actress name belongs. The placeholder is replaced when you select this template for an actress.</p>
            </div>}
            {!templateOnly && detail && <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="scraper-actress-url">URL</Label>
              <Input id="scraper-actress-url" value={actressUrl} placeholder="https://www.javdatabase.com/idols/..." onChange={(e) => onActressUrlChange(e.target.value)} />
              <p className="text-xs text-muted-foreground">This URL is stored for this actress and will be used by the actress-specific scraper.</p>
            </div>}
            {!templateOnly && <div className="grid gap-3 rounded-md border border-input p-3 sm:col-span-2"><div className="flex items-center justify-between"><Label htmlFor="scraper-schedule-active">Schedule metadata scraper</Label><Switch id="scraper-schedule-active" checked={scheduleActive} onCheckedChange={onScheduleActiveChange} /></div>{scheduleActive && <><div className="grid gap-3 sm:grid-cols-3"><Select value={schedule.interval} onValueChange={(value) => onScheduleChange({ ...schedule, interval: value as ScraperSource['schedule']['interval'] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent></Select>{schedule.interval !== 'hourly' && <Input type="time" value={schedule.time ?? '03:00'} onChange={(e) => onScheduleChange({ ...schedule, time: e.target.value })} />}{schedule.interval === 'weekly' && <Input type="number" min={0} max={6} value={schedule.dayOfWeek ?? 1} onChange={(e) => onScheduleChange({ ...schedule, dayOfWeek: Number(e.target.value) })} aria-label="Day of week (0 Sunday)" />}</div><p className="text-xs text-muted-foreground">The scraper runs automatically after saving.</p></>}</div>}
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="scraper-fields">Available fields</Label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-input p-3 sm:grid-cols-3">
                {SCRAPER_METADATA_FIELDS.map((field) => (
                  <label key={field} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={config.available_fields.includes(field)} onCheckedChange={(checked) => onConfigChange({ ...config, available_fields: checked ? [...config.available_fields, field] : config.available_fields.filter((value) => value !== field) })} />
                    {field}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="scraper-selectors">CSS selectors or XPath</Label>
              {config.available_fields.length === 0 ? <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Select fields above to add selectors.</p> : <div className="grid gap-3 rounded-md border border-input p-3">
                {config.available_fields.map((field) => <div key={field} className="grid gap-1 sm:grid-cols-[150px_1fr] sm:items-center"><Label htmlFor={`selector-${field}`} className="text-xs">{field}</Label><Input id={`selector-${field}`} value={selectors[field] ?? ''} placeholder="CSS selector or XPath" onChange={(e) => onSelectorsChange({ ...selectors, [field]: e.target.value })} /></div>)}
              </div>}
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><Switch checked={config.requires_access} onCheckedChange={(checked) => onConfigChange({ ...config, requires_access: checked })} /> Site requires cookies, login, or age verification</label>
          </div>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" disabled={templateOnly && !effectiveTemplateLabel} onClick={() => { onOpenChange(false); if (templateOnly) onSaveTemplate(effectiveTemplateLabel, { ...config, selectors: JSON.stringify(selectors) }); else onSave() }}>{templateOnly ? 'Save Template' : 'Run Scraper'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
