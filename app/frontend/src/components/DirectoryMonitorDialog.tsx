import { useState, useEffect, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
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
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Directory, DirectoryMonitor, TaskType } from '@/types/types';
import { FolderOpen, Clock, Subtitles, Scissors, ScanSearch, ChevronDown, ChevronRight, Loader2, Shuffle, RefreshCcw } from 'lucide-react';
import { directoryApi } from '@/api/directories';

function getBrowserTimeZone(): string | undefined {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export type NewDirectoryMonitorPayload = Omit<
    DirectoryMonitor,
    'id' | 'createdAt' | 'lastRun' | 'nextRun'
>;

interface DirectoryMonitorDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    monitors: DirectoryMonitor[]; // Pass existing monitors to filter out already monitored directories
    onCreateMonitors: (monitors: NewDirectoryMonitorPayload[]) => void | Promise<void>;
    monitoringDirectory?: Directory;
}

const LANGUAGES = [
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Spanish' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'it', label: 'Italian' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'ja', label: 'Japanese' },
    { value: 'ko', label: 'Korean' },
    { value: 'zh', label: 'Chinese' },
];

const DAYS_OF_WEEK = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
];

type MonitorResolution = NonNullable<DirectoryMonitor['framePacingResolutions']>[number];

const MONITOR_RESOLUTION_OPTIONS: { value: MonitorResolution; label: string }[] = [
    { value: 'sd', label: 'SD' },
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '1440p', label: '1440p' },
];

const TASK_TYPE_OPTIONS: { value: TaskType; label: string; icon: 'scene' | 'split' | 'subtitle' | 'remux' | 'analyze' | 'repair' }[] = [
    { value: 'scene', label: 'Scene', icon: 'scene' },
    { value: 'split', label: 'Split', icon: 'split' },
    { value: 'subtitle', label: 'Subtitle', icon: 'subtitle' },
    { value: 'remux', label: 'Remux', icon: 'remux' },
    { value: 'analyze_frame_pacing', label: 'Analyze + Frame Pacing Repair', icon: 'analyze' },
    { value: 'nvenc_frame_pacing', label: 'Frame Pacing Repair', icon: 'repair' },
];

function normalizeTaskTypes(taskTypes: TaskType[], toggledType: TaskType): TaskType[] {
    if (taskTypes.includes(toggledType)) {
        return taskTypes.filter((type) => type !== toggledType);
    }
    const next = taskTypes.filter((type) => type !== 'all');
    if (toggledType === 'scene') {
        return [...next.filter((type) => type !== 'split'), toggledType];
    }
    if (toggledType === 'split') {
        return [...next.filter((type) => type !== 'scene'), toggledType];
    }
    if (toggledType === 'analyze_frame_pacing') {
        return [...next.filter((type) => type !== 'nvenc_frame_pacing'), toggledType];
    }
    if (toggledType === 'nvenc_frame_pacing') {
        return [...next.filter((type) => type !== 'analyze_frame_pacing'), toggledType];
    }
    return [...next, toggledType];
}

function isTaskTypeDisabled(taskTypes: TaskType[], type: TaskType): boolean {
    if (type === 'scene' && taskTypes.includes('split')) return true;
    if (type === 'split' && taskTypes.includes('scene')) return true;
    if (type === 'analyze_frame_pacing' && taskTypes.includes('nvenc_frame_pacing')) return true;
    if (type === 'nvenc_frame_pacing' && taskTypes.includes('analyze_frame_pacing')) return true;
    return false;
}

function getTaskTypeOption(value: TaskType) {
    return TASK_TYPE_OPTIONS.find((option) => option.value === value)!;
}

