import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { TaskQueue, type TaskQueueFilter } from '../components/TaskQueue';
import type { TaskSortField } from '@/components/TaskSorting';
import { toast } from 'sonner';
import { TaskDialog, LANGUAGE_CODE_TO_NAME } from '@/components/TaskDialog';
import { DirectoryMonitorDialog } from '@/components/DirectoryMonitorDialog';
import { DirectoryMonitorEditDialog } from '@/components/DirectoryMonitorEditDialog';
import { DirectoryMonitorTab } from '@/components/DirectoryMonitorTab';
import { MonitorBulkEditDialog } from '@/components/MonitorBulkEditDialog';
import { PAGE_SIZE_OPTIONS, useDirectoryMonitorList, type PageSize } from '@/hooks/useDirectoryMonitorList';
import { FileModal } from '@/components/FileModal';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { File, Stats, Directory, Task, DirectoryRecord } from '@/types/types';
import { FileGroupModal } from '@/components/FileGroupModal';
import React from 'react';
import { taskApi } from '@/api/tasks';
import { fileApi } from '@/api/files';
import { useMonitorActions } from '@/hooks/useMonitorActions';
import { useSettings } from '@/hooks/useSettings';
import { useTasks, useCancelTask, useDeleteTask, useRerunTask, usePauseTask, useUnpauseTask, useBulkPauseTasks, useBulkUnpauseTasks, useReorderTasks } from '@/hooks/useTasks';
import { useStats } from '@/hooks/useStats';
import DashboardStats from '@/components/DashboardStats';
import { EMPTY_TASK_FILTERS, type TaskDateRange, type TaskFilters, type TaskTypeFilter } from '@/components/TaskFilterDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StatsTab } from '@/components/StatsTab';
import FileBrowserTab from '@/components/FileBrowserTab';
import { LogsTab } from '@/components/LogsTab';
import { ActressTab } from '@/components/ActressTab';
import { ScraperTab } from '@/components/ScraperTab';
import { DeletedHistoryTab } from '@/components/DeletedHistoryTab';
import { ToolsTab } from '@/components/ToolsTab';
import { BulkProgressDialog } from '@/components/BulkProgressDialog';
import { AppTab } from '@/types/types';

const TASK_QUEUE_FILTERS: TaskQueueFilter[] = ['all', 'queued', 'processing', 'completed', 'failed', 'cancelled', 'paused'];
const TASK_TYPE_FILTERS: TaskTypeFilter[] = ['scene', 'split', 'subtitle', 'all', 'merge', 'analyze_frame_pacing', 'nvenc_frame_pacing', 'remux'];
const TASK_DATE_RANGES: TaskDateRange[] = ['today', 'last_7_days', 'last_30_days', 'last_year'];
const TASK_SORT_FIELDS: TaskSortField[] = ['name', 'createdAt', 'startedAt', 'completedAt', 'pausedAt', 'elapsedSeconds', 'status', 'type'];
const SORT_DIRECTIONS: Array<'asc' | 'desc'> = ['asc', 'desc'];

const getQueryParam = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
};

const getQueryList = (key: string): string[] => {
  const value = getQueryParam(key);
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
};

