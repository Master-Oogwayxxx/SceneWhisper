import React, { useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { File, Directory, TaskStatus } from '@/types/types';
import { FileText, VideoIcon, CheckCircle, MoreHorizontal, Folder, Monitor, Trash2, Plus, Pencil, Film, Scissors, Captions, Files, Ban, CircleCheck, Clapperboard, ClipboardList, HardDrive, Clock, Calendar, Loader2, Copy, Check, Tag, XCircle, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { copyTextToClipboard } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSettings } from '@/hooks/useSettings';
import { buildExternalVideoTargetUrl, getExternalVideoCodeFromFileName, isValidExternalVideoTarget } from '@/lib/external-video-targets';

const OPEN_EXTERNAL_LINK_DELAY_MS = 3000;

interface FileCardProps {
  item: File | Directory;
  rootPath?: string;
  onClick?: (e: React.MouseEvent) => void;
  selected?: boolean;
  onViewInfo?: (item: File | Directory) => void;
  onDeleteFile?: (item: File | Directory, options?: { deleteFromDisk: boolean; deleteFromDatabase: boolean }) => Promise<void>;
  onMonitorDirectory?: (directory: Directory) => void;
  onAddToNewTask?: (item: File) => void;
  onEditSubtitle?: (item: File) => void;
  onViewFileGroup?: (file: File) => void;
  onMoveFile?: (item: File) => void;
  onRenameFile?: (item: File, newName: string) => Promise<void>;
  onToggleTaskTypeDisabled?: (item: File, taskType: 'split' | 'subtitle') => void;
  onDeleteScenes?: (item: File) => Promise<void>;
  onViewFileTasks?: (item: File) => void;
  onViewScenes?: (item: File) => void;
  hasActiveTask?: boolean;
  terminalTaskStatus?: Extract<TaskStatus, 'completed' | 'failed' | 'cancelled'>;
  processingTaskId?: string;
  onCancelTask?: (taskId: string) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
}

const truncateFileName = (name: string) => (
  name.length > 37 ? `${name.slice(0, 36)}…` : name
);

const stripExtension = (name: string) => {
  const extensionIndex = name.lastIndexOf('.');
  return extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
};

const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv']);

const isVideoFileName = (name: string) => {
  const extensionIndex = name.lastIndexOf('.');
  return extensionIndex >= 0 && VIDEO_EXTENSIONS.has(name.slice(extensionIndex).toLowerCase());
};

const getDisplayDirectoryPath = (path: string, rootPath?: string) => {
  const normalizedPath = path.replace(/[\\/]+/g, '\\');
  const lastSeparator = normalizedPath.lastIndexOf('\\');
  if (lastSeparator < 0) return null;

  const directoryPath = normalizedPath.slice(0, lastSeparator);
  if (!rootPath) return directoryPath;

  const normalizedRootPath = rootPath.replace(/[\\/]+/g, '\\').replace(/\\+$/, '');
  const rootPrefix = `${normalizedRootPath}\\`;

  if (directoryPath.toLowerCase() === normalizedRootPath.toLowerCase()) return null;

  return directoryPath.toLowerCase().startsWith(rootPrefix.toLowerCase())
    ? directoryPath.slice(rootPrefix.length)
    : directoryPath;
};

const terminalTaskStatusConfig: Record<Extract<TaskStatus, 'completed' | 'failed' | 'cancelled'>, {
  label: string;
  icon: typeof CircleCheck;
  className: string;
}> = {
  completed: {
    label: 'Completed Task',
    icon: CircleCheck,
    className: 'bg-success text-success-foreground hover:bg-success',
  },
  failed: {
    label: 'Failed Task',
    icon: XCircle,
    className: 'bg-destructive text-destructive-foreground hover:bg-destructive',
  },
  cancelled: {
    label: 'Cancelled Task',
    icon: Ban,
    className: 'bg-muted text-muted-foreground hover:bg-muted',
  },
};

export const FileCard = ({ item, rootPath, onClick, selected = false, onViewInfo, onDeleteFile, onMonitorDirectory, onAddToNewTask, onEditSubtitle, onViewFileGroup, onMoveFile, onRenameFile, onToggleTaskTypeDisabled, onDeleteScenes, onViewFileTasks, onViewScenes, hasActiveTask = false, terminalTaskStatus, processingTaskId, onCancelTask, onDeleteTask }: FileCardProps) => {
  const { settings } = useSettings();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteScenesDialogOpen, setIsDeleteScenesDialogOpen] = useState(false);
  const [isDeletingScenes, setIsDeletingScenes] = useState(false);
  const [isDeleteTaskDialogOpen, setIsDeleteTaskDialogOpen] = useState(false);
  const [isCancelTaskDialogOpen, setIsCancelTaskDialogOpen] = useState(false);
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [isCancellingTask, setIsCancellingTask] = useState(false);
  const [deleteFromDisk, setDeleteFromDisk] = useState(true);
  const [deleteFromDatabase, setDeleteFromDatabase] = useState(true);
  const [copiedName, setCopiedName] = useState(false);

  // Prevent focus when shift-clicking by using a ref
  const cardRef = useRef<HTMLDivElement>(null);

  const copyFileName = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    copyTextToClipboard(stripExtension(item.name)).then(() => {
      setCopiedName(true);
      setTimeout(() => setCopiedName(false), 2000);
    }).catch(() => {
      // Keep the current UI silent on copy failure.
    });
  };

  const directoryVideoCount = 'files' in item
    ? item.files.filter((file) => file.file_type === 'video').length
    : 0;
  const directorySubtitleCount = 'files' in item
    ? item.files.filter((file) => file.file_type === 'subtitle').length
    : 0;
  const isVideoFile = !('files' in item) && isVideoFileName(item.name);
  const resolution = !('files' in item) && item.width != null && item.height != null
    ? `${item.width} × ${item.height}`
    : null;
  const createdAt = !('files' in item) && item.created_at
    ? new Date(item.created_at).toLocaleString()
    : null;
  const externalVideoTargets = isVideoFile
    ? settings.external_video_targets.filter(isValidExternalVideoTarget)
    : [];
  const videoCode = isVideoFile ? getExternalVideoCodeFromFileName(item.name) : '';
  const displayDirectoryPath = getDisplayDirectoryPath(item.path, rootPath);

  const handleOpenExternalVideoTarget = (urlTemplate: string) => {
    if (!videoCode) return;
    window.open(buildExternalVideoTargetUrl({ label: '', url_template: urlTemplate }, videoCode), '_blank', 'noopener,noreferrer');
  };

  const openExternalVideoTargetsConsecutively = async () => {
    if (!videoCode) return;

    const openedTabs: Window[] = [];

    for (const target of externalVideoTargets) {
      const tab = window.open('about:blank', '_blank');
      if (!tab) {
        continue;
      }

      try {
        tab.opener = null;
      } catch {
        // Some browsers block reassignment; opening still works without it.
      }

      openedTabs.push(tab);
    }

    for (let index = 0; index < openedTabs.length; index += 1) {
      const tab = openedTabs[index];
      const target = externalVideoTargets[index];
      tab.location.href = buildExternalVideoTargetUrl(target, videoCode);
      if (index < openedTabs.length - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, OPEN_EXTERNAL_LINK_DELAY_MS));
      }
    }
  };

  return (
    <>
      <Card
        ref={cardRef}
        className={`group flex h-full flex-col cursor-pointer hover:shadow-lg transition-shadow duration-200 border-border ${selected ? 'ring-2 ring-primary' : ''}`}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsMenuOpen(true);
        }}
        tabIndex={-1}
      >
        <CardContent className="relative flex flex-1 p-2 sm:p-3">
          {selected && (
            <div className="absolute top-2 right-2 text-primary">
              <CheckCircle className="w-5 h-5" />
            </div>
          )}
          <div className="flex w-full items-stretch gap-3">
            {'files' in item ? (
              <Folder className="h-4 w-4 shrink-0 self-center text-primary sm:h-5 sm:w-5" />
            ) : isVideoFile ? (
              <VideoIcon className="h-4 w-4 shrink-0 self-center text-primary sm:h-5 sm:w-5" />
            ) : item.name.endsWith('.srt') ? (
              <FileText className="h-4 w-4 shrink-0 self-center text-primary sm:h-5 sm:w-5" />
            ) : (
              <FileText className="h-4 w-4 shrink-0 self-center text-primary sm:h-5 sm:w-5" />
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="flex items-center gap-1 text-xs font-medium sm:text-sm">
                      <Tooltip>
                        <TooltipTrigger asChild><Tag className="h-2.5 w-2.5 shrink-0 text-muted-foreground sm:h-3 sm:w-3" /></TooltipTrigger>
                        <TooltipContent><p>Name</p></TooltipContent>
                      </Tooltip>
                      {truncateFileName(item.name)}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 rounded-full shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                            onClick={copyFileName}
                            aria-label={`Copy file name for ${item.name}`}
                          >
                            {copiedName ? (
                              <Check className="!size-3.5 text-success" />
                            ) : (
                              <Copy className="!size-3.5" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{copiedName ? 'Copied file name' : 'Copy file name'}</p>
                        </TooltipContent>
                      </Tooltip>
                    </h3>
                    {displayDirectoryPath && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground sm:text-xs">
                            <Folder className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" />
                            <span className="truncate">{displayDirectoryPath}</span>
                          </p>
                        </TooltipTrigger>
                        <TooltipContent><p>{displayDirectoryPath}</p></TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
                {'files' in item ? (
                  <div className="flex items-center gap-1 flex-wrap py-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" className="flex items-center gap-0.5 px-1 py-0 text-[10px] sm:gap-1 sm:px-1.5 sm:text-xs">
                          <VideoIcon className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                          {directoryVideoCount}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent><p>Videos</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary" className="flex items-center gap-0.5 px-1 py-0 text-[10px] sm:gap-1 sm:px-1.5 sm:text-xs">
                          <Captions className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                          {directorySubtitleCount}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent><p>Subtitles</p></TooltipContent>
                    </Tooltip>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground sm:text-xs">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="flex items-center gap-1.5 w-fit"><HardDrive className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" />{(item.size / (1024 * 1024)).toFixed(2)} MB</p>
                      </TooltipTrigger>
                      <TooltipContent><p>Size</p></TooltipContent>
                    </Tooltip>
                    {item.duration && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="flex items-center gap-1.5 w-fit"><Clock className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" />{item.duration}</p>
                        </TooltipTrigger>
                        <TooltipContent><p>Duration</p></TooltipContent>
                      </Tooltip>
                    )}
                    {resolution && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="flex items-center gap-1.5 w-fit"><Monitor className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" />{resolution}</p>
                        </TooltipTrigger>
                        <TooltipContent><p>Resolution</p></TooltipContent>
                      </Tooltip>
                    )}
                    {createdAt && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="flex items-center gap-1.5 w-fit"><Calendar className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" />{createdAt}</p>
                        </TooltipTrigger>
                        <TooltipContent><p>Created</p></TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
                {!('files' in item) && (((!item.parent_id && (item.has_scenes || item.has_split || item.has_subtitle || item.queue_disabled)) || item.split_disabled || item.subtitle_disabled || hasActiveTask || terminalTaskStatus)) && (
                  <div className="flex items-center gap-1 flex-wrap py-1">
                    {hasActiveTask && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge className="flex items-center gap-0.5 px-1 py-0 text-[10px] sm:gap-1 sm:px-1.5 sm:text-xs bg-amber-500 hover:bg-amber-500">
                            <Loader2 className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Queued or Processing</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {terminalTaskStatus && (() => {
                      const config = terminalTaskStatusConfig[terminalTaskStatus];
                      const Icon = config.icon;

                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge className={`flex items-center gap-0.5 px-1 py-0 text-[10px] sm:gap-1 sm:px-1.5 sm:text-xs ${config.className}`}>
                              <Icon className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{config.label}</p>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })()}
                    {!item.parent_id && item.has_scenes && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge className="flex items-center gap-0.5 px-1 py-0 text-[10px] sm:gap-1 sm:px-1.5 sm:text-xs">
                            <Film className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Scenes</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {!item.parent_id && item.has_split && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge className="flex items-center gap-0.5 px-1 py-0 text-[10px] sm:gap-1 sm:px-1.5 sm:text-xs">
                            <Scissors className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Split</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {!item.parent_id && item.has_subtitle && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge className="flex items-center gap-0.5 px-1 py-0 text-[10px] sm:gap-1 sm:px-1.5 sm:text-xs">
                            <Captions className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Subtitles</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {!item.parent_id && item.queue_disabled && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge className="flex items-center gap-0.5 px-1 py-0 text-[10px] sm:gap-1 sm:px-1.5 sm:text-xs bg-red-500 hover:bg-red-500">
                            <Ban className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Queue Disabled</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {item.split_disabled && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge className="flex items-center gap-0.5 px-1 py-0 text-[10px] sm:gap-1 sm:px-1.5 sm:text-xs bg-red-500 hover:bg-red-500">
                            <Scissors className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Split Disabled</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {item.subtitle_disabled && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge className="flex items-center gap-0.5 px-1 py-0 text-[10px] sm:gap-1 sm:px-1.5 sm:text-xs bg-red-500 hover:bg-red-500">
                            <Ban className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Subtitle Disabled</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>

            </div>
            <div className="flex shrink-0 items-center gap-1">
              <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 rounded-full opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:h-10 sm:w-10 ${selected ? 'opacity-100' : ''}`}
                    onClick={(e) => {
                      // Prevent the menu button click from triggering parent card's onClick
                      e.stopPropagation();
                      // Also prevent default to avoid any form submission behavior
                      e.preventDefault();
                    }}
                  >
                    <MoreHorizontal className="!size-4 sm:!size-5" />
                  </Button>
                </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent event from bubbling to parent
                    onViewInfo?.(item);
                    setIsMenuOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    View Info
                  </div>
                </DropdownMenuItem>
                {isVideoFile && (item.has_scenes || item.has_split || item.has_subtitle) && (
                  <DropdownMenuItem className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewFileGroup?.(item as File);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Files className="w-4 h-4" />
                      View Processed Files
                    </div>
                  </DropdownMenuItem>
                )}
                {isVideoFile && (
                  <DropdownMenuItem className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewFileTasks?.(item as File);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <ClipboardList className="w-4 h-4" />
                      View Tasks
                    </div>
                  </DropdownMenuItem>
                )}
                {isVideoFile && externalVideoTargets.length > 0 && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className="cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        Open in
                      </div>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {externalVideoTargets.length > 1 && (
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsMenuOpen(false);
                            void openExternalVideoTargetsConsecutively();
                          }}
                        >
                          All sites
                        </DropdownMenuItem>
                      )}
                      {externalVideoTargets.map((target) => (
                        <DropdownMenuItem
                          key={target.label + target.url_template}
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenExternalVideoTarget(target.url_template);
                            setIsMenuOpen(false);
                          }}
                        >
                          {target.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                {isVideoFile && processingTaskId && onCancelTask && (
                  <DropdownMenuItem className="cursor-pointer text-amber-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsMenuOpen(false);
                      setIsCancelTaskDialogOpen(true);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <XCircle className="w-4 h-4" />
                      Cancel Task
                    </div>
                  </DropdownMenuItem>
                )}
                {isVideoFile && processingTaskId && onDeleteTask && (
                  <DropdownMenuItem className="cursor-pointer text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsMenuOpen(false);
                      setIsDeleteTaskDialogOpen(true);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Trash2 className="w-4 h-4" />
                      Delete Task
                    </div>
                  </DropdownMenuItem>
                )}
                {isVideoFile && (
                  <DropdownMenuItem className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewScenes?.(item as File);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Film className="w-4 h-4" />
                      {(item as File).has_scenes ? 'View Scenes' : 'Create Custom Scene'}
                    </div>
                  </DropdownMenuItem>
                )}
                {isVideoFile && (
                  <DropdownMenuItem
                    className={`cursor-pointer ${(item as File).queue_disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if ((item as File).queue_disabled) {
                        e.preventDefault();
                        return;
                      }
                      onAddToNewTask?.(item as File);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {(item as File).queue_disabled ? <Ban className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      Add to New Task
                    </div>
                  </DropdownMenuItem>
                )}
                {isVideoFile && !(item as File).split_disabled && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTaskTypeDisabled?.(item as File, 'split');
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Scissors className="w-4 h-4" />
                      Disable From Split
                    </div>
                  </DropdownMenuItem>
                )}
                {isVideoFile && (item as File).split_disabled && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTaskTypeDisabled?.(item as File, 'split');
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <CircleCheck className="w-4 h-4" />
                      Enable for Split
                    </div>
                  </DropdownMenuItem>
                )}
                {isVideoFile && !(item as File).subtitle_disabled && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTaskTypeDisabled?.(item as File, 'subtitle');
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Ban className="w-4 h-4" />
                      Disable From Subtitle
                    </div>
                  </DropdownMenuItem>
                )}
                {isVideoFile && (item as File).subtitle_disabled && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTaskTypeDisabled?.(item as File, 'subtitle');
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <CircleCheck className="w-4 h-4" />
                      Enable for Subtitle
                    </div>
                  </DropdownMenuItem>
                )}
                {!('files' in item) && (
                  <DropdownMenuItem className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveFile?.(item as File);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Folder className="w-4 h-4" />
                      Move
                    </div>
                  </DropdownMenuItem>
                )}
                {!('files' in item) && (
                  <DropdownMenuItem className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameValue(item.name);
                      setIsRenameDialogOpen(true);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Pencil className="w-4 h-4" />
                      Rename
                    </div>
                  </DropdownMenuItem>
                )}
                {'files' in item && (
                  <DropdownMenuItem className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent event from bubbling to parent
                      onMonitorDirectory?.(item as Directory);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Monitor className="w-4 h-4" />
                      Monitor Directory
                    </div>
                  </DropdownMenuItem>
                )}
                {!('files' in item) && item.name.endsWith('.srt') && (
                  <DropdownMenuItem className="cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditSubtitle?.(item as File);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Pencil className="w-4 h-4" />
                      Edit Subtitle
                    </div>
                  </DropdownMenuItem>
                )}
                {!('files' in item) && (
                  <DropdownMenuItem className="cursor-pointer text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsMenuOpen(false);
                      setIsDeleteDialogOpen(true);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </div>
                  </DropdownMenuItem>
                )}
                {!('files' in item) && (item as File).has_scenes && (
                  <DropdownMenuItem className="cursor-pointer text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsDeleteScenesDialogOpen(true);
                      setIsMenuOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Clapperboard className="w-4 h-4" />
                      Delete Scenes
                    </div>
                  </DropdownMenuItem>
                )}

              </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose where to delete &ldquo;{item.name}&rdquo;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={deleteFromDisk}
                onCheckedChange={(checked) => setDeleteFromDisk(checked === true)}
              />
              <span className="leading-5">Delete file on disk</span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={deleteFromDatabase}
                onCheckedChange={(checked) => setDeleteFromDatabase(checked === true)}
              />
              <span className="leading-5">Delete record in database</span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting || (!deleteFromDisk && !deleteFromDatabase)}
              onClick={async (e) => {
                e.preventDefault();
                setIsDeleting(true);
                try {
                  await onDeleteFile?.(item, { deleteFromDisk, deleteFromDatabase });
                  setIsDeleteDialogOpen(false);
                } finally {
                  setIsDeleting(false);
                }
              }}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteTaskDialogOpen} onOpenChange={setIsDeleteTaskDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the processing task for &ldquo;{item.name}&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingTask}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingTask}
              onClick={async (e) => {
                e.preventDefault();
                if (!processingTaskId) return;
                setIsDeletingTask(true);
                try {
                  await onDeleteTask?.(processingTaskId);
                  setIsDeleteTaskDialogOpen(false);
                } finally {
                  setIsDeletingTask(false);
                }
              }}
            >
              {isDeletingTask ? 'Deleting…' : 'Delete Task'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isCancelTaskDialogOpen} onOpenChange={setIsCancelTaskDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the processing task for &ldquo;{item.name}&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancellingTask}>Keep running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 text-white hover:bg-amber-600"
              disabled={isCancellingTask}
              onClick={async (e) => {
                e.preventDefault();
                if (!processingTaskId) return;
                setIsCancellingTask(true);
                try {
                  await onCancelTask?.(processingTaskId);
                  setIsCancelTaskDialogOpen(false);
                } finally {
                  setIsCancellingTask(false);
                }
              }}
            >
              {isCancellingTask ? 'Cancelling…' : 'Cancel Task'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteScenesDialogOpen} onOpenChange={setIsDeleteScenesDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scenes?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all scene records for &ldquo;{item.name}&rdquo;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingScenes}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingScenes}
              onClick={async (e) => {
                e.preventDefault();
                setIsDeletingScenes(true);
                try {
                  await onDeleteScenes?.(item as File);
                  setIsDeleteScenesDialogOpen(false);
                } finally {
                  setIsDeletingScenes(false);
                }
              }}
            >
              {isDeletingScenes ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && renameValue.trim() && renameValue !== item.name && !isRenaming) {
                setIsRenaming(true);
                try {
                  await onRenameFile?.(item as File, renameValue.trim());
                  setIsRenameDialogOpen(false);
                } finally {
                  setIsRenaming(false);
                }
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsRenameDialogOpen(false)} disabled={isRenaming}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!renameValue.trim() || renameValue === item.name || isRenaming}
              onClick={async () => {
                setIsRenaming(true);
                try {
                  await onRenameFile?.(item as File, renameValue.trim());
                  setIsRenameDialogOpen(false);
                } finally {
                  setIsRenaming(false);
                }
              }}
            >
              {isRenaming ? 'Renaming…' : 'Rename'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
