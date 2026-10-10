import { useState } from 'react';
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
import { Scissors, Subtitles, ScanSearch, Edit3, RefreshCcw, Layers } from 'lucide-react';

interface MonitorBulkEditDialogProps {
    open: boolean;
    selectedCount: number;
    onOpenChange: (open: boolean) => void;
    onApply: (patch: Partial<DirectoryMonitor>) => void;
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

function getBrowserTimeZone(): string | undefined {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function buildBulkSchedulePatch(
    interval: DirectoryMonitor['schedule']['interval'],
    time: string,
    dayOfWeek: number,
): DirectoryMonitor['schedule'] {
    return {
        interval,
        time: interval !== 'hourly' ? time : undefined,
        dayOfWeek: interval === 'weekly' ? dayOfWeek : undefined,
        timeZone: getBrowserTimeZone(),
    };
}

type MonitorResolution = NonNullable<DirectoryMonitor['framePacingResolutions']>[number];

const MONITOR_RESOLUTION_OPTIONS: { value: MonitorResolution; label: string }[] = [
    { value: 'sd', label: 'SD' },
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '1440p', label: '1440p' },
];

type MonitorTaskType = TaskType;

const BULK_TASK_TYPES: MonitorTaskType[] = ['scene', 'split', 'subtitle', 'analyze_frame_pacing', 'nvenc_frame_pacing'];

function normalizeTaskTypes(taskTypes: MonitorTaskType[], toggledType: MonitorTaskType): MonitorTaskType[] {
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

function isTaskTypeDisabled(taskTypes: MonitorTaskType[], type: MonitorTaskType): boolean {
    if (type === 'scene' && taskTypes.includes('split')) return true;
    if (type === 'split' && taskTypes.includes('scene')) return true;
    if (type === 'analyze_frame_pacing' && taskTypes.includes('nvenc_frame_pacing')) return true;
    if (type === 'nvenc_frame_pacing' && taskTypes.includes('analyze_frame_pacing')) return true;
    return false;
}

function getTaskTypeIcon(type: MonitorTaskType) {
    switch (type) {
        case 'scene':
            return <ScanSearch className="w-4 h-4" />;
        case 'split':
            return <Scissors className="w-4 h-4" />;
        case 'subtitle':
            return <Subtitles className="w-4 h-4" />;
        case 'analyze_frame_pacing':
            return <ScanSearch className="w-4 h-4" />;
        case 'nvenc_frame_pacing':
            return <RefreshCcw className="w-4 h-4" />;
        default:
            return <Layers className="w-4 h-4" />;
    }
}

function getTaskTypeLabel(type: MonitorTaskType) {
    switch (type) {
        case 'scene':
            return 'Scene';
        case 'split':
            return 'Split';
        case 'subtitle':
            return 'Subtitle';
        case 'analyze_frame_pacing':
            return 'Analyze + Frame Pacing Repair';
        case 'nvenc_frame_pacing':
            return 'Frame Pacing Repair';
        case 'all':
            return 'All';
        case 'merge':
            return 'Merge';
        case 'remux':
            return 'Remux';
    }
}

function getBulkTaskTypeOption(value: MonitorTaskType) {
    return BULK_TASK_TYPES.find((type) => type === value)!;
}

export function MonitorBulkEditDialog({
    open,
    selectedCount,
    onOpenChange,
    onApply,
}: MonitorBulkEditDialogProps) {
    const [applyActive, setApplyActive] = useState(false);
    const [applyTaskType, setApplyTaskType] = useState(false);
    const [applySplitScope, setApplySplitScope] = useState(false);
    const [applyFramePacingScope, setApplyFramePacingScope] = useState(false);
    const [applyResolution, setApplyResolution] = useState(false);
    const [applyNvencOverwriteOriginal, setApplyNvencOverwriteOriginal] = useState(false);
    const [applySchedule, setApplySchedule] = useState(false);
    const [applyDeleteVideo, setApplyDeleteVideo] = useState(false);
    const [applyFillMissingSubtitles, setApplyFillMissingSubtitles] = useState(false);

    const [isActive, setIsActive] = useState(true);
    const [taskTypes, setTaskTypes] = useState<MonitorTaskType[]>(['split', 'subtitle']);
    const [splitScope, setSplitScope] = useState<'both' | 'uncensored' | 'censored'>('both');
    const [framePacingScope, setFramePacingScope] = useState<'all' | 'split'>('all');
    const [framePacingResolutions, setFramePacingResolutions] = useState<MonitorResolution[]>([]);
    const [nvencOverwriteOriginal, setNvencOverwriteOriginal] = useState(false);
    const [language, setLanguage] = useState('en');
    const [interval, setInterval] = useState<'hourly' | 'daily' | 'weekly'>('daily');
    const [time, setTime] = useState('09:00');
    const [dayOfWeek, setDayOfWeek] = useState(1);
    const [deleteVideo, setDeleteVideo] = useState(false);
    const [fillMissingSubtitles, setFillMissingSubtitles] = useState(false);
    const usesSubtitleLanguage = taskTypes.some((type) => type === 'subtitle');
    const usesDeleteVideoAfterCompletion = taskTypes.some((type) => type === 'split');
    const usesFramePacingRepair = taskTypes.some((type) => type === 'analyze_frame_pacing' || type === 'nvenc_frame_pacing');
    const usesResolutionFilter = usesDeleteVideoAfterCompletion || usesFramePacingRepair;

    const canApply = (applyActive || applyTaskType || applySplitScope || applyFramePacingScope || applyResolution || applyNvencOverwriteOriginal || applySchedule || applyDeleteVideo || applyFillMissingSubtitles) && (!applyTaskType || taskTypes.length > 0);

    const handleApply = () => {
        const patch: Partial<DirectoryMonitor> = {};
        if (applyActive) patch.isActive = isActive;
        if (applyTaskType) {
            patch.taskType = taskTypes[0] ?? 'split';
            patch.taskTypes = taskTypes;
            patch.subtitleLanguage = usesSubtitleLanguage ? language : undefined;
        }
        if (applySchedule) {
            patch.schedule = buildBulkSchedulePatch(interval, time, dayOfWeek);
        }
        if (applySplitScope) patch.splitScope = splitScope;
        if (applyFramePacingScope) patch.framePacingScope = framePacingScope;
        if (applyResolution) {
            patch.framePacingResolution = 'all';
            patch.framePacingResolutions = framePacingResolutions;
        }
        if (applyNvencOverwriteOriginal) patch.nvencOverwriteOriginal = nvencOverwriteOriginal;
        if (applyTaskType && !usesFramePacingRepair) patch.framePacingScope = 'all';
        if (applyTaskType && !usesFramePacingRepair) patch.nvencOverwriteOriginal = false;
        if (applyTaskType && !usesResolutionFilter) patch.framePacingResolution = 'all';
        if (applyTaskType && !usesResolutionFilter) patch.framePacingResolutions = [];
        if (applyDeleteVideo) patch.deleteVideoAfterCompletion = usesDeleteVideoAfterCompletion ? deleteVideo : false;
        if (applyTaskType && !usesDeleteVideoAfterCompletion) patch.deleteVideoAfterCompletion = false;
        if (applyFillMissingSubtitles) patch.fillMissingSubtitles = fillMissingSubtitles;
        onApply(patch);
        onOpenChange(false);
    };

    const toggleTaskType = (type: MonitorTaskType) => {
        setTaskTypes((prev) => normalizeTaskTypes(prev, type));
    };

    const renderTaskTypeOption = (type: MonitorTaskType) => {
        const disabled = isTaskTypeDisabled(taskTypes, type);
        return (
            <Label
                key={type}
                htmlFor={`bulk-type-${type}`}
                className={`flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg border p-2.5 text-sm transition-all ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${taskTypes.includes(type) ? 'border-primary bg-primary/10' : disabled ? 'border-border' : 'border-border hover:border-primary/50'}`}
            >
                <Checkbox id={`bulk-type-${type}`} checked={taskTypes.includes(type)} disabled={disabled} onCheckedChange={() => toggleTaskType(type)} className="sr-only" />
                {getTaskTypeIcon(type)}
                <span className="text-center">{getTaskTypeLabel(type)}</span>
            </Label>
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="scrollbar">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Edit3 className="w-5 h-5" />
                        Edit {selectedCount} Monitor{selectedCount !== 1 ? 's' : ''}
                    </DialogTitle>
                    <DialogDescription>
                        Check the fields you want to apply to all selected monitors.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 py-4">
                    {/* Active State */}
                    <div className="space-y-3 rounded-lg border border-border p-4">
                        <div className="flex items-center gap-2">
                            <Checkbox id="apply-active" checked={applyActive} onCheckedChange={(c) => setApplyActive(!!c)} />
                            <Label htmlFor="apply-active" className="font-medium text-base cursor-pointer">Active State</Label>
                        </div>
                        {applyActive && (
                            <div className="ml-6 flex gap-3">
                                <Label
                                    htmlFor="bulk-enable"
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all text-sm ${isActive ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                                >
                                    <RadioGroup value={String(isActive)} onValueChange={(v) => setIsActive(v === 'true')}>
                                        <RadioGroupItem value="true" id="bulk-enable" className="sr-only" />
                                    </RadioGroup>
                                    Enable
                                </Label>
                                <Label
                                    htmlFor="bulk-disable"
                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all text-sm ${!isActive ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                                >
                                    <RadioGroup value={String(isActive)} onValueChange={(v) => setIsActive(v === 'true')}>
                                        <RadioGroupItem value="false" id="bulk-disable" className="sr-only" />
                                    </RadioGroup>
                                    Disable
                                </Label>
                            </div>
                        )}
                    </div>

                    {/* Task Type */}
                    <div className="space-y-3 rounded-lg border border-border p-4">
                        <div className="flex items-center gap-2">
                            <Checkbox id="apply-tasktype" checked={applyTaskType} onCheckedChange={(c) => setApplyTaskType(!!c)} />
                            <Label htmlFor="apply-tasktype" className="font-medium text-base cursor-pointer">Task Type</Label>
                        </div>
                        {applyTaskType && (
                            <div className="ml-6 space-y-3">
                                <div className="space-y-2">
                                    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
                                        {renderTaskTypeOption(getBulkTaskTypeOption('scene'))}
                                        <span className="self-center text-xs font-medium text-muted-foreground">-or-</span>
                                        {renderTaskTypeOption(getBulkTaskTypeOption('split'))}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {renderTaskTypeOption(getBulkTaskTypeOption('subtitle'))}
                                    </div>
                                    <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
                                        {renderTaskTypeOption(getBulkTaskTypeOption('analyze_frame_pacing'))}
                                        <span className="self-center text-xs font-medium text-muted-foreground">-or-</span>
                                        {renderTaskTypeOption(getBulkTaskTypeOption('nvenc_frame_pacing'))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Task-specific options */}
                    <div className="space-y-4">
                        <div className="space-y-3 rounded-lg border border-border p-4">
                            <div className="flex items-center gap-2 text-base font-semibold">
                                <Scissors className="h-4 w-4 text-muted-foreground" />
                                Split Options
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="apply-split-scope"
                                        checked={applySplitScope}
                                        onCheckedChange={(checked) => setApplySplitScope(!!checked)}
                                    />
                                    <Label htmlFor="apply-split-scope" className="font-medium text-sm cursor-pointer">
                                        Videos to Split
                                    </Label>
                                </div>
                                {applySplitScope && (
                                    <div className="ml-6 space-y-1.5">
                                        <Label className="text-muted-foreground">Split scope</Label>
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
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="apply-resolution"
                                        checked={applyResolution}
                                        onCheckedChange={(checked) => setApplyResolution(!!checked)}
                                    />
                                    <Label htmlFor="apply-resolution" className="font-medium text-base cursor-pointer">
                                        Split / Frame Pacing Resolution
                                    </Label>
                                </div>
                                {applyResolution && (
                                    <div className="ml-6 space-y-1.5">
                                        <Label className="text-xs text-muted-foreground">Resolution to process</Label>
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
                            </div>

                            {applyTaskType && usesDeleteVideoAfterCompletion && (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Checkbox id="apply-delete-video" checked={applyDeleteVideo} onCheckedChange={(c) => setApplyDeleteVideo(!!c)} />
                                        <Label htmlFor="apply-delete-video" className="font-medium cursor-pointer">Delete Source Video After Completion</Label>
                                    </div>
                                    {applyDeleteVideo && (
                                        <div className="ml-6 flex gap-3">
                                            <Label
                                                htmlFor="bulk-delete-enable"
                                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all text-sm ${deleteVideo ? 'cursor-pointer border-primary bg-primary/10' : 'cursor-pointer border-border hover:border-primary/50'}`}
                                            >
                                                <RadioGroup
                                                    value={String(deleteVideo)}
                                                    onValueChange={(v) => setDeleteVideo(v === 'true')}
                                                >
                                                    <RadioGroupItem value="true" id="bulk-delete-enable" className="sr-only" />
                                                </RadioGroup>
                                                Enable
                                            </Label>
                                            <Label
                                                htmlFor="bulk-delete-disable"
                                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all text-sm ${!deleteVideo ? 'border-primary bg-primary/10' : 'cursor-pointer border-border hover:border-primary/50'}`}
                                            >
                                                <RadioGroup
                                                    value={String(deleteVideo)}
                                                    onValueChange={(v) => setDeleteVideo(v === 'true')}
                                                >
                                                    <RadioGroupItem value="false" id="bulk-delete-disable" className="sr-only" />
                                                </RadioGroup>
                                                Disable
                                            </Label>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="space-y-3 rounded-lg border border-border p-4">
                            <div className="flex items-center gap-2 text-base font-semibold">
                                <Subtitles className="h-4 w-4 text-muted-foreground" />
                                Subtitle Options
                            </div>

                            {applyTaskType && usesSubtitleLanguage && (
                                <div className="ml-6 space-y-1.5">
                                    <Label className="text-xs text-muted-foreground">Subtitle Language</Label>
                                    <Select value={language} onValueChange={setLanguage}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {LANGUAGES.map((lang) => (
                                                <SelectItem key={lang.value} value={lang.value}>{lang.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}

                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Checkbox id="apply-fill-subtitles" checked={applyFillMissingSubtitles} onCheckedChange={(c) => setApplyFillMissingSubtitles(!!c)} />
                                    <Label htmlFor="apply-fill-subtitles" className="font-medium cursor-pointer">Fill Missing Subtitles</Label>
                                </div>
                                {applyFillMissingSubtitles && (
                                    <div className="ml-6 flex gap-3">
                                        <Label
                                            htmlFor="bulk-fill-subtitles-enable"
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all text-sm ${fillMissingSubtitles ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                                        >
                                            <RadioGroup value={String(fillMissingSubtitles)} onValueChange={(v) => setFillMissingSubtitles(v === 'true')}>
                                                <RadioGroupItem value="true" id="bulk-fill-subtitles-enable" className="sr-only" />
                                            </RadioGroup>
                                            Enable
                                        </Label>
                                        <Label
                                            htmlFor="bulk-fill-subtitles-disable"
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all text-sm ${!fillMissingSubtitles ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                                        >
                                            <RadioGroup value={String(fillMissingSubtitles)} onValueChange={(v) => setFillMissingSubtitles(v === 'true')}>
                                                <RadioGroupItem value="false" id="bulk-fill-subtitles-disable" className="sr-only" />
                                            </RadioGroup>
                                            Disable
                                        </Label>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-3 rounded-lg border border-border p-4">
                            <div className="flex items-center gap-2 text-base font-semibold">
                                <RefreshCcw className="h-4 w-4 text-muted-foreground" />
                                Frame Pacing Options
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="apply-frame-pacing-scope"
                                        checked={applyFramePacingScope}
                                        onCheckedChange={(checked) => setApplyFramePacingScope(!!checked)}
                                    />
                                    <Label htmlFor="apply-frame-pacing-scope" className="font-medium cursor-pointer">
                                        Videos to Process
                                    </Label>
                                </div>
                                {applyFramePacingScope && (
                                    <div className="ml-6 space-y-1.5">
                                        <Label className="text-xs text-muted-foreground">Frame pacing videos</Label>
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
                                )}
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id="apply-nvenc-overwrite-original"
                                        checked={applyNvencOverwriteOriginal}
                                        onCheckedChange={(checked) => setApplyNvencOverwriteOriginal(!!checked)}
                                    />
                                    <Label htmlFor="apply-nvenc-overwrite-original" className="font-medium cursor-pointer">
                                        Overwrite Original Video
                                    </Label>
                                </div>
                                {applyNvencOverwriteOriginal && (
                                    <div className="ml-6 space-y-1.5">
                                        <Label className="text-xs text-muted-foreground">Overwrite original video after repair</Label>
                                        <RadioGroup
                                            value={nvencOverwriteOriginal ? 'yes' : 'no'}
                                            onValueChange={(value) => setNvencOverwriteOriginal(value === 'yes')}
                                            className="flex gap-3"
                                        >
                                            <Label
                                                htmlFor="bulk-nvenc-overwrite-no"
                                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm ${!nvencOverwriteOriginal ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                                            >
                                                <RadioGroupItem value="no" id="bulk-nvenc-overwrite-no" className="sr-only" />
                                                <span>No</span>
                                            </Label>
                                            <Label
                                                htmlFor="bulk-nvenc-overwrite-yes"
                                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm ${nvencOverwriteOriginal ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                                            >
                                                <RadioGroupItem value="yes" id="bulk-nvenc-overwrite-yes" className="sr-only" />
                                                <span>Yes</span>
                                            </Label>
                                        </RadioGroup>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Schedule */}
                    <div className="space-y-3 rounded-lg border border-border p-4">
                        <div className="flex items-center gap-2">
                            <Checkbox id="apply-schedule" checked={applySchedule} onCheckedChange={(c) => setApplySchedule(!!c)} />
                            <Label htmlFor="apply-schedule" className="font-medium text-base cursor-pointer">Schedule</Label>
                        </div>
                        {applySchedule && (
                            <div className="ml-6 space-y-3">
                                <RadioGroup
                                    value={interval}
                                    onValueChange={(v) => setInterval(v as 'hourly' | 'daily' | 'weekly')}
                                    className="flex gap-3"
                                >
                                    {(['hourly', 'daily', 'weekly'] as const).map((i) => (
                                        <Label
                                            key={i}
                                            htmlFor={`bulk-interval-${i}`}
                                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm ${interval === i ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                                        >
                                            <RadioGroupItem value={i} id={`bulk-interval-${i}`} className="sr-only" />
                                            <span className="capitalize">{i}</span>
                                        </Label>
                                    ))}
                                </RadioGroup>
                                {interval !== 'hourly' && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs text-muted-foreground">Time</Label>
                                            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                                        </div>
                                        {interval === 'weekly' && (
                                            <div className="space-y-1.5">
                                                <Label className="text-xs text-muted-foreground">Day of Week</Label>
                                                <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {DAYS_OF_WEEK.map((day) => (
                                                            <SelectItem key={day.value} value={String(day.value)}>{day.label}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleApply} disabled={!canApply}>
                        Apply to {selectedCount} monitor{selectedCount !== 1 ? 's' : ''}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
