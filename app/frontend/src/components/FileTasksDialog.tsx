import { useEffect, useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type { File, Task } from '@/types/types'
import { taskApi } from '@/api/tasks'
import { useUnpauseTask, useDeleteTask } from '@/hooks/useTasks'
import { TaskCard } from './TaskCard'
import { toast } from 'sonner'

interface FileTasksDialogProps {
  file: File
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function FileTasksDialog({ file, open, onOpenChange }: FileTasksDialogProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { mutate: unpauseTask } = useUnpauseTask()
  const deleteTaskMutation = useDeleteTask()

  const handleUnpause = useCallback((taskId: string) => {
    unpauseTask(taskId, {
      onSuccess: () => setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'queued' as const } : t)),
    })
  }, [unpauseTask])

  const handleDeleteTask = useCallback((taskId: string) => {
    deleteTaskMutation.mutateAsync(taskId)
      .then(() => {
        setTasks(prev => prev.filter(t => t.id !== taskId))
        toast.success('Task deleted')
      })
      .catch(() => {
        toast.error('Failed to delete task')
      })
  }, [deleteTaskMutation])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setIsLoading(true)
    setError(null)

    taskApi.getTasks(0, 100, undefined, undefined, file.id)
      .then(({ tasks: fetched }) => {
        if (!cancelled) setTasks(fetched)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tasks')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [open, file.id])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[90vw] max-h-[95vh] flex flex-col">

        <DialogHeader className="shrink-0">
          <DialogTitle>Tasks — {file.name}</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 min-h-0">
          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {!isLoading && error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {!isLoading && !error && tasks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No tasks found for this file.
            </p>
          )}

          {!isLoading && !error && tasks.length > 0 && (
            <div className="space-y-2">
              {tasks.map((task) => (
                <TaskCard key={task.id} task={task} compact onUnpauseTask={handleUnpause} onDeleteTask={handleDeleteTask} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
