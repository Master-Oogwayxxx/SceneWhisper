import { useEffect, useState } from 'react'
import { ActressDownloadMonitor } from '@/types/types'
import { useSettings } from '@/hooks/useSettings'
import { localTimeToUtc, utcTimeToLocal } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }, { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' }, { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

function formatOptionalDateTime(value?: string | Date | null): string {
  if (!value) return 'Not scheduled'
  return (value instanceof Date ? value : new Date(value)).toLocaleString()
}

export interface R18AutoRefreshSectionProps {
  settings: Pick<ReturnType<typeof useSettings>['settings'],
    'r18_auto_refresh_enabled' | 'r18_auto_refresh_time' | 'r18_auto_refresh_day_of_week' |
    'r18_auto_refresh_last_run' | 'r18_auto_refresh_next_run' | 'r18_auto_refresh_last_error'>
  onPatch: (updates: {
    r18_auto_refresh_enabled?: boolean
    r18_auto_refresh_time?: string | null
    r18_auto_refresh_day_of_week?: number | null
  }) => void
}

export function R18AutoRefreshSection({ settings, onPatch }: R18AutoRefreshSectionProps) {
  const [enabled, setEnabled] = useState(settings.r18_auto_refresh_enabled)
  const [time, setTime] = useState(utcTimeToLocal(settings.r18_auto_refresh_time ?? '09:00'))
  const [dayOfWeek, setDayOfWeek] = useState(settings.r18_auto_refresh_day_of_week ?? 1)

  useEffect(() => {
    setEnabled(settings.r18_auto_refresh_enabled)
    setTime(utcTimeToLocal(settings.r18_auto_refresh_time ?? '09:00'))
    setDayOfWeek(settings.r18_auto_refresh_day_of_week ?? 1)
  }, [settings.r18_auto_refresh_day_of_week, settings.r18_auto_refresh_enabled, settings.r18_auto_refresh_time])

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1"><p className="font-medium">Weekly auto-refresh</p><p className="text-sm text-muted-foreground">Automatically refresh the selected actress metadata provider every week.</p></div>
        <Switch checked={enabled} aria-label="Enable weekly auto-refresh" onCheckedChange={(checked) => {
          setEnabled(checked)
          onPatch(checked ? { r18_auto_refresh_enabled: true, r18_auto_refresh_time: localTimeToUtc(time), r18_auto_refresh_day_of_week: dayOfWeek } : { r18_auto_refresh_enabled: false })
        }} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="r18-auto-refresh-day">Weekly refresh day</Label><Select value={String(dayOfWeek)} onValueChange={(value) => { const nextDay = Number(value); setDayOfWeek(nextDay); onPatch({ r18_auto_refresh_day_of_week: nextDay }) }}><SelectTrigger id="r18-auto-refresh-day" aria-label="Weekly refresh day"><SelectValue /></SelectTrigger><SelectContent>{DAYS_OF_WEEK.map((day) => <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="r18-auto-refresh-time">Weekly refresh time</Label><Input id="r18-auto-refresh-time" type="time" value={time} onChange={(e) => { const nextTime = e.target.value; setTime(nextTime); if (nextTime) onPatch({ r18_auto_refresh_time: localTimeToUtc(nextTime) }) }} /></div>
      </div>
      <div className="space-y-1 text-sm text-muted-foreground"><p>Last run: {formatOptionalDateTime(settings.r18_auto_refresh_last_run)}</p><p>Next run: {formatOptionalDateTime(settings.r18_auto_refresh_next_run)}</p></div>
      {settings.r18_auto_refresh_last_error && <p className="text-sm text-destructive">{settings.r18_auto_refresh_last_error}</p>}
    </div>
  )
}

export interface ActressScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  monitor?: ActressDownloadMonitor | null
  actressName?: string
  onSave: (patch: { interval: 'hourly' | 'daily' | 'weekly'; time?: string; dayOfWeek?: number; maxItemsPerRun: number; savePath?: string; isActive: boolean }) => void
}

export function ActressScheduleEditor({ open, onOpenChange, monitor, actressName, onSave }: ActressScheduleDialogProps) {
  const [interval, setInterval] = useState<'hourly' | 'daily' | 'weekly'>('daily')
  const [time, setTime] = useState('09:00')
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [maxItemsPerRun, setMaxItemsPerRun] = useState(25)
  const [savePath, setSavePath] = useState('')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    if (!open) return
    setInterval(monitor?.schedule.interval ?? 'daily'); setTime(utcTimeToLocal(monitor?.schedule.time ?? '09:00'))
    setDayOfWeek(monitor?.schedule.dayOfWeek ?? 1); setMaxItemsPerRun(monitor?.maxItemsPerRun ?? 25)
    setSavePath(monitor?.savePath ?? ''); setIsActive(monitor?.isActive ?? true)
  }, [monitor, open])

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{monitor ? 'Edit actress schedule' : 'Schedule actress downloads'}</DialogTitle><DialogDescription>{actressName ? `Automatically queue matching works for ${actressName}.` : 'Automatically queue matching actress works.'}</DialogDescription></DialogHeader><div className="space-y-4">
    <div className="space-y-2"><Label>Check interval</Label><Select value={interval} onValueChange={(value) => setInterval(value as typeof interval)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hourly">Hourly</SelectItem><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent></Select></div>
    {interval !== 'hourly' && <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="actress-schedule-time">Time</Label><Input id="actress-schedule-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>{interval === 'weekly' && <div className="space-y-2"><Label>Day</Label><Select value={String(dayOfWeek)} onValueChange={(value) => setDayOfWeek(Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DAYS_OF_WEEK.map((day) => <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>)}</SelectContent></Select></div>}</div>}
    <div className="space-y-2"><Label htmlFor="actress-max-items">Max works per run</Label><Input id="actress-max-items" type="number" min={1} max={500} value={maxItemsPerRun} onChange={(e) => setMaxItemsPerRun(Number(e.target.value))} /></div>
    <div className="space-y-2"><Label htmlFor="actress-save-path">Default save path</Label><Input id="actress-save-path" value={savePath} onChange={(e) => setSavePath(e.target.value)} placeholder="Use qBittorrent default" /></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />Enable this schedule</label>
    <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" onClick={() => onSave({ interval, time: interval !== 'hourly' ? localTimeToUtc(time) : undefined, dayOfWeek: interval === 'weekly' ? dayOfWeek : undefined, maxItemsPerRun: Math.max(1, maxItemsPerRun || 25), savePath: savePath.trim() || undefined, isActive })}>{monitor ? 'Update schedule' : 'Create schedule'}</Button></div>
  </div></DialogContent></Dialog>
}
