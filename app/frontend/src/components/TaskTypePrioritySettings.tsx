import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from './ui/button'
import { Label } from './ui/label'

const TASK_TYPE_LABELS: Record<string, string> = { all: 'All', merge: 'Merge', subtitle: 'Subtitle', split: 'Split', scene: 'Scene', analyze_frame_pacing: 'Analyze + Frame Pacing Repair', nvenc_frame_pacing: 'Frame Pacing Repair', remux: 'Remux' }

interface TaskTypePrioritySettingsProps { priority: string[]; onChange: (priority: string[]) => void }

export function TaskTypePrioritySettings({ priority, onChange }: TaskTypePrioritySettingsProps) {
  const move = (index: number, direction: -1 | 1) => { const next = [...priority]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(next) }
  return <div className="flex flex-col gap-2.5 py-2.5 sm:gap-3 sm:py-3">
    <div><Label className="text-xs font-medium sm:text-sm">Task Type Priority</Label><p className="text-[11px] text-muted-foreground sm:text-xs">Processing order when multiple task types are queued</p></div>
    <div className="flex flex-col gap-1">{priority.map((type, index) => <div key={type} className="flex items-center justify-between rounded border border-border bg-muted/40 px-2.5 py-1 sm:px-3 sm:py-1.5"><span className="text-xs sm:text-sm">{TASK_TYPE_LABELS[type] ?? type}</span><div className="flex gap-1"><Button variant="ghost" size="icon" className="h-5.5 w-5.5 sm:h-7 sm:w-7" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Button><Button variant="ghost" size="icon" className="h-5.5 w-5.5 sm:h-7 sm:w-7" disabled={index === priority.length - 1} onClick={() => move(index, 1)}><ChevronDown className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></Button></div></div>)}</div>
  </div>
}
