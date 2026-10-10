import { Clock, CheckCircle2, AlertCircle, Loader2, Scissors, Subtitles, Delete, FileText, ClockIcon, MoreVertical, ScanSearch, Film, Folder, Pause, Play, Monitor, Copy, Check, Ban, RefreshCcw, Shuffle, SearchCheck } from 'lucide-react';
import { Task } from '@/types/types';
import { cn, copyTextToClipboard, formatFileSize } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from './ui/context-menu';
import { ViewResultsDialog } from './ViewResultsDialog';
import { SceneViewerModal } from './SceneViewerModal';
import { ErrorMessage } from './ErrorMessage';
import { TaskLogsDialog } from './TaskLogsDialog';

interface TaskCardProps {
  task: Task;
  isSelected?: boolean;
  onSelect?: (id: string, selected: boolean, e: React.MouseEvent) => void;
  onCancelTask?: (taskId: string) => void;
  onDeleteTask?: (taskId: string) => void;
  onRerunTask?: (task: Task) => void;
  onEditTask?: (task: Task) => void;
  onPauseTask?: (taskId: string) => void;
  onUnpauseTask?: (taskId: string) => void;
  onMoveToTop?: (taskId: string) => void;
  onMoveToBottom?: (taskId: string) => void;
  onToggleTaskTypeDisabled?: (fileId: string, taskType: 'split' | 'subtitle') => Promise<void>;
  queuePosition?: number;
  avgProcessingSeconds?: number;
  estimatedSeconds?: number;
  compact?: boolean;
}

const statusConfig = {
  queued: {
    icon: Clock,
    label: 'Queued',
    color: 'text-muted-foreground',
    bg: 'bg-muted',
  },
  processing: {
    icon: Loader2,
    label: 'Processing',
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    color: 'text-success',
    bg: 'bg-success/10',
  },
  failed: {
    icon: AlertCircle,
    label: 'Failed',
    color: 'text-destructive',
    bg: 'bg-destructive/10',
  },
  cancelled: {
    icon: Delete,
    label: 'Cancelled',
    color: 'text-destructive',
    bg: 'bg-destructive/10',
  },
  paused: {
    icon: Pause,
    label: 'Paused',
    color: 'text-yellow-600',
    bg: 'bg-yellow-300',
  },
};

const typeConfig = {
  split: { icon: Scissors, label: 'Split' },
  subtitle: { icon: Subtitles, label: 'Subtitle' },
  all: { icon: Subtitles, label: 'Split + Subtitle' },
  scene: { icon: Scissors, label: 'Scene Detect' },
  merge: { icon: Film, label: 'Merge' },
  analyze_frame_pacing: { icon: SearchCheck, label: 'Analyze + Frame Pacing Repair' },
  nvenc_frame_pacing: { icon: RefreshCcw, label: 'Frame Pacing Repair' },
  remux: { icon: Shuffle, label: 'Remux' },
};

