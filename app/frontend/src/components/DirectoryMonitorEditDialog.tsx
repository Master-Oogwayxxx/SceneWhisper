import { useState, useEffect } from 'react';
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
import { DirectoryMonitor, TaskType } from '@/types/types';
import { Subtitles, Scissors, ScanSearch, Edit3, Shuffle, RefreshCcw, X } from 'lucide-react';
import { directoryApi } from '@/api/directories';
import { utcTimeToLocal } from '@/lib/utils';

function getBrowserTimeZone(): string | undefined {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function scheduleTimeToInput(schedule: DirectoryMonitor['schedule']): string {
    const time = schedule.time || '09:00';
    return schedule.timeZone ? time : utcTimeToLocal(time);
}

export interface DirectoryMonitorEditDialogProps {
    monitor: DirectoryMonitor;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUpdate: (monitor: DirectoryMonitor) => void | Promise<void>;
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

export function DirectoryMonitorEditDialog({
    monitor,
    open,
    onOpenChange,
    onUpdate,
}: DirectoryMonitorEditDialogProps) {
    const [taskTypes, setTaskTypes] = useState<TaskType[]>(monitor.taskTypes?.length ? monitor.taskTypes : [monitor.taskType]);
    const [language, setLanguage] = useState(monitor.subtitleLanguage || 'en');
    const [interval, setInterval] = useState<'hourly' | 'daily' | 'weekly'>(monitor.schedule.interval);
    const [time, setTime] = useState(scheduleTimeToInput(monitor.schedule));
    const [dayOfWeek, setDayOfWeek] = useState(monitor.schedule.dayOfWeek ?? 1);
    const [isActive, setIsActive] = useState(monitor.isActive);
    const [deleteVideoAfterCompletion, setDeleteVideoAfterCompletion] = useState(monitor.deleteVideoAfterCompletion || false);
    const [fillMissingSubtitles, setFillMissingSubtitles] = useState(monitor.fillMissingSubtitles || false);
    const [splitScope, setSplitScope] = useState<'both' | 'uncensored' | 'censored'>(monitor.splitScope || 'both');
    const [framePacingScope, setFramePacingScope] = useState<'all' | 'split'>(monitor.framePacingScope || 'all');
    const [framePacingResolutions, setFramePacingResolutions] = useState<MonitorResolution[]>(monitor.framePacingResolutions || []);
    const [nvencOverwriteOriginal, setNvencOverwriteOriginal] = useState(monitor.nvencOverwriteOriginal || false);
    const primaryTaskType = taskTypes[0] ?? monitor.taskType;
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

    useEffect(() => {
        if (open) {
            setTaskTypes(monitor.taskTypes?.length ? monitor.taskTypes : [monitor.taskType]);
            setLanguage(monitor.subtitleLanguage || 'en');
            setInterval(monitor.schedule.interval);
            setTime(scheduleTimeToInput(monitor.schedule));
            setDayOfWeek(monitor.schedule.dayOfWeek ?? 1);
            setIsActive(monitor.isActive);
            setDeleteVideoAfterCompletion(monitor.deleteVideoAfterCompletion || false);
            setFillMissingSubtitles(monitor.fillMissingSubtitles || false);
            setSplitScope(monitor.splitScope || 'both');
            setFramePacingScope(monitor.framePacingScope || 'all');
            setFramePacingResolutions(monitor.framePacingResolutions || []);
            setNvencOverwriteOriginal(monitor.nvencOverwriteOriginal || false);
        }
    }, [open, monitor]);

    const handleUpdate = async () => {
        if (!monitor) return;
        if (taskTypes.length === 0) return;

        const updatedMonitor: DirectoryMonitor = {
            ...monitor,
            taskType: primaryTaskType,
            taskTypes,
            subtitleLanguage: usesSubtitleLanguage ? language : undefined,
            schedule: {
                interval,
                time: interval !== 'hourly' ? time : undefined,
                dayOfWeek: interval === 'weekly' ? dayOfWeek : undefined,
                timeZone: getBrowserTimeZone(),
            },
            isActive,
            deleteVideoAfterCompletion: usesDeleteVideoAfterCompletion ? deleteVideoAfterCompletion : false,
            fillMissingSubtitles,
            splitScope: usesSplitScope ? splitScope : 'both',
            framePacingScope: usesFramePacingRepair ? framePacingScope : 'all',
            framePacingResolution: 'all',
            framePacingResolutions: usesResolutionFilter ? framePacingResolutions : [],
            nvencOverwriteOriginal: usesFramePacingRepair ? nvencOverwriteOriginal : false,
        };

        try {
            const savedMonitor = await directoryApi.updateDirectoryMonitor(updatedMonitor);
            onUpdate(savedMonitor);
            onOpenChange(false);
        } catch (error) {
            console.error('Failed to update monitor:', error);
            // In a real app, you'd show an error message to the user
        }
    };

    const toggleTaskType = (type: TaskType) => {
        setTaskTypes((prev) => normalizeTaskTypes(prev, type));
    };

    const renderTaskTypeOption = (option: (typeof TASK_TYPE_OPTIONS)[number]) => {
        const checked = taskTypes.includes(option.value);
        const disabled = isTaskTypeDisabled(taskTypes, option.value);
        return (
            <Label
                key={option.value}
                htmlFor={`edit-monitor-type-${option.value}`}
                className={`relative flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg border p-2.5 text-sm transition-all ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${checked ? 'border-primary bg-primary/10' : disabled ? 'border-border' : 'border-border hover:border-primary/50'}`}
            >
                <Checkbox id={`edit-monitor-type-${option.value}`} checked={checked} disabled={disabled} onCheckedChange={() => toggleTaskType(option.value)} className="sr-only" />
                {option.icon === 'split' ? <Scissors className="w-4 h-4" /> : option.icon === 'subtitle' ? <Subtitles className="w-4 h-4" /> : option.icon === 'remux' ? <Shuffle className="w-4 h-4" /> : option.icon === 'repair' ? <RefreshCcw className="w-4 h-4" /> : <ScanSearch className="w-4 h-4" />}
                <span className="text-center">{option.label}</span>
                {checked && (
                    <button
                        type="button"
                        aria-label={`Remove ${option.label} task`}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleTaskType(option.value);
                        }}
                        className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </Label>
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[95vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Edit3 className="w-5 h-5" />
                        Edit Directory Monitor
                    </DialogTitle>
                    <DialogDescription>
                        Modify the settings for monitoring this directory.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-4 pr-4 overflow-y-auto flex-1 scrollbar">
                    {/* Task Types */}
                    <div className="space-y-3 rounded-lg border border-border p-4">
                        <Label className="font-medium text-base">Task Types</Label>
                        <div className="space-y-3">
                            <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
                                {renderTaskTypeOption(getTaskTypeOption('scene'))}
                                <span className="self-center text-xs font-medium text-muted-foreground">-or-</span>
                                {renderTaskTypeOption(getTaskTypeOption('split'))}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {renderTaskTypeOption(getTaskTypeOption('subtitle'))}
                                {renderTaskTypeOption(getTaskTypeOption('remux'))}
                            </div>
                            <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
                                {renderTaskTypeOption(getTaskTypeOption('analyze_frame_pacing'))}
                                <span className="self-center text-xs font-medium text-muted-foreground">-or-</span>
                                {renderTaskTypeOption(getTaskTypeOption('nvenc_frame_pacing'))}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {usesSplitScope && (
                            <div className="space-y-3 rounded-lg border border-border p-4">
                                <div className="flex items-center gap-2 text-base font-semibold">
                                    <Scissors className="h-4 w-4 text-muted-foreground" />
                                    Split Options
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium">Videos to Split</Label>
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

                                {usesResolutionFilter && (
                                    <div className="space-y-1.5">
                                        <Label className="text-sm font-medium">Split / Frame Pacing Resolution</Label>
                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                            <Label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all hover:border-primary/50">
                                                <Checkbox
                                                    checked={framePacingResolutions.length === 0}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) setFramePacingResolutions([]);
                                                    }}
                                                />
                                                <span>All</span>
                                            </Label>
                                            {MONITOR_RESOLUTION_OPTIONS.map((option) => (
                                                <Label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all hover:border-primary/50">
                                                    <Checkbox
                                                        checked={framePacingResolutions.includes(option.value)}
                                                        onCheckedChange={(checked) => setFramePacingResolutions((previous) => checked
                                                            ? [...previous.filter((value) => value !== option.value), option.value]
                                                            : previous.filter((value) => value !== option.value))}
                                                    />
                                                    <span>{option.label}</span>
                                                </Label>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground">Leave all unchecked to process all eligible resolutions.</p>
                                    </div>
                                )}

                                {usesDeleteVideoAfterCompletion && (
                                    <div className="flex items-center gap-3">
                                        <Checkbox
                                            id="delete-video-edit"
                                            checked={deleteVideoAfterCompletion}
                                            onCheckedChange={(checked) => setDeleteVideoAfterCompletion(!!checked)}
                                        />
                                        <Label htmlFor="delete-video-edit" className="font-medium text-sm cursor-pointer">
                                            Delete source video after completion
                                        </Label>
                                    </div>
                                )}
                            </div>
                        )}

                        {usesSubtitleLanguage && (
                            <div className="space-y-3 rounded-lg border border-border p-4">
                                <div className="flex items-center gap-2 text-base font-semibold">
                                    <Subtitles className="h-4 w-4 text-muted-foreground" />
                                    Subtitle Options
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium">Subtitle Language</Label>
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

                                <div className="flex items-center gap-3">
                                    <Checkbox
                                        id="fill-missing-subtitles-edit"
                                        checked={fillMissingSubtitles}
                                        onCheckedChange={(checked) => setFillMissingSubtitles(!!checked)}
                                    />
                                    <Label htmlFor="fill-missing-subtitles-edit" className="font-medium text-sm cursor-pointer">
                                        Queue subtitles for files missing them
                                    </Label>
                                </div>
                            </div>
                        )}

                        {usesFramePacingRepair && (
                            <div className="space-y-3 rounded-lg border border-border p-4">
                                <div className="flex items-center gap-2 text-base font-semibold">
                                    <RefreshCcw className="h-4 w-4 text-muted-foreground" />
                                    Frame Pacing Options
                                </div>

                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium">Videos to Process</Label>
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

                                {!usesSplitScope && usesResolutionFilter && (
                                    <div className="space-y-1.5">
                                        <Label className="text-sm font-medium">Split / Frame Pacing Resolution</Label>
                                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                            <Label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all hover:border-primary/50">
                                                <Checkbox
                                                    checked={framePacingResolutions.length === 0}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) setFramePacingResolutions([]);
                                                    }}
                                                />
                                                <span>All</span>
                                            </Label>
                                            {MONITOR_RESOLUTION_OPTIONS.map((option) => (
                                                <Label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all hover:border-primary/50">
                                                    <Checkbox
                                                        checked={framePacingResolutions.includes(option.value)}
                                                        onCheckedChange={(checked) => setFramePacingResolutions((previous) => checked
                                                            ? [...previous.filter((value) => value !== option.value), option.value]
                                                            : previous.filter((value) => value !== option.value))}
                                                    />
                                                    <span>{option.label}</span>
                                                </Label>
                                            ))}
                                        </div>
                                        <p className="text-xs text-muted-foreground">Leave all unchecked to process all eligible resolutions.</p>
                                    </div>
                                )}

                                <div className="space-y-1.5">
                                    <Label className="text-sm font-medium">Overwrite Original Video</Label>
                                    <RadioGroup
                                        value={nvencOverwriteOriginal ? 'yes' : 'no'}
                                        onValueChange={(value) => setNvencOverwriteOriginal(value === 'yes')}
                                        className="flex gap-3"
                                    >
                                        <Label
                                            htmlFor="nvenc-overwrite-no-edit"
                                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm ${!nvencOverwriteOriginal ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                                        >
                                            <RadioGroupItem value="no" id="nvenc-overwrite-no-edit" className="sr-only" />
                                            <span>No</span>
                                        </Label>
                                        <Label
                                            htmlFor="nvenc-overwrite-yes-edit"
                                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm ${nvencOverwriteOriginal ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                                        >
                                            <RadioGroupItem value="yes" id="nvenc-overwrite-yes-edit" className="sr-only" />
                                            <span>Yes</span>
                                        </Label>
                                    </RadioGroup>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Schedule */}
                    <div className="space-y-3 rounded-lg border border-border p-4">
                        <Label className="font-medium text-base">Schedule</Label>
                        <RadioGroup
                            value={interval}
                            onValueChange={(v) => setInterval(v as 'hourly' | 'daily' | 'weekly')}
                            className="flex gap-3"
                        >
                            <Label
                                htmlFor="hourly-edit"
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${interval === 'hourly' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                                    }`}
                            >
                                <RadioGroupItem value="hourly" id="hourly-edit" className="sr-only" />
                                <span>Hourly</span>
                            </Label>
                            <Label
                                htmlFor="daily-edit"
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${interval === 'daily' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                                    }`}
                            >
                                <RadioGroupItem value="daily" id="daily-edit" className="sr-only" />
                                <span>Daily</span>
                            </Label>
                            <Label
                                htmlFor="weekly-edit"
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${interval === 'weekly' ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                                    }`}
                            >
                                <RadioGroupItem value="weekly" id="weekly-edit" className="sr-only" />
                                <span>Weekly</span>
                            </Label>
                        </RadioGroup>

                        {interval !== 'hourly' && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label className="text-xs text-muted-foreground">Time</Label>
                                    <Input
                                        type="time"
                                        value={time}
                                        onChange={(e) => setTime(e.target.value)}
                                    />
                                </div>
                                {interval === 'weekly' && (
                                    <div className="space-y-2">
                                        <Label className="text-xs text-muted-foreground">Day of Week</Label>
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
                    </div>

                    {/* Active Status */}
                    <div className="flex items-center gap-3 rounded-lg border border-border p-4">
                        <Checkbox
                            id="active-edit"
                            checked={isActive}
                            onCheckedChange={(checked) => setIsActive(!!checked)}
                        />
                        <Label htmlFor="active-edit" className="font-medium text-base cursor-pointer">Enable this monitor</Label>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleUpdate}
                        disabled={taskTypes.length === 0}
                    >
                        Update Monitor
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
