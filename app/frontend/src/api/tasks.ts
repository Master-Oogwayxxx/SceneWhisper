import { Task, AddTaskResponse, TaskStatus, TasksResponse } from '@/types/types'
import type { TaskFilters } from '@/components/TaskFilterDialog'

import { API_BASE } from '@/api/client'

export const taskApi = {
  async getFileBadgeTasks(signal?: AbortSignal): Promise<Task[]> {
    const res = await fetch(`${API_BASE}/tasks/file-badges`, { signal })
    if (!res.ok) {
      throw new Error(`Failed to fetch file badge tasks: ${res.statusText}`)
    }
    return res.json()
  },

  async getTasks(skip: number = 0, limit: number = 20, status?: string, search?: string, fileId?: string, filters?: TaskFilters): Promise<TasksResponse> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    try {
      const url = new URL(`${API_BASE}/tasks`)
      url.searchParams.append('skip', skip.toString())
      url.searchParams.append('limit', limit.toString())
      if (status) {
        url.searchParams.append('status', status)
      }
      if (search) {
        url.searchParams.append('search', search)
      }
      if (fileId) {
        url.searchParams.append('file_id', fileId)
      }
      filters?.taskType.forEach((value) => url.searchParams.append('task_type', value))
      filters?.dateRange.forEach((value) => url.searchParams.append('date_range', value))
      filters?.subtitleLanguage.forEach((value) => url.searchParams.append('subtitle_language', value))
      filters?.sceneDetector.forEach((value) => url.searchParams.append('scene_detector', value))
      filters?.selectedDirectoryIds.forEach((value) => url.searchParams.append('directory_id', value))
      if (filters?.directoryExclude) {
        url.searchParams.append('directory_exclude', 'true')
      }
      const res = await fetch(url.toString(), { signal: controller.signal })
      if (!res.ok) {
        throw new Error(`Failed to fetch tasks: ${res.statusText}`)
      }
      const data: TasksResponse = await res.json()
      return data
    } finally {
      clearTimeout(timeout)
    }
  },

  async getTask(taskId: string): Promise<Task> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`)

    if (!res.ok) {
      throw new Error('Task not found')
    }

    return res.json()
  },

  async cancelTask(taskId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/cancel`, {
      method: 'POST',
    })

    if (!res.ok) {
      throw new Error('Failed to cancel task')
    }
  },

  async deleteTask(taskId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
      method: 'DELETE',
    })

    if (!res.ok) {
      throw new Error('Failed to delete task')
    }
  },

  async addTaskDirectory(task: Task): Promise<AddTaskResponse> {
    const res = await fetch(`${API_BASE}/tasks/add_directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: task }),
    })

    if (!res.ok) {
      const error = await res.json()
      throw new Error(error.detail || 'Failed to scan directory')
    }

    return res.json()
  },

  async addTaskVideo(task: Task): Promise<AddTaskResponse> {
    const res = await fetch(`${API_BASE}/tasks/add_video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    })

    if (!res.ok) {
      const error = await res.json()
      const err = new Error(error.detail || 'Failed to add video') as Error & { status: number }
      err.status = res.status
      throw err
    }

    return res.json()
  },

  async mergeFiles(fileIds: string[]): Promise<Task> {
    const res = await fetch(`${API_BASE}/tasks/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_ids: fileIds }),
    })

    if (!res.ok) {
      const error = await res.json()
      throw new Error(error.detail || 'Failed to merge files')
    }

    return res.json()
  },

  async clearTasksByStatus(
    status: TaskStatus | 'all'
  ): Promise<{ deleted: number }> {
    if (status === 'all') {
      throw new Error('Clearing all statuses at once is not supported')
    }

    const res = await fetch(
      `${API_BASE}/tasks?status=${encodeURIComponent(status)}`,
      {
        method: 'DELETE',
      }
    )

    if (!res.ok) {
      const error = await res.json()
      throw new Error(error.detail || `Failed to clear tasks: ${res.statusText}`)
    }

    return res.json()
  },

  async pauseTask(taskId: string): Promise<Task> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/pause`, {
      method: 'POST',
    })

    if (!res.ok) {
      throw new Error('Failed to pause task')
    }

    return res.json()
  },

  async unpauseTask(taskId: string): Promise<Task> {
    const res = await fetch(`${API_BASE}/tasks/${taskId}/unpause`, {
      method: 'POST',
    })

    if (!res.ok) {
      throw new Error('Failed to unpause task')
    }

    return res.json()
  },

  async bulkPauseTasks(taskIds: string[]): Promise<{ paused_count: number; tasks: Task[] }> {
    const res = await fetch(`${API_BASE}/tasks/bulk-pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_ids: taskIds }),
    })
    if (!res.ok) throw new Error('Failed to bulk pause tasks')
    return res.json()
  },

  async bulkUnpauseTasks(taskIds: string[]): Promise<{ unpaused_count: number; tasks: Task[] }> {
    const res = await fetch(`${API_BASE}/tasks/bulk-unpause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_ids: taskIds }),
    })
    if (!res.ok) throw new Error('Failed to bulk unpause tasks')
    return res.json()
  },

  async globalPause(): Promise<void> {
    const res = await fetch(`${API_BASE}/tasks/global-pause`, {
      method: 'POST',
    })
    if (!res.ok) throw new Error('Failed to globally pause tasks')
  },

  async globalUnpause(): Promise<void> {
    const res = await fetch(`${API_BASE}/tasks/global-unpause`, {
      method: 'POST',
    })
    if (!res.ok) throw new Error('Failed to globally unpause tasks')
  },

  async getGlobalPauseStatus(): Promise<{ is_globally_paused: boolean }> {
    const res = await fetch(`${API_BASE}/tasks/global-pause-status`)
    if (!res.ok) throw new Error('Failed to fetch global pause status')
    return res.json()
  },

  async reorderTasks(taskIds: string[], position: 'top' | 'bottom'): Promise<void> {
    const res = await fetch(`${API_BASE}/tasks/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_ids: taskIds, position }),
    })

    if (!res.ok) {
      throw new Error('Failed to reorder tasks')
    }
  },

  async reorderCustom(request: { task_ids: string[] }): Promise<void> {
    const res = await fetch(`${API_BASE}/tasks/reorder-custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (!res.ok) {
      throw new Error('Failed to reorder tasks')
    }
  },
}

export const pauseTask = (taskId: string) => taskApi.pauseTask(taskId)
export const unpauseTask = (taskId: string) => taskApi.unpauseTask(taskId)
