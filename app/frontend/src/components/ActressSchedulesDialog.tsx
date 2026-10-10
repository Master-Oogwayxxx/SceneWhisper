import { CalendarClock, Pencil, Play, Trash2 } from 'lucide-react'
import { ActressDownloadMonitor } from '@/types/types'
import { utcTimeToLocal } from '@/lib/utils'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

function formatDateTime(value?: Date | null): string {
  if (!value) return 'Not scheduled'
  return value.toLocaleString()
}

function formatSchedule(schedule: ActressDownloadMonitor['schedule']): string {
  if (schedule.interval === 'hourly') return 'Hourly'
  const time = utcTimeToLocal(schedule.time ?? '09:00')
  if (schedule.interval === 'daily') return `Daily at ${time}`
  const day = DAYS_OF_WEEK.find((d) => d.value === (schedule.dayOfWeek ?? 1))?.label ?? 'Monday'
  return `${day} at ${time}`
}

interface ActressSchedulesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  monitors: ActressDownloadMonitor[]
  onRun: (monitor: ActressDownloadMonitor) => void
  onEdit: (monitor: ActressDownloadMonitor) => void
  onToggle: (monitor: ActressDownloadMonitor) => void
  onDelete: (monitor: ActressDownloadMonitor) => void
}

export function ActressSchedulesDialog({
  open,
  onOpenChange,
  monitors,
  onRun,
  onEdit,
  onToggle,
  onDelete,
}: ActressSchedulesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Actress Download Schedules</DialogTitle>
          <DialogDescription>Recurring monitors that add matching actress works to the torrent queue.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto space-y-2 pr-1">
          {monitors.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No actress schedules yet.</p>
          ) : (
            monitors.map((monitor) => (
              <div key={monitor.id} className="rounded-md border border-border p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{monitor.actressName}</p>
                      <Badge variant={monitor.isActive ? 'default' : 'secondary'}>{monitor.isActive ? 'Active' : 'Paused'}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatSchedule(monitor.schedule)} · {monitor.maxItemsPerRun} per run · Next Run {formatDateTime(monitor.nextRun)}
                    </p>
                    {monitor.savePath && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Save path: {monitor.savePath}
                      </p>
                    )}
                    {monitor.lastError && <p className="mt-1 text-xs text-destructive">{monitor.lastError}</p>}
                  </div>
                  <TooltipProvider delayDuration={150}>
                    <div className="flex shrink-0 gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => onRun(monitor)} aria-label={`Run ${monitor.actressName}`}>
                            <Play className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Run Now</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => onToggle(monitor)} aria-label={`${monitor.isActive ? 'Pause' : 'Resume'} ${monitor.actressName}`}>
                            <CalendarClock className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{monitor.isActive ? 'Pause Schedule' : 'Resume Schedule'}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => onEdit(monitor)} aria-label={`Edit ${monitor.actressName}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit Schedule</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => onDelete(monitor)} aria-label={`Delete ${monitor.actressName}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete Schedule</TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
