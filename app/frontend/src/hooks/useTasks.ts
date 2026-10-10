import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { taskApi } from '@/api/tasks'
import type { Task, TaskStatus, Stats, ReorderCustomRequest } from '@/types/types'
import { useSettings } from './useSettings'
import { statsKeys } from './useStats'
import { useToast } from '@/hooks/use-toast'
import type { TaskFilters } from '@/components/TaskFilterDialog'

const taskKeys = {
  list: (filter: string, page: number, pageSize: number, search?: string, taskFilters?: TaskFilters) => ['tasks', filter, page, pageSize, search, taskFilters] as const,
  all: () => ['tasks'] as const,
}

interface UseTasksOptions {
  filter: string
  page: number
  pageSize: number
  search?: string
  taskFilters?: TaskFilters
  enabled?: boolean
}

export function useTasks({
  filter,
  page,
  pageSize,
  search,
  taskFilters,
  enabled = true,
}: UseTasksOptions) {
  const { settings } = useSettings()
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: taskKeys.list(filter, page, pageSize, search, taskFilters),
    queryFn: async () => {
      const status = filter === 'all' ? undefined : (filter as TaskStatus)
      const skip = (page - 1) * pageSize
      return taskApi.getTasks(skip, pageSize, status, search, undefined, taskFilters)
    },
    refetchInterval: () => {
      const stats = queryClient.getQueryData<Stats>(statsKeys.all())
      const hasActive = (stats?.queued ?? 0) + (stats?.processing ?? 0) > 0
      return hasActive ? settings.task_poll_interval_ms : settings.task_poll_interval_ms * 10
    },
    enabled,
    placeholderData: (previousData) => previousData,
  })
}

export function useCancelTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskId: string) => taskApi.cancelTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all() })
      queryClient.invalidateQueries({ queryKey: statsKeys.all() })
    },
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskId: string) => taskApi.deleteTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all() })
      queryClient.invalidateQueries({ queryKey: statsKeys.all() })
    },
  })
}

export function useRerunTask() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  return useMutation({
    mutationFn: async (task: Task) => {
      await taskApi.addTaskVideo(task)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all() })
      queryClient.invalidateQueries({ queryKey: statsKeys.all() })
    },
    onError: (error: Error) => {
      const message = error.message || "Failed to rerun task"
      toast({
        title: "Cannot Rerun Task",
        description: message,
        variant: "destructive",
      })
    },
  })
}

export function usePauseTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskId: string) => taskApi.pauseTask(taskId),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: taskKeys.all() })
      queryClient.invalidateQueries({ queryKey: statsKeys.all() })
    },
  })
}

export function useUnpauseTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (taskId: string) => taskApi.unpauseTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all() })
      queryClient.invalidateQueries({ queryKey: statsKeys.all() })
    },
  })
}

export function useBulkPauseTasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (taskIds: string[]) => taskApi.bulkPauseTasks(taskIds),
    onSuccess: () => {
      queryClient.refetchQueries({ queryKey: taskKeys.all() })
      queryClient.invalidateQueries({ queryKey: statsKeys.all() })
    },
  })
}

export function useBulkUnpauseTasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (taskIds: string[]) => taskApi.bulkUnpauseTasks(taskIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all() })
      queryClient.invalidateQueries({ queryKey: statsKeys.all() })
    },
  })
}

export function useReorderTasks() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ taskIds, position }: { taskIds: string[]; position: 'top' | 'bottom' }) =>
      taskApi.reorderTasks(taskIds, position),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all() })
    },
  })
}

export function useReorderTasksCustom() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: ReorderCustomRequest) =>
      taskApi.reorderCustom(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all() })
    },
  })
}

export function useMergeTask() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fileIds: string[]) => taskApi.mergeFiles(fileIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all() })
      queryClient.invalidateQueries({ queryKey: ['files'] })
      queryClient.invalidateQueries({ queryKey: statsKeys.all() })
    },
  })
}
