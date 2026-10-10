import { useEffect, useState } from 'react';
import { Scissors, Subtitles, ScanSearch, Calendar, Clock, Globe, X, ChevronRight, ChevronDown, Folder, FileText, Sliders, Wand2, RefreshCcw, Shuffle, SearchCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogWarning,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn, formatFileSize } from '@/lib/utils';
import { Task, File, Directory } from '@/types/types';
import { ScrollArea } from './ui/scroll-area';
import { Switch } from './ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { toast } from 'sonner';
import { Checkbox } from './ui/checkbox';
import { useSettings } from '@/hooks/useSettings';
import { useMergeTask } from '@/hooks/useTasks';

// Helper functions and utilities (non-component code)

/** Normalize paths so task.file.path matches scanned file.path across OS separators */
function normalizePathForMatch(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/** Format file list with truncation for warnings */
function formatFileList(files: File[]): string {
  if (files.length <= 4) {
    return files.map((f) => f.name).join('\n');
  }
  const shown = files.slice(0, 4).map((f) => f.name).join('\n');
  const remaining = files.length - 4;
  return `${shown}\n... and ${remaining} more`;
}

/** Completed split (or combined) work for this path — used to warn before re-queueing split */
function fileHasCompletedSplit(tasks: Task[], file: File): boolean {
  const key = normalizePathForMatch(file.path);
  return tasks.some(
    (t) =>
      t.status === 'completed' &&
      (t.type === 'split' || t.type === 'all') &&
      normalizePathForMatch(t.file.path) === key
  );
}

/** Completed scene detection work for this path — used to warn before re-queueing scene tasks */
function fileHasCompletedScenes(tasks: Task[], file: File): boolean {
  const key = normalizePathForMatch(file.path);
  return tasks.some(
    (t) =>
      t.status === 'completed' &&
      (t.type === 'scene' || t.type === 'split' || t.type === 'all') &&
      normalizePathForMatch(t.file.path) === key
  );
}

/** Completed subtitle (or combined) work for this path — used to warn before re-queueing subtitles */
function fileHasCompletedSubtitles(tasks: Task[], file: File): boolean {
  const key = normalizePathForMatch(file.path);
  return tasks.some(
    (t) =>
      t.status === 'completed' &&
      (t.type === 'subtitle' || t.type === 'all') &&
      normalizePathForMatch(t.file.path) === key
  );
}

/** Validate merge task — require 2+ files in same directory */
function getMergeValidationError(files: File[]): string | null {
  if (files.length < 2) {
    return 'At least 2 files required'
  }

  const directories = new Set(files.map(f => {
    const parts = f.path.split('/')
    return parts.slice(0, -1).join('/')
  }))

  if (directories.size > 1) {
    return 'All files must be in the same directory'
  }

  return null
}

type TaskDialogTaskType = 'scene' | 'split' | 'subtitle' | 'all' | 'merge' | 'analyze_frame_pacing' | 'nvenc_frame_pacing' | 'remux';

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedFile?: File | null;
  setSelectedFile?: React.Dispatch<React.SetStateAction<File | null>>;
  selectedFiles?: File[];
  tasks?: Task[];
  onCreateTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
  onTaskCreated?: () => void;
  directoryTree?: Directory; // New prop for directory tree
  initialTaskType?: TaskDialogTaskType;
  initialLanguage?: string; // full language name like 'English', 'Japanese'
  initialOverwriteScenes?: boolean;
  initialOverwriteSplit?: boolean;
  initialOverwriteSubtitles?: boolean;
  initialDeleteVideoAfterCompletion?: boolean;
  initialNvencOverwriteOriginal?: boolean;
  initialSceneDetector?: string;
  dialogTitle?: string;
  submitLabel?: string;
}

const languages = [
  'English', 'Spanish', 'French', 'German', 'Japanese',
  'Chinese', 'Korean', 'Portuguese', 'Italian', 'Russian'
];

export const LANGUAGE_CODE_TO_NAME: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German',
  ja: 'Japanese', zh: 'Chinese', ko: 'Korean', pt: 'Portuguese',
  it: 'Italian', ru: 'Russian',
};

// Recursive component to render a directory node
interface DirectoryTreeNodeProps {
  directory: Directory;
  depth?: number;
  isSelected: boolean;
  onSelect: (file: File) => void;
  onToggleExpand: (directoryId: string) => void;
  expandedDirectories: Set<string>;
  selectedFiles: File[];
}