const formatDate = (date: string | Date) => {
  const d = date instanceof Date ? date : parseUtcDate(date);

  const pad = (n: number) => String(n).padStart(2, "0");

  let hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";

  hours = hours % 12 || 12; // convert 0 → 12

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzAbbr = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(d)
    .find(p => p.type === 'timeZoneName')?.value ?? '';

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(hours)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm} ${tzAbbr}`;
}

const parseUtcDate = (s: string | Date): Date =>
  s instanceof Date ? s : new Date(/[Z+]/.test(s.slice(10)) ? s : s + 'Z');

const formatElapsedSeconds = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatEtaSeconds = (seconds: number): string => {
  const safe = Math.max(0, Math.ceil(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  if (h > 0) return `~${h}h ${m}m`
  if (m > 0) return `~${m}m ${s}s`
  return `~${s}s`
}

const parseMergeInputPaths = (pathsStr: string | undefined): string[] => {
  if (!pathsStr) return [];
  try {
    const parsed = JSON.parse(pathsStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return pathsStr.split('|').filter(p => p.length > 0);
  }
};

const getFileNameFromPath = (path: string): string => {
  return path.split(/[\\/]/).pop() || path;
};

const getCopyableTaskName = (name: string): string => {
  return name.replace(/\.[^.]+$/, '');
};

const parseDurationString = (duration: string | undefined): number => {
  if (!duration) return 0;
  const parts = duration.split(':').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
};

const estimateProcessingTime = (fileDuration: string | undefined, avgSeconds: number | undefined, taskType: string): number => {
  if (!avgSeconds || avgSeconds === 0) return 0;
  const videoDurationSeconds = parseDurationString(fileDuration);
  if (videoDurationSeconds === 0) return 0;
  return Math.ceil((videoDurationSeconds / 3600) * avgSeconds);
};

export function TaskCard({ task, isSelected = false, onSelect, onCancelTask, onDeleteTask, onRerunTask, onEditTask, onPauseTask, onUnpauseTask, onMoveToTop, onMoveToBottom, onToggleTaskTypeDisabled, queuePosition, avgProcessingSeconds, estimatedSeconds, compact = false }: TaskCardProps) {
  const status = statusConfig[task.status];
  const type = typeConfig[task.type];
  const StatusIcon = status.icon;
  const TypeIcon = type.icon;
  const taskDisplayName = task.file?.name ?? (() => {
    try {
      const paths: string[] = JSON.parse(task.merge_input_paths ?? '[]')
      if (paths.length > 0) return paths[0].split(/[\\/]/).pop() ?? 'Merge Task'
    } catch { /* fall through */ }
    return 'Merge Task'
  })()
  const isRerunDisabled = task.type === 'split'
    ? task.file?.split_disabled
    : task.type === 'subtitle'
      ? task.file?.subtitle_disabled
      : task.type === 'all'
        ? task.file?.split_disabled || task.file?.subtitle_disabled
        : false;
  const [elapsedTime, setElapsedTime] = useState(0);
  const [taskCancelled, setTaskCancelled] = useState(false);
  const [viewGroupOpen, setViewGroupOpen] = useState(false);
  const [sceneViewerOpen, setSceneViewerOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [copiedFileName, setCopiedFileName] = useState(false);
  const [copiedError, setCopiedError] = useState(false);

  const copyFileName = () => {
    const fileName = getCopyableTaskName(taskDisplayName);
    copyTextToClipboard(fileName).then(() => {
      setCopiedFileName(true);
      setTimeout(() => setCopiedFileName(false), 2000);
    }).catch(() => {
      // Keep the existing UI behavior even if the shared fallback fails.
    });
  };

  const copyErrorMessage = () => {
    if (!task.error) return;
    copyTextToClipboard(task.error).then(() => {
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 2000);
    }).catch(() => {
      // Keep the existing UI behavior even if the shared fallback fails.
    });
  };

  const TaskActionMenuItems = ({
    Item,
    Separator,
  }: {
    Item: typeof DropdownMenuItem | typeof ContextMenuItem;
    Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
  }) => (
    <>
      {task.file && onToggleTaskTypeDisabled && (
        <>
          <Item onClick={(e) => { e.stopPropagation(); onToggleTaskTypeDisabled(task.file!.id, 'split'); }}>
            {task.file.split_disabled ? 'Enable for Split' : 'Disable from Split'}
          </Item>
          <Item onClick={(e) => { e.stopPropagation(); onToggleTaskTypeDisabled(task.file!.id, 'subtitle'); }}>
            {task.file.subtitle_disabled ? 'Enable for Subtitle' : 'Disable from Subtitle'}
          </Item>
          <Separator />
        </>
      )}
      {(task.type === 'scene' || task.type === 'split' || task.type === 'all') && (task.scene_count ?? 0) > 0 && (
        <Item onClick={(e) => { e.stopPropagation(); setSceneViewerOpen(true); }}>
          View Scenes
        </Item>
      )}
      {task.status === 'queued' && (
        <>
          {(onMoveToTop || onMoveToBottom) && (
            <>
              {onMoveToTop && (
                <Item onClick={(e) => { e.stopPropagation(); onMoveToTop(task.id); }}>
                  Move to Top
                </Item>
              )}
              {onMoveToBottom && (
                <Item onClick={(e) => { e.stopPropagation(); onMoveToBottom(task.id); }}>
                  Move to Bottom
                </Item>
              )}
              <Separator />
            </>
          )}
          <Item onClick={(e) => { e.stopPropagation(); onEditTask?.(task); }}>
            Edit Task Options
          </Item>
          <Item onClick={(e) => { e.stopPropagation(); setLogsOpen(true); }}>View Logs</Item>
          <Item
            className="text-destructive focus:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              if (!taskCancelled) {
                setTaskCancelled(true);
                onCancelTask?.(task.id);
              }
            }}
          >
            Cancel
          </Item>
          <Item className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteTask?.(task.id); }}>
            Delete
          </Item>
        </>
      )}
      {task.status === 'processing' && (
        <>
          <Item onClick={(e) => { e.stopPropagation(); setLogsOpen(true); }}>View Logs</Item>
          <Item
            className="text-destructive focus:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              if (!taskCancelled) {
                setTaskCancelled(true);
                onCancelTask?.(task.id);
              }
            }}
          >
            Cancel
          </Item>
        </>
      )}
      {task.status === 'completed' && (
        <>
          {(task.type === 'split' || task.type === 'subtitle' || task.type === 'all') && (
            <Item onClick={(e) => { e.stopPropagation(); setViewGroupOpen(true); }}>
              View Results
            </Item>
          )}
          <Item onClick={(e) => { e.stopPropagation(); setLogsOpen(true); }}>View Logs</Item>
          <Item className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteTask?.(task.id); }}>
            Delete
          </Item>
        </>
      )}
      {(task.status === 'failed' || task.status === 'cancelled') && (
        <>
          <Item
            onClick={(e) => { e.stopPropagation(); onRerunTask?.(task); }}
            disabled={isRerunDisabled}
            title={isRerunDisabled ? "File is disabled for this task type" : undefined}
          >
            Rerun with a New Task
          </Item>
          <Item onClick={(e) => { e.stopPropagation(); setLogsOpen(true); }}>View Logs</Item>
          <Item className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteTask?.(task.id); }}>
            Delete
          </Item>
        </>
      )}
      {task.status === 'paused' && (
        <Item className="text-destructive focus:text-destructive" onClick={(e) => { e.stopPropagation(); onDeleteTask?.(task.id); }}>
          Delete
        </Item>
      )}
    </>
  );

  useEffect(() => {
    if (task.status !== 'processing') {
      setElapsedTime(0);
      if (task.status === 'cancelled') setTaskCancelled(false);
      return;
    }

    const startMs = task.startedAt ? parseUtcDate(task.startedAt).getTime() : Date.now();
    setElapsedTime(Math.floor((Date.now() - startMs) / 1000));

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [task.status, task.startedAt]);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              'rounded-xl border transition-all duration-300 relative',
              'animate-slide-in-right group',
              !compact && 'h-full',
              isSelected
                ? 'border-primary bg-primary/5 shadow-md'
                : 'border-border bg-card/50 hover:border-primary/30 hover:bg-card hover:shadow-md',
              onSelect && 'cursor-pointer'
            )}
            onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
            onClick={(e) => {
              if (window.getSelection().toString().length === 0) {
                onSelect?.(task.id, !isSelected, e);
              }
            }}
          >
        <div className={cn("flex", !compact && "h-full")}>
          {/* Position column - queued tasks */}
          {task.status === 'queued' && (
            <div className="flex flex-col justify-center gap-1.5 px-2.5 shrink-0 min-w-max sm:gap-2 sm:px-4">
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">Position</span>
                <span className="text-base font-semibold text-foreground sm:text-lg">#{queuePosition ?? '?'}</span>
              </div>
              {(() => {
                const est = estimatedSeconds ?? estimateProcessingTime(task.file?.duration, avgProcessingSeconds, task.type);
                return est > 0 ? (
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">Est.</span>
                    <span className="text-xs font-medium text-foreground sm:text-sm">{formatEtaSeconds(est)}</span>
                  </div>
                ) : null;
              })()}
            </div>
          )}

          {/* Main content area */}
          <div className="flex flex-col flex-1 h-full min-w-0">
            {/* Header row - status, name, badges, actions */}
            <div className="flex items-center gap-2.5 border-b border-border/50 px-2.5 py-2.5 sm:gap-4 sm:px-4 sm:py-4">
              <div className={cn('rounded-lg p-2 sm:p-2.5', status.bg)}>
                <StatusIcon className={cn(
                  'h-4 w-4 sm:h-5 sm:w-5',
                  status.color,
                  task.status === 'processing' && 'animate-spin'
                )} />
              </div>

              <div className="flex-1 flex flex-col gap-1.5 sm:gap-2">
                <div className="group flex items-center gap-2">
                  <h4 className="text-sm font-semibold sm:text-base">{taskDisplayName}</h4>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 sm:h-6 sm:w-6"
                    onClick={(e) => { e.stopPropagation(); copyFileName(); }}
                    title="Copy file name"
                  >
                    {copiedFileName ? (
                      <Check className="h-3.5 w-3.5 text-success sm:h-4 sm:w-4" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    )}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {/* Type badge always shows text */}
                  <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs">
                    <TypeIcon className="mr-1 h-3 w-3" />
                    {type.label}
                  </Badge>

                  {/* Status badges - icon only to save space */}
                  {task.file?.split_disabled && (
                    <Badge variant="destructive" className="h-5 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs" title="Split Disabled">
                      <Scissors className="w-3 h-3" />
                    </Badge>
                  )}
                  {task.file?.subtitle_disabled && (
                    <Badge variant="destructive" className="h-5 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs" title="Subtitle Disabled">
                      <Ban className="w-3 h-3" />
                    </Badge>
                  )}
                  {task.file?.is_deleted && (
                    <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground sm:px-2 sm:text-xs" title="Source Deleted">
                      <Delete className="w-3 h-3" />
                    </Badge>
                  )}
                  {task.status === 'paused' && (
                    <span className='inline-flex h-5 items-center rounded-full bg-yellow-300 px-1.5 text-[10px] font-medium text-yellow-800 sm:px-2 sm:text-xs' title="Paused">
                      <Pause className='h-3 w-3' />
                    </span>
                  )}
                  {taskCancelled && (
                    <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs" title="Cancelling">
                      <Loader2 className="w-3 h-3 animate-spin" />
                    </Badge>
                  )}

                  {/* Overwrite flags - icon only to save space */}
                  {task.overwrite_scenes && (
                    <Badge className="h-5 shrink-0 border-transparent bg-amber-500/70 px-1.5 text-[10px] text-white sm:px-2 sm:text-xs" title="Overwrite Scenes">
                      <Scissors className="w-3 h-3" />
                    </Badge>
                  )}
                  {task.overwrite_split && (
                    <Badge className="h-5 shrink-0 border-transparent bg-amber-500/70 px-1.5 text-[10px] text-white sm:px-2 sm:text-xs" title="Overwrite Split">
                      <Film className="w-3 h-3" />
                    </Badge>
                  )}
                  {task.overwrite_subtitles && (
                    <Badge className="h-5 shrink-0 border-transparent bg-amber-500/70 px-1.5 text-[10px] text-white sm:px-2 sm:text-xs" title="Overwrite Subtitles">
                      <Subtitles className="w-3 h-3" />
                    </Badge>
                  )}
                  {task.delete_video_after_completion && (
                    <Badge variant="destructive" className="h-5 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs" title="Delete After Completion">
                      <Delete className="w-3 h-3" />
                    </Badge>
                  )}
                  {task.nvenc_overwrite_original && (
                    <Badge className="h-5 shrink-0 border-transparent bg-blue-500/80 px-1.5 text-[10px] text-white sm:px-2 sm:text-xs" title="Overwrite Original File">
                      <RefreshCcw className="w-3 h-3" />
                    </Badge>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 text-xs sm:hidden">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={cn("flex items-center gap-1.5 font-medium", status.color)}>
                      <StatusIcon className={cn("h-3.5 w-3.5", task.status === 'processing' && 'animate-spin')} />
                      {status.label}
                    </span>
                    <span className="text-muted-foreground">
                      Queued: <span className="text-foreground">{formatDate(task.createdAt)}</span>
                    </span>
                    {task.status !== 'queued' && task.startedAt && (
                      <span className="text-muted-foreground">
                        Started: <span className="text-foreground">{formatDate(task.startedAt)}</span>
                      </span>
                    )}
                  </div>
                  {task.completedAt && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-muted-foreground">
                        {task.status === 'completed' ? 'Completed' : task.status === 'failed' ? 'Failed' : 'Cancelled'}: <span className="text-foreground">{formatDate(task.completedAt)}</span>
                      </span>
                      {task.startedAt != null && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatElapsedSeconds(Math.floor((parseUtcDate(task.completedAt).getTime() - parseUtcDate(task.startedAt).getTime()) / 1000))}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {(task.status === 'queued' || task.status === 'processing') && (
                <div className={cn("hidden shrink-0 gap-2 sm:flex sm:gap-4", task.status === 'queued' && 'sm:mr-28')}>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">Queued</span>
                    <span className="text-xs text-foreground sm:text-sm">{formatDate(task.createdAt)}</span>
                  </div>
                  {task.status !== 'queued' && task.startedAt && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">Started</span>
                      <span className="text-xs text-foreground sm:text-sm">{formatDate(task.startedAt)}</span>
                    </div>
                  )}
                </div>
              )}

            </div>

            <div className="absolute right-2.5 top-2 flex items-center gap-1.5 transition-opacity sm:right-4 sm:gap-2">
              {(task.status === 'queued' || task.status === 'processing') && onPauseTask && (
                <Button size='sm' variant='outline' className="h-7 px-2 sm:h-9 sm:px-3" onClick={(e) => { e.stopPropagation(); onPauseTask(task.id); }}>
                  <Pause className='h-3 w-3 sm:h-3.5 sm:w-3.5' />
                </Button>
              )}
              {task.status === 'paused' && onUnpauseTask && (
                <Button size='sm' variant='outline' className="h-7 px-2 sm:h-9 sm:px-3" onClick={(e) => { e.stopPropagation(); onUnpauseTask(task.id); }}>
                  <Play className='h-3 w-3 sm:h-3.5 sm:w-3.5' />
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground sm:h-8 sm:w-8"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="!size-4 sm:!size-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <TaskActionMenuItems Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Directory path row */}
            {task.file && (
              <div className="flex items-center gap-2.5 border-b border-border/50 px-2.5 py-1.5 text-xs text-muted-foreground sm:gap-4 sm:px-4 sm:py-2 sm:text-sm">
                <span className="flex items-center gap-1.5 shrink-0">
                  <Folder className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span className="truncate font-mono text-xs sm:text-sm">{task.file.path.replace(/[\\/][^\\/]+$/, '')}</span>
                </span>
              </div>
            )}

            {/* Metadata row - spread horizontally */}
            <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5 px-2.5 py-2 text-xs text-muted-foreground sm:flex-nowrap sm:gap-6 sm:px-4 sm:py-3 sm:text-sm', task.status !== 'failed' && 'border-b border-border/50')}>
              {task.file && (
                <>
                  <span className="flex items-center gap-1.5 sm:shrink-0">
                    <FileText className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    {formatFileSize(task.file.size)}
                  </span>
                  <span className="flex items-center gap-1.5 sm:shrink-0">
                    <ClockIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    {task.file.duration}
                  </span>
                </>
              )}
              {task.subtitleLanguage && (
                <span className="flex items-center gap-1.5 sm:shrink-0">
                  <Subtitles className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  {task.subtitleLanguage}
                </span>
              )}
              {task.scene_detector && (
                <span className="flex items-center gap-1.5 sm:shrink-0">
                  <ScanSearch className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  {task.scene_detector === 'content' ? 'Content' : task.scene_detector === 'adaptive' ? 'Adaptive' : task.scene_detector === 'threshold' ? 'Threshold Detector' : task.scene_detector}
                </span>
              )}
              {(task.type === 'scene' || task.type === 'split' || task.type === 'all') && (task.scene_count ?? 0) > 0 && (
                <span className="flex items-center gap-1.5 sm:shrink-0">
                  <Scissors className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  {task.scene_count} scenes
                </span>
              )}
              {(task.type === 'split' || task.type === 'all') && (task.split_count ?? 0) > 0 && (
                <span className="flex items-center gap-1.5 sm:shrink-0">
                  <Film className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  {task.split_count} clips
                </span>
              )}
              {task.file && (task.file.width || task.file.fps || task.file.codec || task.file.bitrate) && (
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 sm:shrink-0 sm:flex-nowrap">
                  <Monitor className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
                  {[
                    task.file.width && task.file.height ? `${task.file.width}×${task.file.height}` : null,
                    task.file.fps ? `${Math.round(task.file.fps * 100) / 100} fps` : null,
                    task.file.codec ?? null,
                    task.file.bitrate ? `${Math.round(task.file.bitrate / 1000)} kbps` : null,
                  ].filter(Boolean).map((item, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-muted-foreground/40">·</span>}
                      {item}
                    </span>
                  ))}
                </span>
              )}
              {task.type === 'merge' && task.merge_input_paths && (
                <span className="flex items-center gap-1.5 sm:shrink-0">
                  <Film className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  {parseMergeInputPaths(task.merge_input_paths).length} files
                </span>
              )}
            </div>

            {/* Progress section - only show when processing */}
            {task.status === 'processing' && (
              <div className="space-y-3 border-b border-border/50 px-3 py-3 sm:space-y-4 sm:px-6 sm:py-4">
                {task.type === 'merge' ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground sm:text-sm">Merging</span>
                    <div className="flex items-center gap-2">
                      <Progress value={task.merge_progress ?? 0} className="h-2 flex-1" />
                      <span className="w-9 text-right text-xs text-muted-foreground sm:w-10 sm:text-sm">
                        {`${Math.round(task.merge_progress ?? 0)}%`}
                      </span>
                    </div>
                    {task.merge_input_paths && (
                      <div className="flex flex-col gap-1 mt-1">
                        {parseMergeInputPaths(task.merge_input_paths).map((p, i) => (
                          <span key={i} className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground sm:text-xs">
                            <Film className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                            {getFileNameFromPath(p)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3 sm:gap-6">
                      {[
                        { label: 'Scenes', value: task.scene_progress, elapsed: task.scene_elapsed_seconds, active: task.type !== 'subtitle' },
                        { label: 'Split', value: task.split_progress, elapsed: task.split_elapsed_seconds, active: task.type === 'split' || task.type === 'all' },
                        { label: 'Subtitles', value: task.subtitle_progress, elapsed: task.subtitle_elapsed_seconds, active: task.type === 'subtitle' || task.type === 'all' },
                      ].map(({ label, value, elapsed, active }) => (
                        <div key={label} className={cn('flex flex-col gap-1.5 sm:gap-2', !active && 'opacity-40')}>
                          <span className="text-xs font-medium text-foreground sm:text-sm">{label}</span>
                          <div className="flex items-center gap-2">
                            <Progress value={active ? value : 0} className="h-2 flex-1" />
                            <span className="w-9 text-right text-xs text-muted-foreground sm:w-10 sm:text-sm">
                              {active ? `${Math.round(value)}%` : '—'}
                            </span>
                          </div>
                          {active && elapsed !== undefined && elapsed > 0 && (
                            <span className="text-[11px] text-muted-foreground sm:text-xs">
                              {formatElapsedSeconds(elapsed)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {task.currentStage === 'video_reencoding' && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground sm:text-sm">Re-encoding</span>
                    <div className="flex items-center gap-2">
                      <Progress value={task.split_progress} className="h-2 flex-1" />
                      <span className="w-9 text-right text-xs text-muted-foreground sm:w-10 sm:text-sm">
                        {`${Math.round(task.split_progress)}%`}
                      </span>
                    </div>
                  </div>
                )}
                {task.currentStage === 'video_frame_pacing_analysis' && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground sm:text-sm">Frame Pacing Analysis</span>
                    <div className="flex items-center gap-2">
                      <Progress value={task.split_progress} className="h-2 flex-1" />
                      <span className="w-9 text-right text-xs text-muted-foreground sm:w-10 sm:text-sm">
                        {`${Math.round(task.split_progress)}%`}
                      </span>
                    </div>
                  </div>
                )}
                {task.currentStage === 'video_frame_pacing_repair' && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground sm:text-sm">Frame Pacing Repair</span>
                    <div className="flex items-center gap-2">
                      <Progress value={task.split_progress} className="h-2 flex-1" />
                      <span className="w-9 text-right text-xs text-muted-foreground sm:w-10 sm:text-sm">
                        {`${Math.round(task.split_progress)}%`}
                      </span>
                    </div>
                  </div>
                )}
                {task.currentStage === 'video_remuxing' && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-foreground sm:text-sm">Remuxing</span>
                    <div className="flex items-center gap-2">
                      <Progress value={task.split_progress} className="h-2 flex-1" />
                      <span className="w-9 text-right text-xs text-muted-foreground sm:w-10 sm:text-sm">
                        {`${Math.round(task.split_progress)}%`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Path and timestamps - compact footer */}
            {(task.type === 'merge' && !!task.merge_input_paths || !!task.scheduledFor) && (
              <div className={cn('flex items-center gap-2.5 border-t border-border/50 px-2.5 text-xs text-muted-foreground sm:gap-4 sm:px-4 sm:text-sm', task.status === 'failed' ? 'py-1.5 sm:py-2' : 'py-2 sm:py-3')}>
                {task.type === 'merge' && task.merge_input_paths && task.status === 'processing' ? (
                  <span className="flex items-center gap-1.5 font-mono text-xs truncate">
                    <Folder className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
                    {parseMergeInputPaths(task.merge_input_paths)[0]?.replace(/[\\/][^\\/]+$/, '') ?? ''}
                  </span>
                ) : task.type === 'merge' && task.merge_input_paths ? (
                  <span className="font-mono text-xs truncate">
                    {parseMergeInputPaths(task.merge_input_paths).map((p, i) => (
                      <span key={i}>{i > 0 && <span className="mx-1.5 text-muted-foreground/50">+</span>}{getFileNameFromPath(p)}</span>
                    ))}
                  </span>
                ) : null}
                {task.scheduledFor && (
                  <span className="flex items-center gap-1 shrink-0">Scheduled: {formatDate(task.scheduledFor)}</span>
                )}
              </div>
            )}

            {/* Status-specific messages */}
            {(task.status === 'failed' || task.status === 'cancelled') && (
              <div className={cn('flex flex-wrap items-center gap-2 border-t border-border/50 bg-muted/30 px-3 sm:gap-3 sm:px-6', task.status === 'failed' ? 'py-1.5 sm:py-2' : 'py-2 sm:py-3')}>
                {task.status === 'failed' && task.error && (
                  <ErrorMessage
                    error={task.error}
                    maxLength={300}
                    action={(
                      <Button
                        size="icon"
                        variant="ghost"
                        className={cn(
                          'h-5 w-5 shrink-0 align-middle text-white hover:text-white focus-visible:text-white hover:bg-transparent',
                          copiedError ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          copyErrorMessage();
                        }}
                        title="Copy error message"
                      >
                        {copiedError ? (
                          <Check className="h-4 w-4 text-white" />
                        ) : (
                          <Copy className="h-4 w-4 text-white" />
                        )}
                      </Button>
                    )}
                  />
                )}

                {task.status === 'cancelled' && (
                  <p className="group flex w-full items-start gap-1 whitespace-pre-wrap text-xs text-destructive sm:text-sm">
                    <Delete className="w-3 h-3 shrink-0 mt-0.5" />
                    <span className="min-w-0 flex-1">
                      {task.error ? `Cancelled: ${task.error}` : 'Cancelled by user'}
                      <span className="inline-flex align-middle ml-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className={cn(
                            'h-5 w-5 shrink-0 align-middle text-white hover:text-white focus-visible:text-white hover:bg-transparent',
                            copiedError ? 'opacity-100' : 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            copyTextToClipboard(task.error ? `Cancelled: ${task.error}` : 'Cancelled by user').then(() => {
                              setCopiedError(true);
                              setTimeout(() => setCopiedError(false), 2000);
                            }).catch(() => {
                              // Keep the existing UI behavior even if the shared fallback fails.
                            });
                          }}
                          title="Copy cancellation message"
                        >
                          {copiedError ? (
                            <Check className="h-4 w-4 text-white" />
                          ) : (
                            <Copy className="h-4 w-4 text-white" />
                          )}
                        </Button>
                      </span>
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>


          {/* Right column - elapsed time (processing) */}
          {task.status === 'processing' && (
            <div className="flex flex-col items-end justify-center gap-1.5 px-3 py-3 shrink-0 sm:gap-2 sm:px-6 sm:py-4">
              <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-primary sm:text-xs">
                <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" />
                Elapsed
              </span>
              <span className="text-xl font-semibold tabular-nums text-foreground text-right sm:text-2xl">
                {formatElapsedSeconds(elapsedTime)}
              </span>
            </div>
          )}

          {/* Right column - completed/failed/cancelled at */}
          {task.completedAt && (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && (
            <div className="hidden flex-col items-end justify-center gap-1.5 px-3 py-3 shrink-0 sm:flex sm:gap-2 sm:px-6 sm:py-4">
              {task.status === 'completed' && (
                <>
                  <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-success sm:text-xs">
                    <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Completed At
                  </span>
                  <span className="text-xs font-medium text-foreground text-right sm:text-sm">
                    {formatDate(task.completedAt)}
                  </span>
                  {task.startedAt != null && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
                      <Clock className="h-3 w-3" />
                      {formatElapsedSeconds(Math.floor((parseUtcDate(task.completedAt!).getTime() - parseUtcDate(task.startedAt).getTime()) / 1000))}
                    </span>
                  )}
                </>
              )}
              {task.status === 'failed' && (
                <>
                  <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-destructive sm:text-xs">
                    <AlertCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Failed At
                  </span>
                  <span className="text-xs font-medium text-foreground text-right sm:text-sm">
                    {formatDate(task.completedAt)}
                  </span>
                  {task.startedAt != null && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
                      <Clock className="h-3 w-3" />
                      {formatElapsedSeconds(Math.floor((parseUtcDate(task.completedAt!).getTime() - parseUtcDate(task.startedAt).getTime()) / 1000))}
                    </span>
                  )}
                </>
              )}
              {task.status === 'cancelled' && (
                <>
                  <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
                    <Delete className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    Cancelled At
                  </span>
                  <span className="text-xs font-medium text-foreground text-right sm:text-sm">
                    {formatDate(task.completedAt)}
                  </span>
                  {task.startedAt != null && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
                      <Clock className="h-3 w-3" />
                      {formatElapsedSeconds(Math.floor((parseUtcDate(task.completedAt!).getTime() - parseUtcDate(task.startedAt).getTime()) / 1000))}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <TaskActionMenuItems Item={ContextMenuItem} Separator={ContextMenuSeparator} />
        </ContextMenuContent>
      </ContextMenu>
      {task.file && <ViewResultsDialog open={viewGroupOpen} onOpenChange={setViewGroupOpen} file={task.file} />}
      {task.file && <SceneViewerModal file={task.file} isOpen={sceneViewerOpen} onClose={() => setSceneViewerOpen(false)} />}
      <TaskLogsDialog taskId={task.id} open={logsOpen} onOpenChange={setLogsOpen} />
    </>
  );
}