export function DirectoryMonitorDialog({
    open,
    onOpenChange,
    monitors,
    onCreateMonitors,
    monitoringDirectory,
}: DirectoryMonitorDialogProps) {
    const [directories, setDirectories] = useState<Directory[]>([]);
    const [isLoadingDirectories, setIsLoadingDirectories] = useState(false);
    const [selectedDirectoryIds, setSelectedDirectoryIds] = useState<Set<string>>(() => new Set());
    const [taskTypes, setTaskTypes] = useState<TaskType[]>(['split']);
    const [language, setLanguage] = useState('en');
    const [interval, setInterval] = useState<'hourly' | 'daily' | 'weekly'>('daily');
    const [time, setTime] = useState('09:00');
    const [dayOfWeek, setDayOfWeek] = useState(1);
    const [deleteVideoAfterCompletion, setDeleteVideoAfterCompletion] = useState(false);
    const [fillMissingSubtitles, setFillMissingSubtitles] = useState(false);
    const [splitScope, setSplitScope] = useState<'both' | 'uncensored' | 'censored'>('both');
    const [framePacingScope, setFramePacingScope] = useState<'all' | 'split'>('all');
    const [framePacingResolutions, setFramePacingResolutions] = useState<MonitorResolution[]>([]);
    const [nvencOverwriteOriginal, setNvencOverwriteOriginal] = useState(false);
    const primaryTaskType = taskTypes[0] ?? 'split';
    const usesSubtitleLanguage = taskTypes.some((type) => type === 'subtitle');
    const usesSplitScope = taskTypes.some((type) => type === 'split');
    const usesDeleteVideoAfterCompletion = taskTypes.some((type) => type === 'split');
    const usesFramePacingRepair = taskTypes.some((type) => type === 'analyze_frame_pacing' || type === 'nvenc_frame_pacing');
    const usesResolutionFilter = usesSplitScope || usesFramePacingRepair;

    useEffect(() => {
        if (!usesDeleteVideoAfterCompletion) {
            setDeleteVideoAfterCompletion(false);
        }
    }, [usesDeleteVideoAfterCompletion]);

    const toggleTaskType = (type: TaskType) => {
        setTaskTypes((prev) => normalizeTaskTypes(prev, type));
    };

    const renderTaskTypeOption = (option: (typeof TASK_TYPE_OPTIONS)[number]) => {
        const checked = taskTypes.includes(option.value);
        const disabled = isTaskTypeDisabled(taskTypes, option.value);
        return (
            <Label
                key={option.value}
                htmlFor={`monitor-type-${option.value}`}
                className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border p-3 transition-all ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${checked ? 'border-primary bg-primary/10' : disabled ? 'border-border' : 'border-border hover:border-primary/50'}`}
            >
                <Checkbox id={`monitor-type-${option.value}`} checked={checked} disabled={disabled} onCheckedChange={() => toggleTaskType(option.value)} className="sr-only" />
                {option.icon === 'split' ? <Scissors className="w-5 h-5" /> : option.icon === 'subtitle' ? <Subtitles className="w-5 h-5" /> : option.icon === 'remux' ? <Shuffle className="w-5 h-5" /> : option.icon === 'repair' ? <RefreshCcw className="w-5 h-5" /> : <ScanSearch className="w-5 h-5" />}
                <span className="text-center text-sm font-medium">{option.label}</span>
            </Label>
        );
    };

    // Flatten all directories for selection purposes
    const flatDirectories = useMemo(() => {
        const flatten = (nodes: Directory[]): Directory[] => {
            return nodes.reduce((acc: Directory[], node) => {
                acc.push(node);
                if (node.subdirectories && node.subdirectories.length > 0) {
                    acc.push(...flatten(node.subdirectories));
                }
                return acc;
            }, []);
        };
        return flatten(directories);
    }, [directories]);

    const selectableDirectoryIdSet = useMemo(() => {
        const selectable = new Set<string>();
        for (const f of flatDirectories) {
            // Only include directories that are not already being monitored
            if (!monitors.some(monitor => monitor.directoryId === f.id)) {
                selectable.add(f.id);
            }
        }
        return selectable;
    }, [flatDirectories, monitors]);

    const selectedSelectableCount = [...selectedDirectoryIds].filter((id) =>
        selectableDirectoryIdSet.has(id),
    ).length;

    // Header checkbox reflects only directories that can still get a new monitor
    const allDirectoriesSelected =
        selectableDirectoryIdSet.size > 0 && selectedSelectableCount === selectableDirectoryIdSet.size;

    // Some but not all selectable rows checked — indeterminate header state
    const someDirectoriesSelected =
        selectedSelectableCount > 0 && selectedSelectableCount < selectableDirectoryIdSet.size;

    const toggleDirectoryId = (directoryId: string) => {
        if (!selectableDirectoryIdSet.has(directoryId)) return;
        setSelectedDirectoryIds((prev) => {
            const next = new Set(prev);
            // Same id click removes it; otherwise add for multi-select behavior
            if (next.has(directoryId)) {
                next.delete(directoryId);
            } else {
                next.add(directoryId);
            }
            return next;
        });
    };

    const selectAllDirectoryIds = () => {
        setSelectedDirectoryIds(new Set(selectableDirectoryIdSet));
    };

    const clearDirectorySelection = () => {
        setSelectedDirectoryIds(new Set());
    };

    const handleSelectAllCheckbox = (checked: boolean | 'indeterminate') => {
        // Checked or indeterminate → clicking Radix typically moves toward checked; we treat true as select all
        if (checked === true) {
            selectAllDirectoryIds();
        } else {
            // Unchecked clears so user can collapse from "all" in one click
            clearDirectorySelection();
        }
    };

    const toggleDirectoryExpansion = (directoryId: string, isParent: boolean = false) => {
        setDirectories(prev => {
            const updateNode = (node: Directory): Directory => {
                if (node.id === directoryId) {
                    return { ...node, isExpanded: !node.isExpanded };
                }
                if (node.subdirectories) {
                    return {
                        ...node,
                        subdirectories: node.subdirectories.map(updateNode),
                        isExpanded: node.isExpanded
                    };
                }
                return node;
            };

            return prev.map(updateNode);
        });
    };

    const buildMonitorPayload = (directory: { id: string; name: string; path: string }): NewDirectoryMonitorPayload => ({
        directoryId: directory.id,
        directoryName: directory.name,
        directoryPath: directory.path,
        taskType: primaryTaskType,
        taskTypes,
        subtitleLanguage: usesSubtitleLanguage ? language : undefined,
        schedule: {
            interval,
            time: interval !== 'hourly' ? time : undefined,
            dayOfWeek: interval === 'weekly' ? dayOfWeek : undefined,
            timeZone: getBrowserTimeZone(),
        },
        isActive: true,
        deleteVideoAfterCompletion: usesDeleteVideoAfterCompletion ? deleteVideoAfterCompletion : false,
        fillMissingSubtitles,
        splitScope: usesSplitScope ? splitScope : 'both',
        framePacingScope: usesFramePacingRepair ? framePacingScope : 'all',
        framePacingResolution: 'all',
        framePacingResolutions: usesResolutionFilter ? framePacingResolutions : [],
        nvencOverwriteOriginal: usesFramePacingRepair ? nvencOverwriteOriginal : false,
    });

    const handleCreate = async () => {
        if (selectedSelectableCount === 0 || taskTypes.length === 0) return;

        const monitors: NewDirectoryMonitorPayload[] = [];
        for (const id of selectedDirectoryIds) {
            const directory = flatDirectories.find((f) => f.id === id);
            // Create monitor for all selected directories
            if (directory) {
                monitors.push(buildMonitorPayload(directory));
            }
        }
        if (monitors.length === 0) return;

        await Promise.resolve(onCreateMonitors(monitors));
        onOpenChange(false);
    };

    const renderDirectoryItem = (directory: Directory, depth = 0) => {
        const isSelectable = selectableDirectoryIdSet.has(directory.id);
        const isSelected = selectedDirectoryIds.has(directory.id);
        const hasSubdirectories = directory.subdirectories && directory.subdirectories.length > 0;

        return (
            <div key={directory.id} className="w-full">
                <label
                    className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm ${isSelectable && 'cursor-pointer hover:bg-muted/80'} ${depth > 0 ? 'ml-4' : ''}`}
                >
                    <Checkbox
                        className="mt-0.5"
                        checked={isSelected}
                        onCheckedChange={() => toggleDirectoryId(directory.id)}
                        disabled={!isSelectable}
                    />
                    <span className={`font-medium truncate ${!isSelectable ? 'text-muted-foreground' : ''}`}>{directory.name}</span>
                    {!isSelectable && (
                        <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {hasSubdirectories && (
                        <button
                            type="button"
                            onClick={() => toggleDirectoryExpansion(directory.id)}
                            className="p-1.5 rounded hover:bg-muted flex items-center justify-center ml-auto"
                            aria-label={directory.isExpanded ? "Collapse directory" : "Expand directory"}
                        >
                            {directory.isExpanded ? (
                                <ChevronDown className="w-5 h-5 text-muted-foreground" />
                            ) : (
                                <ChevronRight className="w-5 h-5 text-muted-foreground" />
                            )}
                        </button>
                    )}
                </label>
                {hasSubdirectories && directory.isExpanded && (
                    <div className="ml-6">
                        {directory.subdirectories?.map(subdirectory => renderDirectoryItem(subdirectory, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    useEffect(() => {
        if (open) {
            const loadDirectories = async () => {
                setIsLoadingDirectories(true);
                try {
                    // getDirectoryTree returns a single Directory object, not an array
                    const rootDirectory = await directoryApi.getDirectoryTree("/videos");
                    if (rootDirectory.subdirectories) {
                        rootDirectory.subdirectories = rootDirectory.subdirectories.filter(
                            (d) => d.name !== 'mount',
                        );
                    }
                    setDirectories([rootDirectory]);
                } catch (error) {
                    console.error('Failed to load directories:', error);
                } finally {
                    setIsLoadingDirectories(false);
                }
            };
            loadDirectories();
        } else {
            // Clear state on close to reset dialog for next open
            setDirectories([]);
            setSelectedDirectoryIds(new Set());
            setTaskTypes(['split']);
            setLanguage('en');
            setInterval('daily');
            setTime('09:00');
            setDayOfWeek(1);
            setDeleteVideoAfterCompletion(false);
            setFillMissingSubtitles(false);
            setSplitScope('both');
            setFramePacingScope('all');
            setNvencOverwriteOriginal(false);
        }
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl min-h-[85vh] max-h-[95vh] overflow-y-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Clock className="w-5 h-5" />
                        Set Up Directory Monitor
                    </DialogTitle>
                    <DialogDescription>
                        Automatically process all videos in one or more directories on a schedule.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex gap-6 py-1">
                    {/* Left: Directory Selection */}
                    <div className="flex flex-col gap-2 flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <Label className="flex items-center gap-2">
                                <FolderOpen className="w-4 h-4" />
                                Directories
                            </Label>
                            <div className="flex gap-1">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs px-2"
                                    disabled={isLoadingDirectories || selectableDirectoryIdSet.size === 0}
                                    onClick={selectAllDirectoryIds}
                                >
                                    All
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs px-2"
                                    disabled={isLoadingDirectories || selectedSelectableCount === 0}
                                    onClick={clearDirectorySelection}
                                >
                                    Clear
                                </Button>
                            </div>
                        </div>
                        {isLoadingDirectories ? (
                            <div className="flex items-center justify-center rounded-md border border-dashed p-4 flex-1">
                                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : directories.length === 0 ? (
                            <p className="text-sm text-muted-foreground rounded-md border border-dashed p-4 text-center flex-1">
                                No directories loaded. Scan or expand the library first.
                            </p>
                        ) : (
                            <ScrollArea className="h-[600px] rounded-md border">
                                <div className="p-2 space-y-1">
                                    {directories.flatMap(dir => dir.subdirectories || []).map((directory) => renderDirectoryItem(directory))}
                                </div>
                            </ScrollArea>
                        )}
                    </div>

                    {/* Divider */}
                    <div className="w-px bg-border shrink-0" />

                    {/* Right: Configuration */}
                    <div className="flex flex-col gap-6 flex-1 min-w-0 h-[600px] overflow-y-auto pr-2 scrollbar">
                        {/* Task Types */}
                        <div className="space-y-3">
                            <Label>Task Types</Label>
                            <div className="space-y-3">
                                <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
                                    {renderTaskTypeOption(getTaskTypeOption('scene'))}
                                    <span className="self-center text-xs font-medium text-muted-foreground">-or-</span>
                                    {renderTaskTypeOption(getTaskTypeOption('split'))}
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    {renderTaskTypeOption(getTaskTypeOption('subtitle'))}
                                    {renderTaskTypeOption(getTaskTypeOption('remux'))}
                                </div>
                                <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
                                    {renderTaskTypeOption(getTaskTypeOption('analyze_frame_pacing'))}
                                    <span className="self-center text-xs font-medium text-muted-foreground">-or-</span>
                                    {renderTaskTypeOption(getTaskTypeOption('nvenc_frame_pacing'))}
                                </div>
                            </div>
                        </div>

                        {usesSplitScope && (
                            <div className="space-y-2">
                                <Label>Videos to Split</Label>
                                <Select value={splitScope} onValueChange={(value) => setSplitScope(value as typeof splitScope)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="both">Both</SelectItem>
                                        <SelectItem value="uncensored">Uncensored only</SelectItem>
                                        <SelectItem value="censored">Censored only</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {usesFramePacingRepair && (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Frame Pacing Videos</Label>
                                    <Select value={framePacingScope} onValueChange={(value) => setFramePacingScope(value as typeof framePacingScope)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">All videos</SelectItem>
                                            <SelectItem value="split">Split videos only</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            <div className="space-y-2">
                                <Label>Overwrite Original Video</Label>
                                    <RadioGroup
                                        value={nvencOverwriteOriginal ? 'yes' : 'no'}
                                        onValueChange={(value) => setNvencOverwriteOriginal(value === 'yes')}
                                        className="flex gap-3"
                                    >
                                        <Label
                                            htmlFor="nvenc-overwrite-no"
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${!nvencOverwriteOriginal ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                                                }`}
                                        >
                                            <RadioGroupItem value="no" id="nvenc-overwrite-no" className="sr-only" />
                                            <span>No</span>
                                        </Label>
                                        <Label
                                            htmlFor="nvenc-overwrite-yes"
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${nvencOverwriteOriginal ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                                                }`}
                                        >
                                            <RadioGroupItem value="yes" id="nvenc-overwrite-yes" className="sr-only" />
                                            <span>Yes</span>
                                        </Label>
                                    </RadioGroup>
                                </div>
                        </div>
                    )}

                    {usesResolutionFilter && (
                        <div className="space-y-2">
                            <Label>Resolution</Label>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {MONITOR_RESOLUTION_OPTIONS.map((option) => (
                                    <Label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all hover:border-primary/50">
                                        <Checkbox
                                            checked={framePacingResolutions.includes(option.value)}
                                            onCheckedChange={(checked) => setFramePacingResolutions((previous) => checked
                                                ? [...previous, option.value]
                                                : previous.filter((value) => value !== option.value))}
                                        />
                                        <span>{option.label}</span>
                                    </Label>
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground">Leave all unchecked to process all eligible resolutions.</p>
                        </div>
                    )}

                        {/* Language (if subtitle or both) */}
                        {usesSubtitleLanguage && (
                            <div className="space-y-2">
                                <Label>Subtitle Language</Label>
                                <Select value={language} onValueChange={setLanguage}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {LANGUAGES.map((lang) => (
                                            <SelectItem key={lang.value} value={lang.value}>
                                                {lang.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Schedule */}
                        <div className="space-y-3">
                            <Label>Check Interval</Label>
                            <RadioGroup
                                value={interval}
                                onValueChange={(v) => setInterval(v as 'hourly' | 'daily' | 'weekly')}
                                className="flex gap-4"
                            >
                                <Label
                                    htmlFor="hourly"
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${interval === 'hourly' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                                        }`}
                                >
                                    <RadioGroupItem value="hourly" id="hourly" className="sr-only" />
                                    <span className="text-sm">Hourly</span>
                                </Label>
                                <Label
                                    htmlFor="daily"
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${interval === 'daily' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                                        }`}
                                >
                                    <RadioGroupItem value="daily" id="daily" className="sr-only" />
                                    <span className="text-sm">Daily</span>
                                </Label>
                                <Label
                                    htmlFor="weekly"
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${interval === 'weekly' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                                        }`}
                                >
                                    <RadioGroupItem value="weekly" id="weekly" className="sr-only" />
                                    <span className="text-sm">Weekly</span>
                                </Label>
                            </RadioGroup>
                        </div>

                        {/* Time Selection */}
                        {interval !== 'hourly' && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Time</Label>
                                    <Input
                                        type="time"
                                        value={time}
                                        onChange={(e) => setTime(e.target.value)}
                                    />
                                </div>
                                {interval === 'weekly' && (
                                    <div className="space-y-2">
                                        <Label>Day of Week</Label>
                                        <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {DAYS_OF_WEEK.map((day) => (
                                                    <SelectItem key={day.value} value={String(day.value)}>
                                                        {day.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>
                        )}

                        {usesDeleteVideoAfterCompletion && (
                            <div className="flex items-center gap-3">
                                <Checkbox
                                    id="delete-video"
                                    checked={deleteVideoAfterCompletion}
                                    onCheckedChange={(checked) => setDeleteVideoAfterCompletion(checked === true)}
                                />
                                <Label htmlFor="delete-video" className="font-normal cursor-pointer">
                                    Delete source video after completion
                                </Label>
                            </div>
                        )}

                        {/* Fill missing subtitles */}
                        <div className="flex items-center gap-3">
                            <Checkbox
                                id="fill-missing-subtitles"
                                checked={fillMissingSubtitles}
                                onCheckedChange={(checked) => setFillMissingSubtitles(checked === true)}
                            />
                            <Label htmlFor="fill-missing-subtitles" className="cursor-pointer font-normal">
                                Queue subtitles for files missing them
                            </Label>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleCreate}
                        disabled={selectedSelectableCount === 0 || directories.length === 0 || taskTypes.length === 0}
                    >
                        {selectedSelectableCount <= 1
                            ? 'Create monitor'
                            : `Create ${selectedSelectableCount} monitors`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
