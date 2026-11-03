import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

type ScheduleInterval = 'hourly' | 'daily' | 'weekly'

interface ScraperBulkScheduleDialogProps {
  open: boolean
  selectedCount: number
  interval: ScheduleInterval
  time: string
  dayOfWeek: number
  saving: boolean
  onOpenChange: (open: boolean) => void
  onIntervalChange: (interval: ScheduleInterval) => void
  onTimeChange: (time: string) => void
  onDayOfWeekChange: (dayOfWeek: number) => void
  onSubmit: () => void
}

export function ScraperBulkScheduleDialog({
  open,
  selectedCount,
  interval,
  time,
  dayOfWeek,
  saving,
  onOpenChange,
  onIntervalChange,
  onTimeChange,
  onDayOfWeekChange,
  onSubmit,
}: ScraperBulkScheduleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {selectedCount} Scraper{selectedCount === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>Apply one schedule to all selected scraper sources.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Interval</Label>
            <div className="grid grid-cols-3 gap-2">
              {(['hourly', 'daily', 'weekly'] as const).map((option) => (
                <Button key={option} type="button" variant={interval === option ? 'default' : 'outline'} onClick={() => onIntervalChange(option)} className="capitalize">
                  {option}
                </Button>
              ))}
            </div>
          </div>
          {interval !== 'hourly' && (
            <div className={interval === 'weekly' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2' : 'space-y-2'}>
              <div className="space-y-2">
                <Label htmlFor="bulk-scraper-schedule-time">Time (Local)</Label>
                <Input id="bulk-scraper-schedule-time" type="time" value={time} onChange={(event) => onTimeChange(event.target.value)} />
              </div>
              {interval === 'weekly' && (
                <div className="space-y-2">
                  <Label htmlFor="bulk-scraper-schedule-day">Day of Week</Label>
                  <Select value={String(dayOfWeek)} onValueChange={(value) => onDayOfWeekChange(Number(value))}>
                    <SelectTrigger id="bulk-scraper-schedule-day"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, index) => (
                        <SelectItem key={day} value={String(index)}>{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={onSubmit} disabled={saving}>{saving ? 'Saving...' : 'Apply Schedule'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