function DirectoryTreeNode({
  directory,
  depth = 0,
  isSelected,
  onSelect,
  onToggleExpand,
  expandedDirectories,
  selectedFiles
}: DirectoryTreeNodeProps) {
  const isExpanded = expandedDirectories.has(directory.id);
  const hasChildren = (directory.subdirectories && directory.subdirectories.length > 0) || (directory.files && directory.files.length > 0);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 py-2 px-3 rounded-md cursor-pointer hover:bg-muted/50",
          isSelected && "bg-primary/10"
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => {
          // If this is a directory with files, toggle expansion
          if (hasChildren) {
            onToggleExpand(directory.id);
          }
        }}
      >
        {hasChildren && (
          <button
            type="button"
            className="p-1 hover:bg-muted rounded"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(directory.id);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        )}
        {!hasChildren && (
          <div className="w-6 h-6 flex items-center justify-center"></div> // Empty space for alignment
        )}
        <Folder className="w-4 h-4 text-primary" />
        <span className="truncate flex-1">{directory.name}</span>
      </div>

      {isExpanded && (
        <div>
          {/* Render subdirectories */}
          {directory.subdirectories?.map(subdir => (
            <DirectoryTreeNode
              key={subdir.id}
              directory={subdir}
              depth={depth + 1}
              isSelected={false} // Subdirectories themselves are not directly selected as files
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              expandedDirectories={expandedDirectories}
              selectedFiles={selectedFiles}
            />
          ))}

          {/* Render files in this directory */}
          {directory.files?.map(file => (
            <div
              key={file.id}
              className={cn(
                "flex items-center gap-2 py-2 px-3 rounded-md cursor-pointer hover:bg-muted/50 ml-6"
              )}
              style={{ paddingLeft: `${depth * 20 + 8}px` }}
              onClick={() => onSelect(file)}
            >
              <Checkbox
                checked={selectedFiles.some(f => f.id === file.id)}
                onCheckedChange={(checked) => {
                  // Prevent the checkbox click from bubbling up and causing two clicks
                  if (checked) {
                    onSelect(file);
                  }
                }}
                className="mr-2"
                onClick={(e) => e.stopPropagation()}
              />
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span className="truncate flex-1">{file.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskDialog({ open, onOpenChange, selectedFile, setSelectedFile, selectedFiles = [], tasks = [], onCreateTask, onTaskCreated, directoryTree, initialTaskType, initialLanguage, initialOverwriteScenes, initialOverwriteSplit, initialOverwriteSubtitles, initialDeleteVideoAfterCompletion, initialNvencOverwriteOriginal, initialSceneDetector, dialogTitle, submitLabel }: TaskDialogProps) {
  const { settings } = useSettings();
  const mergeMutation = useMergeTask();
  const [taskType, setTaskType] = useState<TaskDialogTaskType | null>(initialTaskType ?? null);
  const [language, setLanguage] = useState(initialLanguage ?? LANGUAGE_CODE_TO_NAME[settings.default_subtitle_language] ?? 'English');
  const [scheduleTask, setScheduleTask] = useState(false);
  const [overwriteScenes, setOverwriteScenes] = useState(false);
  const [overwriteSplit, setOverwriteSplit] = useState(false);
  const [bypassSplitGuard, setBypassSplitGuard] = useState(false);
  const [overwriteSubtitles, setOverwriteSubtitles] = useState(false);
  const [sceneDetector, setSceneDetector] = useState<string>('');
  const [deleteVideoAfterCompletion, setDeleteVideoAfterCompletion] = useState(false);
  const [nvencOverwriteOriginal, setNvencOverwriteOriginal] = useState(true);
  const [localFiles, setLocalFiles] = useState<File[]>([]);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [showDirectoryTree, setShowDirectoryTree] = useState(false);

  // Reset taskType and language when dialog opens (handles prop changes between opens)
  useEffect(() => {
    if (open) {
      setTaskType(initialTaskType ?? null);
      setLanguage(initialLanguage ?? LANGUAGE_CODE_TO_NAME[settings.default_subtitle_language] ?? 'English');
      setSceneDetector(initialSceneDetector ?? '');
      setOverwriteScenes(initialOverwriteScenes ?? false);
      setOverwriteSplit(initialOverwriteSplit ?? false);
      setBypassSplitGuard(false);
      setOverwriteSubtitles(initialOverwriteSubtitles ?? false);
      setDeleteVideoAfterCompletion(initialDeleteVideoAfterCompletion ?? false);
      setNvencOverwriteOriginal(initialNvencOverwriteOriginal ?? true);
    }
  }, [open, initialTaskType, initialLanguage, initialSceneDetector, initialOverwriteScenes, initialOverwriteSplit, initialOverwriteSubtitles, initialDeleteVideoAfterCompletion, initialNvencOverwriteOriginal, settings.default_subtitle_language]);

  // Initialize expanded directories to show first level by default
  useEffect(() => {
    if (open && directoryTree) {
      setExpandedDirectories(new Set<string>([directoryTree.id]));
    }
  }, [open, directoryTree]);

  // Close dialog on merge success
  useEffect(() => {
    if (mergeMutation.isSuccess) {
      onOpenChange(false);
      onTaskCreated?.();
    }
    // onOpenChange and onTaskCreated are intentionally excluded: recreated every render (not memoized),
    // including them would cause an infinite re-render loop via setSelectedFiles([]) → new ref → re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeMutation.isSuccess]);

  // Must run every render — early return below must not skip this hook
  useEffect(() => {
    if (open) {
      const initialFiles = selectedFiles.length > 0 ? selectedFiles : (selectedFile ? [selectedFile] : []);
      setLocalFiles(initialFiles);

      // Check if we should show directory tree based on current selection
      // Show directory tree when no files are selected AND directoryTree is available
      setShowDirectoryTree(initialFiles.length === 0 && !!directoryTree);
    } else {
      // Reset local files when dialog is closed
      setLocalFiles([]);
      setShowDirectoryTree(false);
      setSelectedFile?.(null);
      setOverwriteScenes(false);
      setOverwriteSplit(false);
      setBypassSplitGuard(false);
      setOverwriteSubtitles(false);
      setDeleteVideoAfterCompletion(false);
      setNvencOverwriteOriginal(true);
    }
  }, [open, selectedFile, selectedFiles, directoryTree]);

  // Handle create task
  const handleCreate = () => {
    if (localFiles.length === 0 || taskType === null) return;

    if (taskType === 'merge') {
      const fileIds = localFiles.map(f => f.id);
      mergeMutation.mutate(fileIds);
      toast.success('Merge task created successfully!');
    } else {
      localFiles.forEach(file => {
        const taskData: Omit<Task, 'id' | 'createdAt'> = {
          file: file,
          type: taskType,
          status: 'queued' as const,
          scene_progress: 0,
          split_progress: 0,
          subtitle_progress: 0,
          subtitleLanguage: taskType === 'subtitle' || taskType === 'all' ? language : undefined,
          scheduledFor: scheduleTask ? new Date(Date.now() + 3600000) : undefined,
          overwrite_scenes: overwriteScenes,
          overwrite_split: overwriteSplit,
          bypass_split_guard: bypassSplitGuard,
          overwrite_subtitles: overwriteSubtitles,
          scene_detector: sceneDetector || settings.scene_detector,
          delete_video_after_completion: deleteVideoAfterCompletion,
          nvenc_overwrite_original: nvencOverwriteOriginal,
        };
        onCreateTask(taskData);
      });
      onTaskCreated?.();
      onOpenChange(false);
    }
  };

  const handleSelectFile = (file: File) => {
    // If we're in directory tree mode, toggle the file selection (allow multiple selections)
    if (showDirectoryTree) {
      setLocalFiles(prev => {
        const exists = prev.some(f => f.id === file.id);
        if (exists) {
          // Remove file if already selected
          return prev.filter(f => f.id !== file.id);
        } else {
          // Add file if not selected
          return [...prev, file];
        }
      });
      // Don't hide directory tree - allow continued selection from tree
    }
  };

  const handleToggleExpand = (directoryId: string) => {
    setExpandedDirectories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(directoryId)) {
        newSet.delete(directoryId);
      } else {
        newSet.add(directoryId);
      }
      return newSet;
    });
  };

  // Only return null when no files and not open - but we want to show directory tree even when closed
  if (!open) return null;

  const filesAlreadyScened = tasks.length
    ? localFiles.filter((f) => fileHasCompletedScenes(tasks, f))
    : [];
  const filesAlreadySplit = tasks.length
    ? localFiles.filter((f) => fileHasCompletedSplit(tasks, f))
    : [];
  const filesAlreadySubtitled = tasks.length
    ? localFiles.filter((f) => fileHasCompletedSubtitles(tasks, f))
    : [];

  const sceneWarningMessage =
    filesAlreadyScened.length > 0
      ? `The following video(s) already have completed scene generation:\n${formatFileList(filesAlreadyScened)}\n\nNote: Turn on Overwrite existing to queue this again.`
      : '';
  const splitWarningMessage =
    filesAlreadySplit.length > 0
      ? `The following video(s) already have completed split generation:\n${formatFileList(filesAlreadySplit)}\n\nNote: Turn on Overwrite existing to queue this again.`
      : '';
  const subtitleWarningMessage =
    filesAlreadySubtitled.length > 0
      ? `The following video(s) already have completed subtitle generation:\n${formatFileList(filesAlreadySubtitled)}\n\nNote: Turn on Overwrite existing to queue this again.`
      : '';

  /** Which overwrite stages have existing completed work (for warnings) */
  const sceneOverwriteApplicable = localFiles.length > 0 && tasks.length > 0 && filesAlreadyScened.length > 0;
  const splitOverwriteApplicable = localFiles.length > 0 && tasks.length > 0 && filesAlreadySplit.length > 0;
  const subtitleOverwriteApplicable = localFiles.length > 0 && tasks.length > 0 && filesAlreadySubtitled.length > 0;

  /** Visible overwrite stage options filtered by task type */
  const overwriteStages = [
    {
      key: 'scenes' as const, label: 'Detected Scenes', value: overwriteScenes, set: setOverwriteScenes,
      applicable: sceneOverwriteApplicable,
      show: taskType === 'scene' || taskType === 'split' || taskType === 'all'
    },
    {
      key: 'split' as const, label: 'Split Videos', value: overwriteSplit, set: setOverwriteSplit,
      applicable: splitOverwriteApplicable,
      show: taskType === 'split' || taskType === 'all'
    },
    {
      key: 'subtitles' as const, label: 'Generated Subtitles', value: overwriteSubtitles, set: setOverwriteSubtitles,
      applicable: subtitleOverwriteApplicable,
      show: taskType === 'subtitle' || taskType === 'all'
    },
  ].filter(s => s.show);

  /**
   * Blocks create when existing work exists for a stage and its overwrite flag is off.
   * For "all", either split or subtitle work blocking counts.
   */
  const createBlockedByExistingWork =
    localFiles.length > 0 &&
    tasks.length > 0 &&
    (taskType === 'scene'
      ? localFiles.every((f) => fileHasCompletedScenes(tasks, f)) && !overwriteScenes
      : taskType === 'split'
        ? localFiles.every((f) => fileHasCompletedSplit(tasks, f)) && !overwriteSplit && !bypassSplitGuard
        : taskType === 'subtitle'
          ? localFiles.every((f) => fileHasCompletedSubtitles(tasks, f)) && !overwriteSubtitles
          : taskType === 'all'
            ? localFiles.some((f) => fileHasCompletedSplit(tasks, f)) && !overwriteSplit && !bypassSplitGuard ||
            localFiles.some((f) => fileHasCompletedSubtitles(tasks, f)) && !overwriteSubtitles
            : false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`bg-card border-border max-w-2xl ${selectedFiles.length !== 1 ? "h-[95vh]" : ""} max-h-[95vh] overflow-y-auto flex flex-col`}>
        {taskType === 'scene' && sceneWarningMessage && (
          <DialogWarning className="whitespace-pre-line" message={sceneWarningMessage} />
        )}
        {taskType === 'split' && splitWarningMessage && (
          <DialogWarning className="whitespace-pre-line" message={splitWarningMessage} />
        )}
        {taskType === 'subtitle' && subtitleWarningMessage && (
          <DialogWarning className="whitespace-pre-line" message={subtitleWarningMessage} />
        )}
        {taskType === 'all' && (splitWarningMessage || subtitleWarningMessage) && (
          <DialogWarning
            className="whitespace-pre-line"
            message={[splitWarningMessage, subtitleWarningMessage].filter(Boolean).join('\n\n')}
          />
        )}
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            {dialogTitle ?? 'Create'} {localFiles.length > 0 ? `${localFiles.length} Tasks` : 'New Task'}
          </DialogTitle>
          <DialogDescription>
            {localFiles.length > 0
              ? `Configure processing options for ${localFiles.length} video files.`
              : 'Configure processing options for your video file.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 px-1 flex-1 overflow-y-auto flex flex-col scrollbar">
          {
            selectedFiles.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto scrollbar px-1">
                {selectedFiles.map((file) => (
                  <div key={file.id} className="border rounded-lg p-3 bg-secondary/50" data-testid="selected-file-display">
                    <div className="flex items-center gap-4">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <div className="mt-1">
                        <p className="text-sm">{file.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatFileSize(file.size)} • {file.path}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          }

          {/* Directory Tree View */}
          {showDirectoryTree && directoryTree && (
            <div className="space-y-2 flex-1 flex flex-col min-h-0">
              <Label>Select a file from the directory structure</Label>
              <div className="border rounded-md overflow-hidden flex-1 min-h-0">
                <ScrollArea className="h-full w-full overflow-y-auto">
                  <div className="p-2">
                    <DirectoryTreeNode
                      directory={directoryTree}
                      isSelected={false}
                      onSelect={handleSelectFile}
                      onToggleExpand={handleToggleExpand}
                      expandedDirectories={expandedDirectories}
                      selectedFiles={localFiles}
                    />
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}

          {/* Task Type */}
          <div className="space-y-2 py-2">
            <Label className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-muted-foreground" />
              Task Type
            </Label>
            <TooltipProvider>
              <RadioGroup value={taskType ?? ''} onValueChange={(v) => setTaskType(v as TaskDialogTaskType)}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { value: 'scene', label: 'Scene', icon: ScanSearch, tooltip: 'Detect scenes in video' },
                    { value: 'split', label: 'Split', icon: Scissors, tooltip: 'Split video into scenes' },
                    { value: 'subtitle', label: 'Subtitle', icon: Subtitles, tooltip: 'Generate subtitles' },
                    { value: 'all', label: 'All', icon: Subtitles, tooltip: 'Scene, split, and subtitles' },
                    { value: 'merge', label: 'Merge', icon: Subtitles, tooltip: 'Merge multiple videos' },
                    { value: 'analyze_frame_pacing', label: 'Analyze + Frame Pacing Repair', icon: SearchCheck, tooltip: 'Analyze frame pacing first, then repair only suspect videos' },
                    { value: 'nvenc_frame_pacing', label: 'Frame Pacing Repair', icon: RefreshCcw, tooltip: 'Normalize timestamps and frame pacing with NVENC' },
                    { value: 'remux', label: 'Remux', icon: Shuffle, tooltip: 'Rewrite the container with stream copy only' },
                  ].map((option) => (
                    <Tooltip key={option.value}>
                      <TooltipTrigger asChild>
                        <Label
                          className={cn(
                            'flex min-h-20 flex-col items-center justify-center gap-1.5 p-2 text-center rounded-lg border-2 cursor-pointer transition-all',
                            taskType === option.value
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/30'
                          )}
                        >
                          <RadioGroupItem value={option.value} className="sr-only" />
                          <option.icon className={cn(
                            'w-4 h-4',
                            taskType === option.value ? 'text-primary' : 'text-muted-foreground'
                          )} />
                          <span className="text-sm font-medium">{option.label}</span>
                        </Label>
                      </TooltipTrigger>
                      <TooltipContent>{option.tooltip}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </RadioGroup>
            </TooltipProvider>
          </div>

          {/* Language Selection */}
          {taskType === 'subtitle' || taskType === 'all' ? (
            <div className="flex items-center justify-between gap-4 py-2">
              <Label className="flex items-center gap-2 text-sm">
                <Globe className="w-4 h-4 text-muted-foreground" />
                Subtitle Language
              </Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languages.map((lang) => (
                    <SelectItem key={lang} value={lang}>{lang}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* Overwrite Stage Checkboxes */}
          {taskType !== null && taskType !== 'merge' && taskType !== 'analyze_frame_pacing' && taskType !== 'nvenc_frame_pacing' && taskType !== 'remux' && localFiles.length > 0 && (
            <div className="p-3 rounded-lg bg-secondary/30 space-y-2">
              <p className="text-sm font-medium">Overwrite Existing:</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="overwrite-scenes"
                    checked={overwriteScenes}
                    onCheckedChange={(checked) => setOverwriteScenes(!!checked)}
                  />
                  <label htmlFor="overwrite-scenes" className="text-sm cursor-pointer select-none">
                    Scenes
                  </label>
                </div>
                {(taskType === 'split' || taskType === 'all') && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="overwrite-split"
                      checked={overwriteSplit}
                      onCheckedChange={(checked) => setOverwriteSplit(!!checked)}
                    />
                    <label htmlFor="overwrite-split" className="text-sm cursor-pointer select-none">
                      Split Videos
                    </label>
                  </div>
                )}
                {(taskType === 'subtitle' || taskType === 'all') && (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="overwrite-subtitles"
                      checked={overwriteSubtitles}
                      onCheckedChange={(checked) => setOverwriteSubtitles(!!checked)}
                    />
                    <label htmlFor="overwrite-subtitles" className="text-sm cursor-pointer select-none">
                      Subtitles
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Scene Detector Override */}
          {taskType === 'scene' || taskType === 'split' || taskType === 'all' ? (
            <div className="flex items-center justify-between gap-4 py-2">
              <Label className="flex items-center gap-2 text-sm">
                <Wand2 className="w-4 h-4 text-muted-foreground" />
                Scene detector override
              </Label>
              <Select value={sceneDetector} onValueChange={setSceneDetector}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder={`Use global (${settings.scene_detector})`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="content">Content</SelectItem>
                  <SelectItem value="adaptive">Adaptive</SelectItem>
                  <SelectItem value="threshold">Threshold</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {(taskType === 'scene' || taskType === 'split' || taskType === 'all') && localFiles.length > 0 && (
            <div className="flex items-center justify-between gap-4 py-1">
              <label htmlFor="bypass-split-check" className="text-sm cursor-pointer select-none">
                Bypass split check
              </label>
              <Switch
                id="bypass-split-check"
                checked={bypassSplitGuard}
                onCheckedChange={setBypassSplitGuard}
              />
            </div>
          )}

          {/* Delete source video after completion */}
          {taskType !== null && taskType !== 'merge' && taskType !== 'analyze_frame_pacing' && taskType !== 'nvenc_frame_pacing' && taskType !== 'remux' && (
            <div className="flex items-center justify-between gap-4 py-1">
              <label
                htmlFor="delete-video-after-completion"
                className="text-sm cursor-pointer select-none"
              >
                Delete source video after completion
              </label>
              <Switch
                id="delete-video-after-completion"
                checked={deleteVideoAfterCompletion}
                onCheckedChange={(checked) => setDeleteVideoAfterCompletion(checked)}
              />
            </div>
          )}

          {(taskType === 'analyze_frame_pacing' || taskType === 'nvenc_frame_pacing') && (
            <div className="flex items-center justify-between gap-4 py-1">
              <label
                htmlFor="nvenc-overwrite-original"
                className="text-sm cursor-pointer select-none"
              >
                Overwrite original file
              </label>
              <Switch
                id="nvenc-overwrite-original"
                checked={nvencOverwriteOriginal}
                onCheckedChange={(checked) => setNvencOverwriteOriginal(checked)}
              />
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleCreate}
            disabled={
              localFiles.length === 0 ||
              taskType === null ||
              createBlockedByExistingWork ||
              (taskType === 'merge' && !!getMergeValidationError(localFiles)) ||
              mergeMutation.isPending
            }
            title={
              createBlockedByExistingWork
                ? taskType === 'all'
                  ? 'At least one selected video already has split or subtitle output. Enable Bypass split check, Split Videos, or subtitle overwrite as needed to create the task.'
                  : taskType === 'split'
                    ? 'This video already has split output. Enable Bypass split check or Split Videos to create the task.'
                    : 'This work is already done for the selected video(s). Enable Overwrite existing to create the task.'
                : (taskType === 'merge' && getMergeValidationError(localFiles))
                  ? getMergeValidationError(localFiles) || undefined
                  : undefined
            }
          >
            {submitLabel ?? (taskType === 'merge' ? 'Create Merge Task' : 'Create Task')}{localFiles.length > 1 ? ` (${localFiles.length})` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
