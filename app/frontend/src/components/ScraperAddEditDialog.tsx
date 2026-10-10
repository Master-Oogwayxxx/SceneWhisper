import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ArrowLeftRight, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScraperSource, ScraperTemplate } from '@/types/types'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function createId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createBlankScraperSource(): ScraperSource {
  return {
    id: createId(),
    name: '',
    url: '',
    urls: [],
    urlActressNameReversed: [],
    schedule: { interval: 'daily', time: '09:00', dayOfWeek: 1 },
    isActive: true,
    lastFound: 0,
    lastNew: 0,
    lastPagesScraped: 0,
    createdAt: new Date(),
  }
}

function browserTimeZone(): string | undefined {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function buildScraperTemplateUrl(urlTemplate: string, actressName: string): string {
  return urlTemplate.split('{actress_name}').join(encodeURIComponent(actressName))
}

function flipActressNameOrder(actressName: string, reverseOrder: boolean): string {
  const parts = actressName
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase())
  if (reverseOrder) {
    parts.reverse()
  }
  return parts.join('-')
}

function toggleActressNameOrder(actressName: string): string {
  const parts = actressName
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase())
  return parts.reverse().join('-')
}

function actressNameFromTemplateUrl(urlTemplate: string, url: string): string | null {
  const [prefix, suffix = ''] = urlTemplate.split('{actress_name}')
  if (!url.startsWith(prefix) || (suffix && !url.endsWith(suffix))) return null
  const encodedName = url.slice(prefix.length, suffix ? -suffix.length : undefined)
  try {
    return decodeURIComponent(encodedName)
  } catch {
    return encodedName
  }
}

function urlsForScraperSource(source: ScraperSource): string[] {
  return Array.from(new Set((source.urls?.length ? source.urls : [source.url]).map((url) => url.trim()).filter(Boolean)))
}

function reversedFlagsForScraperSource(source: ScraperSource, urlCount: number): boolean[] {
  const flags = (source.urlActressNameReversed ?? []).slice(0, urlCount)
  if (flags.length < urlCount) {
    flags.push(...Array(urlCount - flags.length).fill(false))
  }
  return flags
}

interface ScraperAddEditDialogProps {
  open: boolean
  editingSource: ScraperSource | null
  validScraperTemplates: ScraperTemplate[]
  singleWebsiteMode?: boolean
  initialActressName?: string | null
  isSaving: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (source: ScraperSource) => void
  onUpdate: (source: ScraperSource) => void
}

