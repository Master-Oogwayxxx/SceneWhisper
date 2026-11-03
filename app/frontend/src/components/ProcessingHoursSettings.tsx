import { AppSettings } from '@/types/types'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'

type ProcessingDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type ProcessingDay = { key: ProcessingDayKey; settingKey: keyof Pick<AppSettings, 'processing_mon' | 'processing_tue' | 'processing_wed' | 'processing_thu' | 'processing_fri' | 'processing_sat' | 'processing_sun'>; label: string }

const PROCESSING_DAYS: ProcessingDay[] = [
  { key: 'mon', settingKey: 'processing_mon', label: 'Mon' },
  { key: 'tue', settingKey: 'processing_tue', label: 'Tue' },
  { key: 'wed', settingKey: 'processing_wed', label: 'Wed' },
  { key: 'thu', settingKey: 'processing_thu', label: 'Thu' },
  { key: 'fri', settingKey: 'processing_fri', label: 'Fri' },
  { key: 'sat', settingKey: 'processing_sat', label: 'Sat' },
  { key: 'sun', settingKey: 'processing_sun', label: 'Sun' },
]

type ProcessingWindow = { start: number; end: number }

interface ProcessingHoursSettingsProps {
  enabled: boolean
  windows: Record<ProcessingDayKey, ProcessingWindow>
  settings: Pick<AppSettings, ProcessingDay["settingKey"]>
  onToggle: (enabled: boolean) => void
  onDayToggle: (settingKey: ProcessingDay["settingKey"], enabled: boolean) => void
  onWindowChange: (day: ProcessingDayKey, field: 'start' | 'end', value: number) => void
}

export function ProcessingHoursSettings({ enabled, windows, settings, onToggle, onDayToggle, onWindowChange }: ProcessingHoursSettingsProps) {
  return (
    <>
      <div className="flex flex-col gap-2.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-3">
        <div className="min-w-0">
          <Label className="text-xs font-medium sm:text-sm">Processing Hours</Label>
          <p className="text-[11px] text-muted-foreground sm:text-xs">Only process tasks during a set time window. Start and end use your local 24-hour clock: 0 is midnight and 23 is 11 PM.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </div>
      {enabled && (
        <div className="rounded-lg overflow-hidden bg-muted/30 p-3">
          <div className="grid grid-cols-[3rem_1fr] items-center gap-2 px-1 pb-2 text-[11px] font-medium text-muted-foreground sm:grid-cols-[4rem_1fr] sm:gap-3 sm:text-xs">
            <span>Day</span>
            <div className="grid grid-cols-[3.5rem_3.25rem_3.25rem] justify-end gap-1.5 text-right sm:grid-cols-[4rem_4rem_4rem] sm:gap-2"><span>Run</span><span>Start</span><span>End</span></div>
          </div>
          <div className="space-y-1">
            {PROCESSING_DAYS.map(({ key, settingKey, label }) => (
              <div key={key} className="grid grid-cols-[3rem_1fr] items-center gap-2 rounded-md px-1 py-1.5 sm:grid-cols-[4rem_1fr] sm:gap-3">
                <Label className="text-xs font-medium sm:text-sm">{label}</Label>
                <div className="grid grid-cols-[3.5rem_3.25rem_3.25rem] justify-end gap-1.5 sm:grid-cols-[4rem_4rem_4rem] sm:gap-2">
                  <div className="flex h-8 items-center justify-end"><Switch checked={Boolean(settings[settingKey])} onCheckedChange={(value) => onDayToggle(settingKey, Boolean(value))} /></div>
                  <Input type="number" min={0} max={23} value={windows[key].start} onChange={(event) => onWindowChange(key, 'start', Number(event.target.value))} className="h-8 w-[3.25rem] text-right text-xs sm:w-16 sm:text-sm" />
                  <Input type="number" min={0} max={23} value={windows[key].end} onChange={(event) => onWindowChange(key, 'end', Number(event.target.value))} className="h-8 w-[3.25rem] text-right text-xs sm:w-16 sm:text-sm" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