const getQueryNumber = (key: string, fallback: number): number => {
  const value = getQueryParam(key);
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getQueryPageSize = (key: string, fallback: PageSize): PageSize => {
  const value = getQueryNumber(key, fallback);
  return PAGE_SIZE_OPTIONS.includes(value as PageSize) ? value as PageSize : fallback;
};

const getQueryBoolean = (key: string): boolean => getQueryParam(key) === '1';

const getInitialTaskQueueFilter = (): TaskQueueFilter => {
  const value = getQueryParam('tasks.status');
  return TASK_QUEUE_FILTERS.includes(value as TaskQueueFilter) ? value as TaskQueueFilter : 'all';
};

const getInitialTaskFilters = (): TaskFilters => ({
  taskType: getQueryList('tasks.type').filter((value): value is TaskTypeFilter => TASK_TYPE_FILTERS.includes(value as TaskTypeFilter)),
  dateRange: getQueryList('tasks.date').filter((value): value is TaskDateRange => TASK_DATE_RANGES.includes(value as TaskDateRange)),
  subtitleLanguage: getQueryList('tasks.lang'),
  sceneDetector: getQueryList('tasks.detector'),
  selectedDirectoryIds: getQueryList('tasks.dirs'),
  directoryExclude: getQueryBoolean('tasks.dirExclude'),
});

const getInitialTaskSortField = (): TaskSortField | undefined => {
  const value = getQueryParam('tasks.sort');
  return TASK_SORT_FIELDS.includes(value as TaskSortField) ? value as TaskSortField : undefined;
};

const getInitialSortDirection = (key: string): 'asc' | 'desc' | undefined => {
  const value = getQueryParam(key);
  return SORT_DIRECTIONS.includes(value as 'asc' | 'desc') ? value as 'asc' | 'desc' : undefined;
};

const setListParam = (params: URLSearchParams, key: string, values: string[]) => {
  if (values.length) {
    params.set(key, values.join(','));
  } else {
    params.delete(key);
  }
};

const setStringParam = (params: URLSearchParams, key: string, value: string, fallback = '') => {
  if (value !== fallback) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
};

const setNumberParam = (params: URLSearchParams, key: string, value: number, fallback: number) => {
  if (value !== fallback) {
    params.set(key, String(value));
  } else {
    params.delete(key);
  }
};

const setBooleanParam = (params: URLSearchParams, key: string, value: boolean) => {
  if (value) {
    params.set(key, '1');
  } else {
    params.delete(key);
  }
};

export function computeRerunOverwriteFlags(task: Task) {
  // For queued/processing/completed tasks, preserve original flags
  if (task.status !== 'failed' && task.status !== 'cancelled') {
    return {
      overwrite_scenes: task.overwrite_scenes ?? false,
      overwrite_split: task.overwrite_split ?? false,
      overwrite_subtitles: task.overwrite_subtitles ?? false,
    };
  }

  const taskTypeStr = task.type.toLowerCase();
  const includesScene = taskTypeStr.includes('scene') || taskTypeStr.includes('all');
  const includesSplit = taskTypeStr.includes('split') || taskTypeStr.includes('all');
  const includesSubtitle = taskTypeStr.includes('subtitle') || taskTypeStr.includes('all');

  // Cancelled tasks: always overwrite all included stages (task was interrupted)
  if (task.status === 'cancelled') {
    return {
      overwrite_scenes: includesScene || (task.overwrite_scenes ?? false),
      overwrite_split: includesSplit || (task.overwrite_split ?? false),
      overwrite_subtitles: includesSubtitle || (task.overwrite_subtitles ?? false),
    };
  }

  // Failed task: only overwrite incomplete stages (progress < 100)
  return {
    overwrite_scenes: (includesScene && task.scene_progress < 100) || (task.overwrite_scenes ?? false),
    overwrite_split: (includesSplit && task.split_progress < 100) || (task.overwrite_split ?? false),
    overwrite_subtitles: (includesSubtitle && task.subtitle_progress < 100) || (task.overwrite_subtitles ?? false),
  };
}

interface DashboardProps {
  tab: AppTab;
  setTab: (tab: AppTab) => void;
  statsMinimized: boolean;
  highlightedTaskId?: string | null;
  highlightedFileId?: string | null;
}

export const Dashboard = ({ tab, setTab, statsMinimized, highlightedTaskId, highlightedFileId }: DashboardProps) => {
  const normalizeLayoutMode = (mode: 'grid' | 'list' | 'tree'): 'grid' | 'tree' => (
    mode === 'tree' ? 'tree' : 'grid'
  );
  const queryClient = useQueryClient();
  const { settings, patchSettings } = useSettings();
  const [directoryTree, setDirectoryTree] = useState<Directory | null>(null)
  const [directories, setDirectories] = useState<Directory[]>([])
  const { data: taskFilterDirectoriesData } = useQuery({
    queryKey: ['directories'],
    queryFn: () => fileApi.getDirectories(),
    staleTime: 30_000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const taskFilterDirectories: DirectoryRecord[] = taskFilterDirectoriesData ?? [];
  const [fileSearchQuery, setFileSearchQuery] = useState(() => getQueryParam('q') ?? getQueryParam('files.q') ?? '')
  const [pendingScraperActressName, setPendingScraperActressName] = useState<string | null>(null)
  const { data: stats } = useStats(tab !== 'actresses' && tab !== 'logs' && tab !== 'stats' && tab !== 'deleted-history' && tab !== 'tools');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [monitoringDirectory, setMonitoringDirectory] = useState<Directory | null>(null);
  const [selectedFileForInfo, setSelectedFileForInfo] = useState<File | Directory | null>(null);
  const [isFileInfoModalOpen, setIsFileInfoModalOpen] = useState(false);
  const [groupedFiles, setGroupedFiles] = useState<File[]>([]);
  const [isGroupedFilesModalOpen, setIsGroupedFilesModalOpen] = useState(false);
  const [selectedGroupFiles, setSelectedGroupFiles] = useState<File[] | null>(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [taskQueueFilter, setTaskQueueFilter] = useState<TaskQueueFilter>(getInitialTaskQueueFilter);
  const [taskQueuePage, setTaskQueuePage] = useState(() => getQueryNumber('tasks.page', 1));
  const [taskQueuePageSize, setTaskQueuePageSize] = useState(() => getQueryNumber('tasks.pageSize', 25));
  const [taskQueueAdvancedFilters, setTaskQueueAdvancedFilters] = useState<TaskFilters>(getInitialTaskFilters);
  const [taskQueueSortField, setTaskQueueSortField] = useState<TaskSortField | undefined>(getInitialTaskSortField);
  const [taskQueueSortDirection, setTaskQueueSortDirection] = useState<'asc' | 'desc' | undefined>(() => getInitialSortDirection('tasks.dir'));
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [bulkEditTasks, setBulkEditTasks] = useState<Task[]>([]);
  const [bulkRunProgress, setBulkRunProgress] = useState<{
    open: boolean;
    total: number;
    done: number;
    queued: number;
    skipped: number;
    cancelling: boolean;
  }>({ open: false, total: 0, done: 0, queued: 0, skipped: 0, cancelling: false });
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<{
    open: boolean;
    total: number;
    done: number;
    failed: number;
  }>({ open: false, total: 0, done: 0, failed: 0 });
  const [bulkMonitorEditProgress, setBulkMonitorEditProgress] = useState<{
    open: boolean;
    total: number;
    done: number;
    failed: number;
  }>({ open: false, total: 0, done: 0, failed: 0 });
  const bulkRunCancelledRef = useRef(false);
  const [layoutMode, setLayoutMode] = useState<'grid' | 'tree'>(normalizeLayoutMode(settings.default_layout));
  const [taskQueueSearch, setTaskQueueSearch] = useState(() => getQueryParam('tasks.q') ?? '');
  const [rerunSourceTask, setRerunSourceTask] = useState<Task | null>(null);
  const handleLayoutChange = (mode: 'grid' | 'tree') => {
    setLayoutMode(mode)
    patchSettings({ default_layout: mode })
  }
  useEffect(() => {
    setLayoutMode(normalizeLayoutMode(settings.default_layout))
  }, [settings.default_layout])

  useEffect(() => {
    if (tab !== 'tasks') return;
    const url = new URL(window.location.href);
    const params = url.searchParams;
    setStringParam(params, 'tasks.status', taskQueueFilter, 'all');
    setStringParam(params, 'tasks.q', taskQueueSearch);
    setNumberParam(params, 'tasks.page', taskQueuePage, 1);
    setNumberParam(params, 'tasks.pageSize', taskQueuePageSize, 25);
    setListParam(params, 'tasks.type', taskQueueAdvancedFilters.taskType);
    setListParam(params, 'tasks.date', taskQueueAdvancedFilters.dateRange);
    setListParam(params, 'tasks.lang', taskQueueAdvancedFilters.subtitleLanguage);
    setListParam(params, 'tasks.detector', taskQueueAdvancedFilters.sceneDetector);
    setListParam(params, 'tasks.dirs', taskQueueAdvancedFilters.selectedDirectoryIds);
    setBooleanParam(params, 'tasks.dirExclude', taskQueueAdvancedFilters.directoryExclude);
    if (taskQueueSortField) {
      params.set('tasks.sort', taskQueueSortField);
    } else {
      params.delete('tasks.sort');
    }
    if (taskQueueSortDirection) {
      params.set('tasks.dir', taskQueueSortDirection);
    } else {
      params.delete('tasks.dir');
    }
    window.history.replaceState(window.history.state, '', url);
  }, [tab, taskQueueFilter, taskQueueSearch, taskQueuePage, taskQueuePageSize, taskQueueAdvancedFilters, taskQueueSortField, taskQueueSortDirection])

  useEffect(() => {
    if (highlightedTaskId) {
      setTaskQueueFilter('all')
    }
  }, [highlightedTaskId])

  useEffect(() => {
    if (highlightedFileId) {
      setFileSearchQuery('')
    }
  }, [highlightedFileId])

  // React Query hooks for task management
  const tasksQuery = useTasks({
    filter: taskQueueFilter,
    page: taskQueuePage,
    pageSize: taskQueuePageSize,
    search: taskQueueSearch || undefined,
    taskFilters: taskQueueAdvancedFilters,
    enabled: tab === 'tasks',
  })
  const cancelTaskMutation = useCancelTask()
  const deleteTaskMutation = useDeleteTask()
  const rerunTaskMutation = useRerunTask()
  const pauseTaskMutation = usePauseTask()
  const unpauseTaskMutation = useUnpauseTask()
  const bulkPauseTasksMutation = useBulkPauseTasks()
  const bulkUnpauseTasksMutation = useBulkUnpauseTasks()
  const reorderTasksMutation = useReorderTasks()

  // Track previous tasks to detect completed task transitions
  const previousTasksRef = React.useRef<Task[]>([]);

  const {
    monitors,
    setMonitors,
    fetchMonitors,
    handleCreateMonitors,
    handleRunMonitorNow,
    handleDeleteMonitor,
    isMonitorDialogOpen,
    setIsMonitorDialogOpen,
    isEditDialogOpen,
    setIsEditDialogOpen,
    editingMonitor,
    setEditingMonitor,
    handleToggleMonitorActive,
    handleBulkToggleActive,
    handleBulkDelete,
    handleBulkUpdate,
    handleBulkRunNow,
    handleEditMonitor,
    handleUpdateMonitor,
  } = useMonitorActions(setTab, () => { }, () => {
    queryClient.invalidateQueries({ queryKey: ['stats'] })
  });

  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);

  const {
    paginatedMonitors,
    selectedIds,
    sortField,
    sortDirection,
    filteredMonitors,
    pageSize,
    currentPage,
    totalPages,
    allSelected,
    toggleSelect,
    selectAll,
    clearSelection,
    rangeSelect,
    setSortField,
    toggleSortDirection,
    setPageSize,
    setCurrentPage,
    searchQuery: monitorSearchQuery,
    setSearchQuery: setMonitorSearchQuery,
  } = useDirectoryMonitorList(monitors, {
    initialPage: getQueryNumber('monitors.page', 1),
    initialPageSize: getQueryPageSize('monitors.pageSize', 25),
  });

  useEffect(() => {
    if (tab !== 'monitors') return;
    const url = new URL(window.location.href);
    const params = url.searchParams;
    setNumberParam(params, 'monitors.page', currentPage, 1);
    setNumberParam(params, 'monitors.pageSize', pageSize, 25);
    window.history.replaceState(window.history.state, '', url);
  }, [tab, currentPage, pageSize])

  /**
   * Switches to the Task Queue tab and applies the status filter matching the clicked stat card.
   * @param filter - Queue filter aligned with dashboard statistics
   */
  const openTaskQueueWithFilter = (filter: TaskQueueFilter): void => {
    setTab('tasks');
    setTaskQueueFilter(filter);
  };

  const handleTaskQueueSearchChange = (query: string): void => {
    setTaskQueueSearch(query);
    setTaskQueuePage(1);
  };

  const handleCreateTask = async (taskData: Omit<Task, 'id' | 'createdAt'>) => {
    const newTask: Task = {
      ...taskData,
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: new Date(),
    };

    try {
      const response = await taskApi.addTaskVideo(newTask);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      if (!response.duplicate) {
        toast.success('Task created successfully');
      }
    } catch (err) {
      toast.error('Failed to add video');
    }
  };

  const handleCancelTask = async (taskId: string): Promise<void> => {
    try {
      await cancelTaskMutation.mutateAsync(taskId)
      queryClient.invalidateQueries({ queryKey: ['stats'] })
    } catch {
      toast.error('Failed to cancel task')
    }
  }

  const handleRerunTask = async (task: Task): Promise<void> => {
    setRerunSourceTask(task);
  }

  const handleBulkRerunTasks = async (tasks: Task[]): Promise<void> => {
    let succeeded = 0;
    for (const task of tasks) {
      const overwriteFlags = computeRerunOverwriteFlags(task);
      const newTask: Task = {
        ...task,
        ...overwriteFlags,
        id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: new Date(),
        status: 'queued',
      };
      try {
        await deleteTaskMutation.mutateAsync(task.id);
        const response = await taskApi.addTaskVideo(newTask);
        if (!response.duplicate) {
          succeeded++;
        }
      } catch {
        toast.error(`Failed to requeue: ${task.file?.name ?? task.id}`);
      }
    }
    if (succeeded > 0) {
      toast.success(`${succeeded} task${succeeded > 1 ? 's' : ''} requeued`);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    }
  }

  const handleConfirmRerun = async (taskData: Omit<Task, 'id' | 'createdAt'>) => {
    if (!rerunSourceTask) return;
    const newTask: Task = {
      ...taskData,
      id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: new Date(),
    };
    try {
      await deleteTaskMutation.mutateAsync(rerunSourceTask.id);
      const response = await taskApi.addTaskVideo(newTask);
      if (!response.duplicate) {
        toast.success('Task requeued');
      }
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    } catch {
      toast.error('Failed to rerun task');
    } finally {
      setRerunSourceTask(null);
    }
  }

  const handleEditTaskCreate = async (taskData: Omit<Task, 'id' | 'createdAt'>): Promise<void> => {
    if (!editTask) return
    try {
      await deleteTaskMutation.mutateAsync(editTask.id)
    } catch {
      toast.error('Could not delete original task — edit aborted. Try deleting it manually first.')
      return
    }
    await handleCreateTask(taskData)

    if (bulkEditTasks.length > 0) {
      setEditTask(bulkEditTasks[0])
      setBulkEditTasks(prev => prev.slice(1))
    } else {
      setEditTask(null)
    }
  }

  const handleBulkEditStart = (tasks: Task[]) => {
    if (tasks.length === 0) return
    setEditTask(tasks[0])
    setBulkEditTasks(tasks.slice(1))
  }

  const handleDeleteTask = async (taskId: string, silent = false) => {
    try {
      await deleteTaskMutation.mutateAsync(taskId);
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      if (!silent) toast.success('Task deleted');
    } catch (err) {
      if (!silent) toast.error('Failed to delete task');
    }
  };

  const handleBulkDeleteTasks = async (tasks: Task[]) => {
    setBulkDeleteProgress({ open: true, total: tasks.length, done: 0, failed: 0 });
    let failed = 0;
    await Promise.allSettled(tasks.map(t =>
      taskApi.deleteTask(t.id)
        .then(() => setBulkDeleteProgress(p => ({ ...p, done: p.done + 1 })))
        .catch(() => { failed++; setBulkDeleteProgress(p => ({ ...p, done: p.done + 1, failed: p.failed + 1 })); })
    ));
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const handlePauseTask = (taskId: string) => pauseTaskMutation.mutate(taskId);
  const handleUnpauseTask = (taskId: string) => unpauseTaskMutation.mutate(taskId);
  const handleBulkPauseTasks = (taskIds: string[]) => bulkPauseTasksMutation.mutateAsync(taskIds);
  const handleBulkUnpauseTasks = (taskIds: string[]) => bulkUnpauseTasksMutation.mutateAsync(taskIds);
  const handleMoveToTop = (taskIds: string[]) => reorderTasksMutation.mutate({ taskIds, position: 'top' });
  const handleMoveToBottom = (taskIds: string[]) => reorderTasksMutation.mutate({ taskIds, position: 'bottom' });

  const handleToggleTaskTypeDisabled = async (fileId: string, taskType: 'split' | 'subtitle') => {
    try {
      const task = tasksQuery.data?.tasks?.find(t => t.file?.id === fileId);
      const disabled = taskType === 'split' ? task?.file?.split_disabled : task?.file?.subtitle_disabled;
      if (disabled) {
        await fileApi.bulkEnableTaskType(taskType, [fileId]);
      } else {
        await fileApi.bulkDisableTaskType(taskType, [fileId]);
      }
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success(`File ${taskType} status updated`);
    } catch (err) {
      toast.error(`Failed to toggle ${taskType} disabled`);
    }
  };

  const hasActiveTasks = tasksQuery.data?.tasks?.some(t => t.status === 'processing' || t.status === 'queued') ?? false;


  // Load monitors
  useEffect(() => {
    fetchMonitors();
  }, []);

  // Detect task status changes to trigger file rescans and immediate stat updates
  useEffect(() => {
    const currentTasks = tasksQuery.data?.tasks ?? [];
    if (currentTasks.length > 0 && previousTasksRef.current.length > 0) {
      const hasStatusChange = currentTasks.some(task =>
        previousTasksRef.current.some(prevTask =>
          prevTask.id === task.id && prevTask.status !== task.status
        )
      );

      if (hasStatusChange) {
        queryClient.invalidateQueries({ queryKey: ['stats'] });

        const hasNewlyCompletedTask = currentTasks.some(task =>
          task.status === 'completed' &&
          previousTasksRef.current.some(prevTask =>
            prevTask.id === task.id && prevTask.status !== 'completed'
          )
        );
        if (hasNewlyCompletedTask) {
          queryClient.invalidateQueries({ queryKey: ['files'] });
        }
      }
    }

    // Update the reference with current tasks
    previousTasksRef.current = currentTasks;
  }, [tasksQuery.data?.tasks]);

  return (
    <div className="flex min-h-0 w-full flex-1 gap-2 px-2 pb-1 sm:gap-4">

      {/* Background glow effects */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-primary/3 rounded-full blur-3xl" />
      </div>

      <div className="w-full flex flex-col relative gap-4">
        {stats && !statsMinimized && tab !== 'stats' && tab !== 'scraper' && tab !== 'tools' && (
          <div className={tab === 'tasks' ? 'hidden sm:block' : undefined}>
            <DashboardStats stats={stats} openTaskQueueWithFilter={openTaskQueueWithFilter} />
          </div>
        )}


        <div className="flex min-h-0 w-full grow flex-col gap-3 p-0 sm:gap-4 sm:p-2" tabIndex={-1}>
          <Tabs value={tab} onValueChange={(value) => setTab(value as AppTab)} className="h-full flex flex-col">
            {/* File Browser Section */}
            <TabsContent value="files" className={`${tab === 'files' ? 'h-full flex flex-col m-0 overflow-hidden' : 'flex-1 overflow-hidden mt-0'}`}>
              <FileBrowserTab
                layoutMode={layoutMode}
                fileSearchQuery={fileSearchQuery}
                searchFocused={searchFocused}
                selectedFiles={selectedFiles}
                setSelectedFiles={setSelectedFiles}
                setLayoutMode={handleLayoutChange}
                setFileSearchQuery={setFileSearchQuery}
                setSelectedFileForInfo={setSelectedFileForInfo}
                setIsFileInfoModalOpen={setIsFileInfoModalOpen}
                setIsDialogOpen={setIsDialogOpen}
                setSearchFocused={setSearchFocused}
                setSelectedGroupFiles={setSelectedGroupFiles}
                setIsGroupModalOpen={setIsGroupModalOpen}
                highlightFileId={highlightedFileId}
                isActive={tab === 'files'}
              />
            </TabsContent>

            {/* Directory Monitors Section */}
            <TabsContent value="monitors" className={`${tab === 'monitors' ? 'h-full flex flex-col m-0 overflow-hidden' : 'flex-1 overflow-hidden mt-0'}`}>
              <DirectoryMonitorTab
                directories={directories}
                monitors={paginatedMonitors}
                totalMonitors={filteredMonitors.length}
                pageSize={pageSize}
                currentPage={currentPage}
                totalPages={totalPages}
                onPageSizeChange={setPageSize}
                onPageChange={setCurrentPage}
                selectedIds={selectedIds}
                sortField={sortField}
                sortDirection={sortDirection}
                allSelected={allSelected}
                onSelectMonitor={toggleSelect}
                onRangeSelect={rangeSelect}
                onSortFieldChange={setSortField}
                onToggleSortDirection={toggleSortDirection}
                onSelectAll={selectAll}
                onClearSelection={clearSelection}
                onToggleActive={handleToggleMonitorActive}
                onDelete={handleDeleteMonitor}
                onRunNow={async (path) => {
                  setBulkRunProgress({ open: true, total: 1, done: 0, queued: 0, skipped: 0, cancelling: false });
                  try {
                    const result = await handleRunMonitorNow(path, { silent: true });
                    setBulkRunProgress({ open: true, total: 1, done: 1, queued: result.queued, skipped: result.skipped, cancelling: false });
                    return result;
                  } catch {
                    setBulkRunProgress((p) => ({ ...p, open: false }));
                    return { queued: 0, skipped: 0 };
                  }
                }}
                onEdit={handleEditMonitor}
                onAddMonitor={() => setIsMonitorDialogOpen(true)}
                onBulkEnable={async () => { await handleBulkToggleActive(Array.from(selectedIds), true); clearSelection(); }}
                onBulkDisable={async () => { await handleBulkToggleActive(Array.from(selectedIds), false); clearSelection(); }}
                onBulkDelete={async () => { await handleBulkDelete(Array.from(selectedIds)); clearSelection(); }}
                onBulkEdit={() => setIsBulkEditOpen(true)}
                searchQuery={monitorSearchQuery}
                onSearchChange={setMonitorSearchQuery}
                onBulkRunNow={async () => {
                  const ids = monitors
                    .filter((monitor) => selectedIds.has(monitor.id) && monitor.isActive)
                    .map((monitor) => monitor.id);
                  if (ids.length === 0) return;
                  bulkRunCancelledRef.current = false;
                  setBulkRunProgress({ open: true, total: ids.length, done: 0, queued: 0, skipped: 0, cancelling: false });
                  await handleBulkRunNow(
                    ids,
                    (done, total, queued, skipped) => {
                      setBulkRunProgress((p) => ({ open: true, total, done, queued, skipped, cancelling: p.cancelling }));
                    },
                    () => bulkRunCancelledRef.current,
                  );
                  setBulkRunProgress((p) => ({ ...p, done: p.total, cancelling: false }));
                }}
              />
            </TabsContent>

            <TabsContent value="deleted-history" className={`${tab === 'deleted-history' ? 'h-full flex flex-col m-0 overflow-hidden' : 'flex-1 overflow-hidden mt-0'}`}>
              <DeletedHistoryTab />
            </TabsContent>

            {/* Task Queue Section */}
            <TabsContent value="tasks" className={`${tab === 'tasks' ? 'h-full flex flex-col m-0 overflow-hidden' : 'flex-1 overflow-hidden mt-0'}`}>
              <TaskQueue
                tasks={tasksQuery.data?.tasks ?? []}
                isLoading={tasksQuery.isLoading || tasksQuery.isPlaceholderData || (tasksQuery.data !== undefined && tasksQuery.data.skip !== (taskQueuePage - 1) * taskQueuePageSize)}
                activeFilter={taskQueueFilter}
                onActiveFilterChange={setTaskQueueFilter}
                currentPage={taskQueuePage}
                pageSize={taskQueuePageSize}
                onPageChange={setTaskQueuePage}
                onPageSizeChange={setTaskQueuePageSize}
                onCancelTask={handleCancelTask}
                onDeleteTask={handleDeleteTask}
                onBulkDeleteTasks={handleBulkDeleteTasks}
                onRerunTask={handleRerunTask}
                onBulkRerunTasks={handleBulkRerunTasks}
                onEditTask={setEditTask}
                onBulkEditTasks={handleBulkEditStart}
                onPauseTask={handlePauseTask}
                onUnpauseTask={handleUnpauseTask}
                onBulkPauseTasks={handleBulkPauseTasks}
                onBulkUnpauseTasks={handleBulkUnpauseTasks}
                onMoveToTop={handleMoveToTop}
                onMoveToBottom={handleMoveToBottom}
                onToggleTaskTypeDisabled={handleToggleTaskTypeDisabled}
                highlightTaskId={highlightedTaskId}
                totalCount={tasksQuery.data?.total ?? 0}
                searchQuery={taskQueueSearch}
                onSearchChange={handleTaskQueueSearchChange}
                sortField={taskQueueSortField}
                sortDirection={taskQueueSortDirection}
                onSortFieldChange={setTaskQueueSortField}
                onSortDirectionChange={setTaskQueueSortDirection}
                appliedFilters={taskQueueAdvancedFilters}
                onAppliedFiltersChange={setTaskQueueAdvancedFilters}
                directories={taskFilterDirectories}
                stats={stats}
                onRefresh={async (filter) => {
                  await tasksQuery.refetch();
                }}
              />
            </TabsContent>

            {/* Stats Section */}
            <TabsContent value="stats" className={`${tab === 'stats' ? 'h-full flex flex-col m-0 overflow-hidden' : 'flex-1 overflow-hidden mt-0'}`}>
              <StatsTab />
            </TabsContent>

            <TabsContent value="logs" className={`${tab === 'logs' ? 'h-full flex flex-col m-0 overflow-hidden' : 'flex-1 overflow-hidden mt-0'}`}>
              <LogsTab />
            </TabsContent>

            <TabsContent value="actresses" className={`${tab === 'actresses' ? 'h-full flex flex-col m-0 overflow-hidden' : 'flex-1 overflow-hidden mt-0'}`}>
              <ActressTab onAddScraper={(actressName) => {
                setPendingScraperActressName(actressName)
                setTab('scraper')
              }} />
            </TabsContent>

            <TabsContent value="scraper" className={`${tab === 'scraper' ? 'h-full flex flex-col m-0 overflow-hidden' : 'flex-1 overflow-hidden mt-0'}`}>
              <ScraperTab
                requestedActressName={pendingScraperActressName}
                onRequestedActressNameHandled={() => setPendingScraperActressName(null)}
              />
            </TabsContent>

            <TabsContent value="tools" className={`${tab === 'tools' ? 'h-full flex flex-col m-0 overflow-hidden' : 'flex-1 overflow-hidden mt-0'}`}>
              <ToolsTab />
            </TabsContent>

          </Tabs>
        </div>

        <BulkProgressDialog
          open={bulkRunProgress.open}
          total={bulkRunProgress.total}
          done={bulkRunProgress.done}
          runningTitle={bulkRunProgress.total === 1 ? 'Running monitor…' : `Running monitors… (${bulkRunProgress.done} / ${bulkRunProgress.total})`}
          doneTitle={bulkRunProgress.total === 1 ? 'Monitor complete' : 'Monitors complete'}
          cancelling={bulkRunProgress.cancelling}
          onClose={() => setBulkRunProgress((p) => ({ ...p, open: false }))}
          onCancel={() => { bulkRunCancelledRef.current = true; setBulkRunProgress((p) => ({ ...p, cancelling: true })); }}
        >
          {bulkRunProgress.done < bulkRunProgress.total && (
            <div className="flex gap-6 text-sm text-muted-foreground">
              <span><span className="font-medium text-foreground">{bulkRunProgress.queued}</span> tasks queued</span>
              <span><span className="font-medium text-foreground">{bulkRunProgress.skipped}</span> files skipped</span>
            </div>
          )}
        </BulkProgressDialog>

        <BulkProgressDialog
          open={bulkDeleteProgress.open}
          total={bulkDeleteProgress.total}
          done={bulkDeleteProgress.done}
          failed={bulkDeleteProgress.failed}
          runningTitle={`Deleting tasks… (${bulkDeleteProgress.done} / ${bulkDeleteProgress.total})`}
          doneTitle={`Deleted ${bulkDeleteProgress.total - bulkDeleteProgress.failed} of ${bulkDeleteProgress.total} task${bulkDeleteProgress.total !== 1 ? 's' : ''}`}
          onClose={() => setBulkDeleteProgress((p) => ({ ...p, open: false }))}
        />

        <BulkProgressDialog
          open={bulkMonitorEditProgress.open}
          total={bulkMonitorEditProgress.total}
          done={bulkMonitorEditProgress.done}
          failed={bulkMonitorEditProgress.failed}
          runningTitle={`Updating monitors… (${bulkMonitorEditProgress.done} / ${bulkMonitorEditProgress.total})`}
          doneTitle={`Updated ${bulkMonitorEditProgress.total - bulkMonitorEditProgress.failed} of ${bulkMonitorEditProgress.total} monitor${bulkMonitorEditProgress.total !== 1 ? 's' : ''}`}
          onClose={() => setBulkMonitorEditProgress((p) => ({ ...p, open: false }))}
        />

        {/* Monitor Bulk Edit Dialog */}
        {isBulkEditOpen && (
          <MonitorBulkEditDialog
            open={isBulkEditOpen}
            selectedCount={selectedIds.size}
            onOpenChange={setIsBulkEditOpen}
            onApply={async (patch) => {
              const ids = Array.from(selectedIds);
              setBulkMonitorEditProgress({ open: true, total: ids.length, done: 0, failed: 0 });
              await handleBulkUpdate(ids, patch, (done, total, failed) =>
                setBulkMonitorEditProgress({ open: true, total, done, failed })
              );
              clearSelection();
            }}
          />
        )}

        {/* Directory Monitor Dialog */}
        {isMonitorDialogOpen && <DirectoryMonitorDialog
          open={isMonitorDialogOpen}
          onOpenChange={(open) => {
            setIsMonitorDialogOpen(open);
            // Clear the monitoring directory when dialog is closed
            if (!open) {
              setMonitoringDirectory(null);
            }
          }}
          monitors={monitors}
          onCreateMonitors={handleCreateMonitors}
          monitoringDirectory={monitoringDirectory}
        />}

        {/* Directory Monitor Edit Dialog */}
        {isEditDialogOpen && editingMonitor && <DirectoryMonitorEditDialog
          monitor={editingMonitor}
          open={isEditDialogOpen}
          onOpenChange={(open) => {
            setIsEditDialogOpen(open);
            // Clear the editing monitor when dialog is closed
            if (!open) {
              setEditingMonitor(null);
            }
          }}
          onUpdate={handleUpdateMonitor}
        />}

        {/* File Info Modal */}
        {selectedFileForInfo && (
          <FileModal
            file={selectedFileForInfo}
            isOpen={isFileInfoModalOpen}
            onClose={() => setIsFileInfoModalOpen(false)}
          />
        )}

        {/* Group Modal from FileBrowser */}
        {isGroupModalOpen && (
          <FileGroupModal
            files={selectedGroupFiles || []}
            setFiles={setSelectedGroupFiles as any}
            isOpen={isGroupModalOpen}
            onClose={() => setIsGroupModalOpen(false)}
            onCreateTaskForOrigin={(file) => {
              setSelectedFiles([file]);
              setIsDialogOpen(true);
            }}
          />
        )}

        {/* Grouped Files Modal */}
        {isGroupedFilesModalOpen && (
          <FileGroupModal
            files={groupedFiles}
            setFiles={setGroupedFiles}
            isOpen={isGroupedFilesModalOpen}
            onClose={() => setIsGroupedFilesModalOpen(false)}
            onCreateTaskForOrigin={(file) => {
              setSelectedFile(file);
              setIsDialogOpen(true);
            }}
          />
        )}
      </div>

      <TaskDialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          // Clear selections when dialog is closed
          if (!open) {
            setSelectedFiles([]);
          }
        }}
        selectedFile={selectedFile}
        setSelectedFile={setSelectedFile}
        selectedFiles={selectedFiles}
        tasks={tasksQuery.data?.tasks ?? []}
        onCreateTask={handleCreateTask}
        onTaskCreated={() => queryClient.invalidateQueries({ queryKey: ['stats'] })}
        directoryTree={directoryTree}
      />

      {editTask && (
        <TaskDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setEditTask(null)
              setBulkEditTasks([])
            }
          }}
          selectedFile={editTask.file}
          tasks={tasksQuery.data?.tasks ?? []}
          onCreateTask={handleEditTaskCreate}
          onTaskCreated={() => queryClient.invalidateQueries({ queryKey: ['stats'] })}
          initialTaskType={editTask.type}
          initialLanguage={editTask.subtitleLanguage
            ? (LANGUAGE_CODE_TO_NAME[editTask.subtitleLanguage] ?? editTask.subtitleLanguage)
            : undefined}
          initialNvencOverwriteOriginal={editTask.nvenc_overwrite_original}
        />
      )}

      {rerunSourceTask && (
        <TaskDialog
          open={!!rerunSourceTask}
          onOpenChange={(open) => { if (!open) setRerunSourceTask(null) }}
          selectedFile={rerunSourceTask.file}
          tasks={tasksQuery.data?.tasks ?? []}
          onCreateTask={handleConfirmRerun}
          onTaskCreated={() => queryClient.invalidateQueries({ queryKey: ['stats'] })}
          initialTaskType={rerunSourceTask.type}
          initialLanguage={rerunSourceTask.subtitleLanguage
            ? (LANGUAGE_CODE_TO_NAME[rerunSourceTask.subtitleLanguage] ?? rerunSourceTask.subtitleLanguage)
            : undefined}
          initialOverwriteScenes={computeRerunOverwriteFlags(rerunSourceTask).overwrite_scenes}
          initialOverwriteSplit={computeRerunOverwriteFlags(rerunSourceTask).overwrite_split}
          initialOverwriteSubtitles={computeRerunOverwriteFlags(rerunSourceTask).overwrite_subtitles}
          initialDeleteVideoAfterCompletion={rerunSourceTask.delete_video_after_completion}
          initialNvencOverwriteOriginal={rerunSourceTask.nvenc_overwrite_original}
          initialSceneDetector={rerunSourceTask.scene_detector}
          dialogTitle="Rerun"
          submitLabel="Rerun Task"
          isRerun
        />
      )}
    </div>
  );
};