export function ScraperAddEditDialog({
  open,
  editingSource,
  validScraperTemplates,
  singleWebsiteMode = false,
  initialActressName = null,
  isSaving,
  onOpenChange,
  onCreate,
  onUpdate,
}: ScraperAddEditDialogProps) {
  const [draft, setDraft] = useState<ScraperSource>(createBlankScraperSource)
  const [scraperEntryMode, setScraperEntryMode] = useState<'manual' | 'template'>('template')
  const [selectedTemplateIndexes, setSelectedTemplateIndexes] = useState<Set<number>>(() => new Set())
  const [templateActressName, setTemplateActressName] = useState('')
  const [templateActressNamesByIndex, setTemplateActressNamesByIndex] = useState<Record<number, string>>({})
  const [templateActressNameReversedByIndex, setTemplateActressNameReversedByIndex] = useState<Record<number, boolean>>({})
  const initializedDraftKeyRef = useRef<string | null>(null)
  const initializedTemplateKeyRef = useRef<string | null>(null)

  const editingSourceId = editingSource?.id ?? null
  const editingSourceKey = editingSource
    ? `${editingSource.id}:${singleWebsiteMode ? urlsForScraperSource(editingSource).join('|') : '*'}`
    : null

  useEffect(() => {
    if (!open) return
    const draftKey = editingSourceKey ?? 'new'
    if (initializedDraftKeyRef.current === draftKey) return
    initializedDraftKeyRef.current = draftKey
    setDraft(editingSource ? { ...editingSource, schedule: { ...editingSource.schedule } } : createBlankScraperSource())
  }, [editingSource, editingSourceKey, open])

  useEffect(() => {
    if (!open || editingSourceId || !initialActressName?.trim()) return
    const actressName = initialActressName.trim()
    setTemplateActressName(actressName)
    setTemplateActressNamesByIndex(() => {
      const next: Record<number, string> = {}
      validScraperTemplates.forEach((_template, index) => {
        next[index] = flipActressNameOrder(actressName, templateActressNameReversedByIndex[index] ?? false)
      })
      return next
    })
  }, [editingSourceId, initialActressName, open, templateActressNameReversedByIndex, validScraperTemplates])

  useEffect(() => {
    if (!open || !editingSourceId || !editingSource) return
    const templateKey = editingSourceKey ?? editingSourceId
    if (initializedTemplateKeyRef.current === templateKey) return
    initializedTemplateKeyRef.current = templateKey
    const sourceUrls = urlsForScraperSource(editingSource)
    const sourceReversedFlags = reversedFlagsForScraperSource(editingSource, sourceUrls.length)
    const nextSelectedIndexes = new Set<number>()
    const nextActressNamesByIndex: Record<number, string> = {}
    const nextReversedByIndex: Record<number, boolean> = {}

    sourceUrls.forEach((url, sourceIndex) => {
      const templateIndex = validScraperTemplates.findIndex((template) => (
        actressNameFromTemplateUrl(template.url_template.trim(), url) !== null
      ))
      if (templateIndex === -1) return
      const actressName = actressNameFromTemplateUrl(validScraperTemplates[templateIndex].url_template.trim(), url)
      nextSelectedIndexes.add(templateIndex)
      nextReversedByIndex[templateIndex] = sourceReversedFlags[sourceIndex] ?? false
      if (actressName) {
        nextActressNamesByIndex[templateIndex] = actressName
      }
    })

    setSelectedTemplateIndexes(nextSelectedIndexes)
    setTemplateActressNamesByIndex(nextActressNamesByIndex)
    setTemplateActressNameReversedByIndex(nextReversedByIndex)
    setTemplateActressName(Object.values(nextActressNamesByIndex)[0] ?? '')
  }, [editingSource, editingSourceId, editingSourceKey, open, validScraperTemplates])

  useEffect(() => {
    setSelectedTemplateIndexes((prev) => {
      if (editingSourceId) return prev
      const validIndexes = validScraperTemplates.map((_template, index) => index)
      const next = new Set([...prev].filter((index) => validIndexes.includes(index)))
      if (next.size === 0 && validIndexes.length > 0) {
        validIndexes.forEach((index) => next.add(index))
      }
      return next.size === prev.size && [...next].every((index) => prev.has(index)) ? prev : next
    })
  }, [editingSourceId, validScraperTemplates])

  useEffect(() => {
    setTemplateActressNamesByIndex((prev) => {
      const validIndexes = new Set(validScraperTemplates.map((_template, index) => index))
      const next = Object.fromEntries(
        Object.entries(prev)
          .map(([index, value]) => [Number(index), value] as const)
          .filter(([index]) => validIndexes.has(index)),
      )
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [validScraperTemplates])

  useEffect(() => {
    setTemplateActressNameReversedByIndex((prev) => {
      const validIndexes = new Set(validScraperTemplates.map((_template, index) => index))
      const next = Object.fromEntries(
        Object.entries(prev)
          .map(([index, value]) => [Number(index), value] as const)
          .filter(([index]) => validIndexes.has(index)),
      )
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [validScraperTemplates])

  const resetDialogState = () => {
    setDraft(createBlankScraperSource())
    setScraperEntryMode('template')
    setSelectedTemplateIndexes(new Set())
    setTemplateActressName('')
    setTemplateActressNamesByIndex({})
    setTemplateActressNameReversedByIndex({})
  }

  useEffect(() => {
    if (!open) {
      initializedDraftKeyRef.current = null
      initializedTemplateKeyRef.current = null
      resetDialogState()
    }
  }, [open])

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
  }

  const handleSave = () => {
    if (!draft.name.trim() || !draft.url.trim()) {
      toast.error('Name and URL are required')
      return
    }
    const source = {
      ...draft,
      name: draft.name.trim(),
      url: draft.url.trim(),
      schedule: {
        ...draft.schedule,
        time: draft.schedule.interval !== 'hourly' ? draft.schedule.time : undefined,
        dayOfWeek: draft.schedule.interval === 'weekly' ? draft.schedule.dayOfWeek : undefined,
        timeZone: browserTimeZone(),
      },
    }
    if (editingSourceId) {
      onUpdate(source)
      return
    }
    onCreate(source)
  }

  const handleTemplateSave = () => {
    const selectedTemplateEntries = [...selectedTemplateIndexes]
      .sort((a, b) => a - b)
      .map((index) => ({
        index,
        template: validScraperTemplates[index],
        actressName: (templateActressNamesByIndex[index] ?? templateActressName).trim(),
      }))
      .filter((entry) => entry.template)
    const actressName = templateActressName.trim()
    const firstTemplate = selectedTemplateEntries[0]?.template ?? validScraperTemplates[0]
    const firstActressName = selectedTemplateEntries[0]?.actressName || actressName
    if (!firstTemplate) {
      toast.error('Add a scraper website in Settings first')
      return
    }
    if (!actressName && selectedTemplateEntries.length === 0) {
      toast.error('Actress name is required')
      return
    }
    if (selectedTemplateEntries.length === 0) {
      toast.error('Select at least one website')
      return
    }
    if (singleWebsiteMode && selectedTemplateEntries.length > 1) {
      toast.error('Select only one website')
      return
    }
    if (selectedTemplateEntries.some((entry) => !entry.actressName)) {
      toast.error('Actress name is required for every selected website')
      return
    }

    const urls = selectedTemplateEntries.map(({ template: selectedTemplate, actressName: selectedActressName }) => (
      buildScraperTemplateUrl(selectedTemplate.url_template.trim(), selectedActressName)
    ))
    const urlActressNameReversed = selectedTemplateEntries.map(({ index }) => templateActressNameReversedByIndex[index] ?? false)
    const source = {
      ...draft,
      name: draft.name.trim() || `${firstTemplate.label.trim()} - ${firstActressName}`,
      url: urls[0],
      urls,
      urlActressNameReversed,
      schedule: {
        ...draft.schedule,
        time: draft.schedule.interval !== 'hourly' ? draft.schedule.time : undefined,
        dayOfWeek: draft.schedule.interval === 'weekly' ? draft.schedule.dayOfWeek : undefined,
        timeZone: browserTimeZone(),
      },
    }
    if (editingSourceId) {
      onUpdate(source)
      return
    }

    onCreate({
      ...draft,
      id: createId(),
      name: actressName || firstActressName,
      url: urls[0],
      urls,
      urlActressNameReversed,
      schedule: {
        ...draft.schedule,
        time: draft.schedule.interval !== 'hourly' ? draft.schedule.time : undefined,
        dayOfWeek: draft.schedule.interval === 'weekly' ? draft.schedule.dayOfWeek : undefined,
        timeZone: browserTimeZone(),
      },
      createdAt: new Date(),
    })
  }

  const handleDialogSave = () => {
    if (scraperEntryMode === 'template') {
      handleTemplateSave()
      return
    }

    handleSave()
  }

  const toggleTemplateSelection = (templateIndex: number) => {
    setSelectedTemplateIndexes((prev) => {
      if (singleWebsiteMode) {
        return prev.has(templateIndex) ? new Set() : new Set([templateIndex])
      }
      const next = new Set(prev)
      if (next.has(templateIndex)) {
        next.delete(templateIndex)
      } else {
        next.add(templateIndex)
      }
      return next
    })
  }

  const updateTemplateActressName = (templateIndex: number, value: string) => {
    setTemplateActressNamesByIndex((prev) => ({ ...prev, [templateIndex]: value }))
  }

  const toggleTemplateActressNameOrder = (templateIndex: number) => {
    setTemplateActressNameReversedByIndex((prev) => {
      const nextReversed = !prev[templateIndex]
      const sourceName = templateActressNamesByIndex[templateIndex] || templateActressName || ''
      setTemplateActressNamesByIndex((current) => ({
        ...current,
        [templateIndex]: toggleActressNameOrder(sourceName),
      }))
      return { ...prev, [templateIndex]: nextReversed }
    })
  }

  const handleSharedActressNameChange = (value: string) => {
    setTemplateActressName(value)
    setTemplateActressNamesByIndex((prev) => {
      const next = { ...prev }
      validScraperTemplates.forEach((_template, index) => {
        next[index] = flipActressNameOrder(value, templateActressNameReversedByIndex[index] ?? false)
      })
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{editingSourceId ? 'Edit Scraper' : 'Add Scraper'}</DialogTitle>
          <DialogDescription>{editingSourceId ? 'Update this scheduled scraper source.' : 'Create a scheduled scraper source.'}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Tabs value={scraperEntryMode} onValueChange={(value) => setScraperEntryMode(value as 'manual' | 'template')} className="flex h-full min-h-0 w-full flex-col overflow-hidden">
            <TabsList className="mb-4 w-full shrink-0">
              <TabsTrigger value="template" className="flex-1">Template</TabsTrigger>
              <TabsTrigger value="manual" className="flex-1">Manual</TabsTrigger>
            </TabsList>
            <TabsContent value="template" className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex">
              <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar">
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  {!editingSourceId && (
                    <div className="grid gap-3">
                      <Label htmlFor="scraper-actress-name">Actress Name</Label>
                      <p className="text-xs text-muted-foreground">Used for scraper names and as the default website actress name.</p>
                      <div className="px-1">
                        <Input id="scraper-actress-name" value={templateActressName} onChange={(event) => handleSharedActressNameChange(event.target.value)} placeholder="Yua Mikami" />
                      </div>
                    </div>
                  )}

                  {editingSourceId && (
                    <div className="grid gap-3">
                      <Label htmlFor="scraper-template-name">Name</Label>
                      <Input id="scraper-template-name" value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="JavPlayer - Yua Mikami" />
                    </div>
                  )}

                  <div className="grid min-h-0 flex-1 gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label>Websites</Label>
                      {!singleWebsiteMode && validScraperTemplates.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setSelectedTemplateIndexes(
                            selectedTemplateIndexes.size === validScraperTemplates.length
                              ? new Set()
                              : new Set(validScraperTemplates.map((_template, index) => index)),
                          )}
                        >
                          {selectedTemplateIndexes.size === validScraperTemplates.length ? 'Clear' : 'Select All'}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {singleWebsiteMode
                        ? `Choose the one scraper website to update, such as https://javplayer.org/model/${'{actress_name}'}.`
                        : `Add a scraper website in Settings, such as https://javplayer.org/model/${'{actress_name}'}.`}
                    </p>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar rounded-md border border-border p-2">
                      {validScraperTemplates.map((template, index) => {
                        const checkboxId = `scraper-template-${index}`
                        const inputId = `scraper-template-actress-name-${index}`
                        const isNameReversed = templateActressNameReversedByIndex[index] ?? false
                        return (
                          <div key={`${template.label}-${template.url_template}`} className="grid gap-3 rounded-sm px-1 py-2">
                            <div className="flex items-start gap-3">
                              <Checkbox
                                id={checkboxId}
                                checked={selectedTemplateIndexes.has(index)}
                                onCheckedChange={() => toggleTemplateSelection(index)}
                              />
                              <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                                <Label htmlFor={checkboxId} className="grid min-w-0 cursor-pointer gap-0.5 text-sm leading-none">
                                  <span>{template.label}</span>
                                  <span className="truncate text-xs font-normal text-muted-foreground">{template.url_template}</span>
                                </Label>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                                  onClick={() => toggleTemplateActressNameOrder(index)}
                                  disabled={!selectedTemplateIndexes.has(index)}
                                >
                                  <ArrowLeftRight className="h-3.5 w-3.5" />
                                  {isNameReversed ? 'First Last' : 'Last First'}
                                </Button>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Input
                                id={inputId}
                                className="h-8 min-w-0 flex-1 text-xs"
                                value={templateActressNamesByIndex[index] ?? ''}
                                onChange={(event) => updateTemplateActressName(index, event.target.value)}
                                placeholder={templateActressName ? `Use ${templateActressName}` : 'Enter an actress name'}
                                disabled={!selectedTemplateIndexes.has(index)}
                              />
                            </div>
                          </div>
                        )
                      })}
                      {validScraperTemplates.length === 0 && (
                        <div className="text-xs text-muted-foreground">Add a scraper website in Settings, such as https://javplayer.org/model/{'{actress_name}'}.</div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {!editingSourceId && validScraperTemplates.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Creates 1 scraper with {selectedTemplateIndexes.size || 0} website{selectedTemplateIndexes.size === 1 ? '' : 's'}. Row values override the shared actress name in URLs.
                      </p>
                    )}
                  </div>

                  <ScraperScheduleFields draft={draft} setDraft={setDraft} timeInputId="scraper-template-time" />

                  <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                    <Label htmlFor="scraper-template-active" className="cursor-pointer">Active</Label>
                    <Switch id="scraper-template-active" checked={draft.isActive} onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, isActive: checked }))} />
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="manual" className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=active]:flex">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 scrollbar">
                <div className="grid gap-3">
                  <Label htmlFor="scraper-name">Actress Name</Label>
                  <Input id="scraper-name" value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="Enter an actress name" />
                </div>

                <div className="grid gap-3">
                  <Label htmlFor="scraper-url">Source URL</Label>
                  <p className="text-xs text-muted-foreground">Use a URL template like https://javplayer.org/model/{'{actress_name}'}.</p>
                  <Input id="scraper-url" value={draft.url} onChange={(event) => setDraft((prev) => ({ ...prev, url: event.target.value }))} placeholder="https://javplayer.org/model/yua-mikami" />
                </div>

                <ScraperScheduleFields draft={draft} setDraft={setDraft} timeInputId="scraper-time" />

                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <Label htmlFor="scraper-active" className="cursor-pointer">Active</Label>
                  <Switch id="scraper-active" checked={draft.isActive} onCheckedChange={(checked) => setDraft((prev) => ({ ...prev, isActive: checked }))} />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
        <DialogFooter className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end sm:space-x-2">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="w-full sm:w-auto">Cancel</Button>
          <Button type="button" onClick={handleDialogSave} disabled={isSaving} className="w-full sm:w-auto">
            {editingSourceId ? <Pencil className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            {editingSourceId ? 'Save Scraper' : 'Add Scraper'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ScraperScheduleFieldsProps {
  draft: ScraperSource
  setDraft: Dispatch<SetStateAction<ScraperSource>>
  timeInputId: string
}

function ScraperScheduleFields({ draft, setDraft, timeInputId }: ScraperScheduleFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-2">
          <Label>Interval</Label>
          <Select value={draft.schedule.interval} onValueChange={(value) => setDraft((prev) => ({ ...prev, schedule: { ...prev.schedule, interval: value as ScraperSource['schedule']['interval'] } }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hourly">Hourly</SelectItem>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={timeInputId}>Time (Local)</Label>
          <Input id={timeInputId} type="time" value={draft.schedule.time ?? '09:00'} disabled={draft.schedule.interval === 'hourly'} onChange={(event) => setDraft((prev) => ({ ...prev, schedule: { ...prev.schedule, time: event.target.value } }))} />
        </div>
      </div>

      {draft.schedule.interval === 'weekly' && (
        <div className="grid gap-2">
          <Label>Day</Label>
          <Select value={String(draft.schedule.dayOfWeek ?? 1)} onValueChange={(value) => setDraft((prev) => ({ ...prev, schedule: { ...prev.schedule, dayOfWeek: Number(value) } }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  )
}
