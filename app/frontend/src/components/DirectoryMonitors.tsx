import { useState } from 'react';
import { Directory, DirectoryMonitor, TaskType } from '@/types/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
    FolderOpen,
    Clock,
    Trash2,
    Play,
    Scissors,
    Calendar,
    Edit3,
    RefreshCcw,
    CheckSquare
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { utcTimeToLocal } from '@/lib/utils';

interface DirectoryMonitorsProps {
    directories: Directory[];
    monitors: DirectoryMonitor[];
    onToggleActive: (id: string) => void;
    onDelete: (id: string) => void;
    onRunNow: (directories: Directory[], path: string) => void;
    onEdit: (monitor: DirectoryMonitor) => void;
}

function getTaskTypeLabel(type: TaskType | 'both') {
    switch (type) {
        case 'split':
            return 'Split';
        case 'subtitle':
            return 'Subtitle';
        case 'both':
        case 'all':
        case 'merge':
        case 'scene':
            return 'Split & Subtitle';
        case 'analyze_frame_pacing':
            return 'Analyze + Frame Pacing Repair';
        case 'nvenc_frame_pacing':
            return 'Frame Pacing Repair';
        case 'remux':
            return 'Remux';
    }
}

function getMonitorTaskTypes(monitor: DirectoryMonitor): TaskType[] {
    return monitor.taskTypes?.length ? monitor.taskTypes : [monitor.taskType];
}

function monitorIncludesSplitWork(monitor: DirectoryMonitor): boolean {
    const taskTypes = getMonitorTaskTypes(monitor);
    return taskTypes.includes('split') || taskTypes.includes('all');
}

function monitorIncludesFramePacingWork(monitor: DirectoryMonitor): boolean {
    const taskTypes = getMonitorTaskTypes(monitor);
    return taskTypes.includes('analyze_frame_pacing') || taskTypes.includes('nvenc_frame_pacing');
}

function getMonitorTaskTypeLabel(monitor: DirectoryMonitor): string {
    return getMonitorTaskTypes(monitor).map(getTaskTypeLabel).join(', ');
}

function getSplitScopeLabel(scope: DirectoryMonitor['splitScope']): string {
    switch (scope) {
        case 'uncensored':
            return 'Uncensored';
        case 'censored':
            return 'Censored';
        case 'both':
        default:
            return 'Both';
    }
}

function getFramePacingScopeLabel(scope: DirectoryMonitor['framePacingScope']): string {
    return scope === 'split' ? 'Split videos only' : 'All videos';
}

function getFramePacingResolutionLabel(resolution: DirectoryMonitor['framePacingResolution']): string {
    switch (resolution) {
        case 'sd':
            return 'SD';
        case '720p':
        case '1080p':
        case '1440p':
            return resolution;
        case 'all':
        default:
            return 'All eligible resolutions';
    }
}

function getFramePacingResolutionsLabel(monitor: DirectoryMonitor): string {
    const resolutions = monitor.framePacingResolutions ?? [];
    if (!resolutions.length) return 'All eligible resolutions';
    return resolutions.map((resolution) => getFramePacingResolutionLabel(resolution)).join(', ');
}

function formatSchedule(schedule: DirectoryMonitor['schedule']): string {
    const time = schedule.timeZone ? schedule.time : schedule.time ? utcTimeToLocal(schedule.time) : undefined;
    switch (schedule.interval) {
        case 'hourly':
            return 'Every hour';
        case 'daily':
            return `Daily at ${time}`;
        case 'weekly':
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return `Every ${days[schedule.dayOfWeek ?? 0]} at ${time}`;
    }
}

