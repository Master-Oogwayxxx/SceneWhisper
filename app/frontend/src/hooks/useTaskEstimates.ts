import { useCallback, useEffect, useState } from 'react'
import { taskApi } from '../api/tasks'
import type { Task } from '../types/types'

type TaskType = 'scene' | 'split' | 'subtitle' | 'all' | 'merge' | 'analyze_frame_pacing' | 'nvenc_frame_pacing' | 'remux'

interface TypeStats {
  normalizedRate: number | null   // seconds per second of video (avg)
  flatAvg: number | null          // avg elapsedSeconds regardless of file duration
}

function parseDurationToSeconds(duration: string | undefined): number {
  if (!duration) return 0
  const parts = duration.split(':').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return 0
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

function computeStats(samples: Task[]): Record<TaskType, TypeStats> {
  const groups: Record<TaskType, Task[]> = {
    scene: [], split: [], subtitle: [], all: [], merge: [], analyze_frame_pacing: [], nvenc_frame_pacing: [], remux: [],
  }

  for (const task of samples) {
    if (task.type in groups && task.elapsedSeconds && task.elapsedSeconds > 0) {
      groups[task.type as TaskType].push(task)
    }
  }

  const result = {} as Record<TaskType, TypeStats>

  for (const type of Object.keys(groups) as TaskType[]) {
    const group = groups[type]

    // Flat average
    const flatAvg = group.length > 0
      ? group.reduce((sum, t) => sum + (t.elapsedSeconds ?? 0), 0) / group.length
      : null

    // Duration-normalized rate: elapsedSeconds / fileDurationSeconds
    const ratesamples = group.filter(t => {
      const dur = parseDurationToSeconds(t.file?.duration)
      return dur > 0
    })
    const normalizedRate = ratesamples.length > 0
      ? ratesamples.reduce((sum, t) => {
          const dur = parseDurationToSeconds(t.file?.duration)
          return sum + (t.elapsedSeconds ?? 0) / dur
        }, 0) / ratesamples.length
      : null

    result[type] = { normalizedRate, flatAvg }
  }

  return result
}

export function useTaskEstimates() {
  const [stats, setStats] = useState<Record<TaskType, TypeStats> | null>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    taskApi.getTasks(0, 100, 'completed').then(({ tasks }) => {
      setStats(computeStats(tasks))
      setIsReady(true)
    }).catch(() => {
      setIsReady(true) // fail silently — estimates just won't show
    })
  }, [])

  const estimateTask = useCallback((task: Task): number | undefined => {
    if (!stats) return undefined
    const typeStats = stats[task.type as TaskType]
    if (!typeStats) return undefined

    const fileDurSec = parseDurationToSeconds(task.file?.duration)

    if (fileDurSec > 0 && typeStats.normalizedRate !== null) {
      return Math.ceil(fileDurSec * typeStats.normalizedRate)
    }
    if (typeStats.flatAvg !== null) {
      return Math.ceil(typeStats.flatAvg)
    }
    return undefined
  }, [stats])

  return { estimateTask, isReady }
}
