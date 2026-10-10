import { useState } from 'react'
import { Task } from '@/types/types'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QueueReorderSectionProps {
  queued: Task[]
  isLoading: boolean
  onReorder: (orderedTaskIds: string[]) => Promise<void>
}

export function QueueReorderSection({
  queued,
  isLoading,
  onReorder,
}: QueueReorderSectionProps) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [localOrder, setLocalOrder] = useState<Task[]>(queued)

  // Sync localOrder when queued changes (from parent or server)
  if (localOrder.length !== queued.length || localOrder.some((t, i) => t.id !== queued[i]?.id)) {
    setLocalOrder(queued)
  }

  if (queued.length === 0) {
    return null
  }

  const handleDragStart = (taskId: string) => {
    setDraggedTaskId(taskId)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    setDragOverIndex(null)

    if (!draggedTaskId) return

    const draggedIndex = localOrder.findIndex(t => t.id === draggedTaskId)
    if (draggedIndex === -1 || draggedIndex === dropIndex) {
      setDraggedTaskId(null)
      return
    }

    // Reorder locally (optimistic update)
    const newOrder = [...localOrder]
    const [draggedTask] = newOrder.splice(draggedIndex, 1)
    newOrder.splice(dropIndex, 0, draggedTask)
    setLocalOrder(newOrder)

    const orderedIds = newOrder.map(t => t.id)

    try {
      await onReorder(orderedIds)
    } catch {
      // Reset on error
      setLocalOrder(queued)
    }

    setDraggedTaskId(null)
  }

  const handleDragEnd = () => {
    setDraggedTaskId(null)
    setDragOverIndex(null)
  }

  return (
    <div className="space-y-2 py-3 border-b border-border">
      {isLoading && <div className="text-xs text-muted-foreground px-3">Saving order...</div>}
      {localOrder.map((task, index) => (
        <div
          key={task.id}
          draggable
          onDragStart={() => handleDragStart(task.id)}
          onDragOver={e => handleDragOver(e, index)}
          onDragLeave={handleDragLeave}
          onDrop={e => handleDrop(e, index)}
          onDragEnd={handleDragEnd}
          className={cn(
            'flex items-center gap-3 rounded px-3 py-2 cursor-move transition-all',
            draggedTaskId === task.id && 'opacity-50',
            dragOverIndex === index && 'bg-primary/10 border-l-2 border-primary',
          )}
        >
          <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {task.file?.name || `Task ${task.id.slice(0, 8)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {task.type} • Position {index + 1}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