export function DirectoryMonitors({
    directories,
    monitors,
    onToggleActive,
    onDelete,
    onRunNow,
    onEdit,
}: DirectoryMonitorsProps) {
    // Sort monitors alphabetically by directoryName
    const sortedMonitors = [...monitors].sort((a, b) =>
        a.directoryName.localeCompare(b.directoryName)
    );

    if (sortedMonitors.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-10 text-center sm:py-12">
                <Clock className="mb-3 h-10 w-10 text-muted-foreground/50 sm:mb-4 sm:h-12 sm:w-12" />
                <h3 className="mb-1 text-base font-medium sm:text-lg">No Directory Monitors</h3>
                <p className="max-w-sm text-xs text-muted-foreground sm:text-sm">
                    Set up automatic monitoring to process videos in selected directories on a schedule.
                </p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4">
            {sortedMonitors.map((monitor) => (
                <Card
                    key={monitor.id}
                    className={cn(
                        "transition-all duration-200",
                        !monitor.isActive && "opacity-60"
                    )}
                >
                    <CardContent className="p-3 sm:p-4">
                        <div className="flex items-start justify-between gap-2.5 sm:gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="mb-1.5 flex items-center gap-1.5 sm:mb-2 sm:gap-2">
                                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary sm:h-4 sm:w-4" />
                                    <span className="truncate text-sm font-medium sm:text-base">{monitor.directoryName}</span>
                                    <Badge variant={monitor.isActive ? "default" : "secondary"} className="h-5 shrink-0 px-1.5 text-[10px] sm:h-5 sm:px-2 sm:text-xs">
                                        {monitor.isActive ? 'Active' : 'Paused'}
                                    </Badge>
                                </div>

                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:gap-4 sm:text-sm">
                                    <div className="flex items-center gap-1.5 text-muted-foreground">
                                        <CheckSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                        <span>{getMonitorTaskTypeLabel(monitor)}</span>
                                    </div>

                                    <div className="flex whitespace-nowrap items-center gap-3 text-muted-foreground sm:gap-4">
                                        <span className="inline-flex items-center gap-1.5">
                                            <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                            <span>{formatSchedule(monitor.schedule)}</span>
                                        </span>
                                        {monitor.lastRun && (
                                            <span className="inline-flex items-center gap-1.5">
                                                <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                                <span>Last run: {monitor.lastRun.toLocaleString()}</span>
                                            </span>
                                        )}
                                    </div>

                                    {monitorIncludesFramePacingWork(monitor) && (
                                        <span className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-primary">
                                            <RefreshCcw className="h-3.5 w-3.5" />
                                            <span className="font-medium">Frame Pacing:</span>
                                            <span>{getFramePacingScopeLabel(monitor.framePacingScope)}</span>
                                            <span className="text-primary/50">·</span>
                                            <span>{getFramePacingResolutionsLabel(monitor)}</span>
                                        </span>
                                    )}

                                    {monitor.subtitleLanguage && (
                                        <Badge variant="outline" className="h-5 px-1.5 text-[10px] sm:px-2 sm:text-xs">
                                            {monitor.subtitleLanguage.toUpperCase()}
                                        </Badge>
                                    )}
                                </div>

                                {monitorIncludesSplitWork(monitor) && (
                                    <div className="mt-1.5 flex text-xs sm:mt-2 sm:text-sm">
                                        <span className="inline-flex whitespace-nowrap items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-primary">
                                            <Scissors className="h-3.5 w-3.5" />
                                            <span className="font-medium">Split:</span>
                                            <span>{getSplitScopeLabel(monitor.splitScope)}</span>
                                            <span className="text-primary/50">·</span>
                                            <span>{getFramePacingResolutionsLabel(monitor)}</span>
                                        </span>
                                    </div>
                                )}

                            </div>

                            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                                <Switch
                                    checked={monitor.isActive}
                                    onCheckedChange={() => onToggleActive(monitor.id)}
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onRunNow(directories, monitor.directoryPath)}
                                    disabled={!monitor.isActive}
                                    className="h-7 w-7 sm:h-9 sm:w-9"
                                    title="Run now"
                                >
                                    <Play className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onEdit(monitor)}
                                    className="h-7 w-7 sm:h-9 sm:w-9"
                                    title="Edit monitor"
                                >
                                    <Edit3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onDelete(monitor.id)}
                                    className="h-7 w-7 text-destructive hover:text-destructive sm:h-9 sm:w-9"
                                    title="Delete monitor"
                                >
                                    <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}
