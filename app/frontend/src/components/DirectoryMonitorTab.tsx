import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Directory, DirectoryMonitor, TaskType } from '@/types/types';
import { utcTimeToLocal12h } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    FolderOpen,
    Clock,
    Trash2,
    Play,
    Pause,
    Scissors,
    Calendar,
    Edit3,
    SortAsc,
    Plus,
    CheckSquare,
    Loader2,
    ChevronFirst,
    ChevronLast,
    ChevronLeft,
    ChevronRight,
    RefreshCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MonitorSortField, MONITOR_SORT_OPTIONS, PAGE_SIZE_OPTIONS, PageSize } from '@/hooks/useDirectoryMonitorList';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import FileSearch from '@/components/FileSearch';

const compactToolbarButtonClass = "h-8 gap-1.5 px-2 text-xs sm:h-9 sm:gap-2 sm:px-3 sm:text-sm";
const compactToolbarIconClass = "h-3.5 w-3.5 sm:h-4 sm:w-4";
const compactPageButtonClass = "min-h-0 rounded-md border text-xs font-medium sm:text-sm";
const compactPageIconClass = "h-3.5 w-3.5 sm:h-4 sm:w-4";

interface DirectoryMonitorsProps {
    directories: Directory[];
    monitors: DirectoryMonitor[];
    totalMonitors: number;
    pageSize: PageSize;
    currentPage: number;
    totalPages: number;
    selectedIds: Set<string>;
    sortField: MonitorSortField;
    sortDirection: 'asc' | 'desc';
    allSelected: boolean;
    onSelectMonitor: (id: string) => void;
    onRangeSelect: (ids: string[]) => void;
    onSortFieldChange: (field: MonitorSortField) => void;
    onToggleSortDirection: () => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onToggleActive: (id: string) => void;
    onDelete: (id: string) => void;
    onRunNow: (path: string) => Promise<{ queued: number; skipped: number }>;
    onEdit: (monitor: DirectoryMonitor) => void;
    onAddMonitor: () => void;
    onBulkEnable: () => void;
    onBulkDisable: () => void;
    onBulkDelete: () => void;
    onBulkEdit: () => void;
    onBulkRunNow: () => void;
    onPageSizeChange: (size: PageSize) => void;
    onPageChange: (page: number) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
}

function getTaskTypeLabel(type: TaskType) {
    switch (type) {
        case 'scene':
            return 'Scene';
        case 'split':
            return 'Split';
        case 'subtitle':
            return 'Subtitle';
        case 'all':
            return 'Split & Subtitle';
        case 'merge':
            return 'Merge';
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

function getMonitorTaskTypeLabel(monitor: DirectoryMonitor): string {
    return getMonitorTaskTypes(monitor).map(getTaskTypeLabel).join(', ');
}

function monitorIncludesSplitWork(monitor: DirectoryMonitor): boolean {
    const taskTypes = getMonitorTaskTypes(monitor);
    return taskTypes.includes('split') || taskTypes.includes('all');
}

function monitorIncludesFramePacingWork(monitor: DirectoryMonitor): boolean {
    const taskTypes = getMonitorTaskTypes(monitor);
    return taskTypes.includes('analyze_frame_pacing') || taskTypes.includes('nvenc_frame_pacing');
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

function localTimeTo12h(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatScheduleTime(schedule: DirectoryMonitor['schedule']): string {
    const time = schedule.time ?? '09:00';
    return schedule.timeZone ? localTimeTo12h(time) : utcTimeToLocal12h(time);
}

export function formatSchedule(schedule: DirectoryMonitor['schedule']): string {
    switch (schedule.interval) {
        case 'hourly':
            return 'Every hour';
        case 'daily':
            return `Daily at ${formatScheduleTime(schedule)}`;
        case 'weekly': {
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return `Every ${days[schedule.dayOfWeek ?? 0]} at ${formatScheduleTime(schedule)}`;
        }
    }
}

export function DirectoryMonitorTab({
    monitors,
    totalMonitors,
    pageSize,
    currentPage,
    totalPages,
    selectedIds,
    sortField,
    sortDirection,
    allSelected,
    onSelectMonitor,
    onRangeSelect,
    onSortFieldChange,
    onToggleSortDirection,
    onSelectAll,
    onClearSelection,
    onToggleActive,
    onDelete,
    onRunNow,
    onEdit,
    onAddMonitor,
    onBulkEnable,
    onBulkDisable,
    onBulkDelete,
    onBulkEdit,
    onBulkRunNow,
    onPageSizeChange,
    onPageChange,
    searchQuery,
    onSearchChange,
}: DirectoryMonitorsProps) {
    const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [searchFocused, setSearchFocused] = useState(false);
    const [runningPaths, setRunningPaths] = useState<Set<string>>(new Set());
    const isMountedRef = useRef(true);
    const anchorIndexRef = useRef<number | null>(null);
    const selectedCount = selectedIds.size;
    const runnableSelectedCount = monitors.filter((monitor) => selectedIds.has(monitor.id) && monitor.isActive).length;

    useEffect(() => { anchorIndexRef.current = null; }, [monitors]);

    const handleMonitorClick = useCallback((monitor: DirectoryMonitor, index: number, e: React.MouseEvent) => {
        if (e.shiftKey && anchorIndexRef.current !== null) {
            e.preventDefault();
            const start = Math.min(anchorIndexRef.current, index);
            const end = Math.max(anchorIndexRef.current, index);
            onRangeSelect(monitors.slice(start, end + 1).map(m => m.id));
        } else {
            onSelectMonitor(monitor.id);
            anchorIndexRef.current = index;
        }
    }, [monitors, onSelectMonitor, onRangeSelect]);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const sortIcon = ['nextRun', 'lastRun', 'createdAt'].includes(sortField)
        ? <Calendar className={compactToolbarIconClass} />
        : sortField === 'interval'
            ? <Clock className={compactToolbarIconClass} />
            : <SortAsc className={compactToolbarIconClass} />;

    if (totalMonitors === 0 && !searchQuery) {
        return (
            <div className="flex flex-col gap-4 overflow-y-auto h-full">
                <div className="flex justify-end">
                    <Button variant="outline" onClick={onAddMonitor} className={compactToolbarButtonClass}>
                        <Plus className={compactToolbarIconClass} />
                        Add Monitor
                    </Button>
                </div>
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Clock className="w-12 h-12 text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium mb-1">No Directory Monitors</h3>
                    <p className="text-sm text-muted-foreground max-w-sm">
                        Set up automatic monitoring to process videos in selected directories on a schedule.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <>
            <div className="flex flex-col gap-1 sm:gap-4 h-full min-h-0">
                <div className="flex flex-col gap-2 pr-1 py-2 -my-1 lg:flex-row lg:items-center">
                    <div className="order-1 flex min-w-0 flex-wrap items-center gap-2 lg:order-2 lg:ml-auto">
                        <Button variant="outline" onClick={onAddMonitor} className={cn(compactToolbarButtonClass, "w-full lg:w-auto")}>
                            <Plus className={compactToolbarIconClass} />
                            Add Monitor
                        </Button>
                        <div className="inline-flex w-full max-w-full rounded-md shadow-sm sm:w-auto">
                            <DropdownMenu open={isSortDropdownOpen} onOpenChange={setIsSortDropdownOpen}>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(compactToolbarButtonClass, "flex-1 rounded-r-none border-r-0 focus-visible:ring-0 focus-visible:ring-offset-0 sm:flex-none")}
                                    >
                                        {sortIcon}
                                        {MONITOR_SORT_OPTIONS.find((o) => o.value === sortField)?.label}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="w-44">
                                    {MONITOR_SORT_OPTIONS.map((opt) => (
                                        <DropdownMenuItem
                                            key={opt.value}
                                            className="cursor-pointer"
                                            onClick={() => { onSortFieldChange(opt.value); setIsSortDropdownOpen(false); }}
                                        >
                                            {opt.label}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                                variant="outline"
                                onClick={onToggleSortDirection}
                                className={cn(compactToolbarButtonClass, "flex-1 rounded-l-none border-l-0 px-2 sm:flex-none sm:px-3")}
                            >
                                {sortDirection === 'asc' ? (
                                    <><span>↑</span><span className="hidden sm:inline">Asc</span></>
                                ) : (
                                    <><span>↓</span><span className="hidden sm:inline">Desc</span></>
                                )}
                            </Button>
                        </div>
                        <div className="w-full min-w-0 sm:w-auto">
                            <FileSearch
                                fileSearchQuery={searchQuery}
                                setFileSearchQuery={onSearchChange}
                                searchFocused={searchFocused}
                                setSearchFocused={setSearchFocused}
                            />
                        </div>
                    </div>
                </div>

                {selectedCount > 0 && (
                    <div className="flex flex-col gap-2 rounded-md border bg-card p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-3">
                        <span className="shrink-0 text-sm font-medium">
                            {selectedCount} monitor{selectedCount !== 1 ? 's' : ''} selected
                        </span>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Button variant="outline" onClick={allSelected ? onClearSelection : onSelectAll} className={compactToolbarButtonClass}>
                                <CheckSquare className={compactToolbarIconClass} />
                                {allSelected ? `All ${monitors.length}` : `Select all ${monitors.length}`}
                            </Button>
                            <Button variant="outline" onClick={onClearSelection} className={compactToolbarButtonClass}>
                                Deselect All
                            </Button>
                            <Button
                                variant="outline"
                                onClick={onBulkRunNow}
                                disabled={runnableSelectedCount === 0}
                                className={compactToolbarButtonClass}
                            >
                                <Play className={compactToolbarIconClass} />
                                Run Selected
                            </Button>
                            <Button variant="outline" onClick={onBulkEnable} className={compactToolbarButtonClass}>
                                <Play className={compactToolbarIconClass} />
                                Enable
                            </Button>
                            <Button variant="outline" onClick={onBulkDisable} className={compactToolbarButtonClass}>
                                <Pause className={compactToolbarIconClass} />
                                Disable
                            </Button>
                            <Button variant="outline" onClick={onBulkEdit} className={compactToolbarButtonClass}>
                                <Edit3 className={compactToolbarIconClass} />
                                Edit
                            </Button>
                            <Button
                                variant="outline"
                                className={cn(compactToolbarButtonClass, "text-destructive hover:text-destructive")}
                                onClick={() => setConfirmDeleteOpen(true)}
                            >
                                <Trash2 className={compactToolbarIconClass} />
                                Delete
                            </Button>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-2.5 overflow-y-auto scrollbar py-1 pr-2 pl-1 flex-1 min-h-0 items-start content-start md:grid-cols-2 md:gap-4 2xl:grid-cols-3">
                    {totalMonitors === 0 && searchQuery && (
                        <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
                            <Clock className="w-12 h-12 text-muted-foreground/50 mb-4" />
                            <p className="text-sm font-medium">No monitors match your search</p>
                        </div>
                    )}
                    {monitors.map((monitor, index) => {
                        const isSelected = selectedIds.has(monitor.id);
                        return (
                            <Card
                                key={monitor.id}
                                onClick={(e) => handleMonitorClick(monitor, index, e)}
                                onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                                tabIndex={-1}
                                className={cn(
                                    "transition-all duration-200 cursor-pointer",
                                    !monitor.isActive && "opacity-60",
                                    isSelected && "ring-2 ring-primary bg-primary/5"
                                )}
                            >
                                <CardContent className="p-2.5 sm:p-4">
                                    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="mb-1.5 flex flex-wrap items-center gap-1.5 sm:mb-2 sm:gap-2">
                                                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary sm:h-4 sm:w-4" />
                                                <span className="text-sm font-medium sm:text-base">{monitor.directoryName}</span>
                                                <Badge variant={monitor.isActive ? "default" : "secondary"} className="h-5 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs">
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

                                            {(monitor.subtitleLanguage || monitor.deleteVideoAfterCompletion || monitor.fillMissingSubtitles) && (
                                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:mt-2 sm:gap-2">
                                                    {monitor.subtitleLanguage && (
                                                        <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs">
                                                            {monitor.subtitleLanguage.toUpperCase()}
                                                        </Badge>
                                                    )}
                                                    {monitor.deleteVideoAfterCompletion && (
                                                        <Badge variant="outline" className="h-5 shrink-0 border-destructive/50 px-1.5 text-[10px] text-destructive sm:px-2 sm:text-xs">
                                                            Delete Source
                                                        </Badge>
                                                    )}
                                                    {monitor.fillMissingSubtitles && (
                                                        <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] sm:px-2 sm:text-xs">
                                                            Fill Subtitles
                                                        </Badge>
                                                    )}
                                                </div>
                                            )}

                                        </div>

                                        <div className="flex items-center justify-end gap-1 shrink-0 sm:gap-2" onClick={(e) => e.stopPropagation()}>
                                            <Switch
                                                checked={monitor.isActive}
                                                onCheckedChange={() => onToggleActive(monitor.id)}
                                            />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={async () => {
                                                    if (!isMountedRef.current) return;
                                                    setRunningPaths((prev) => new Set(prev).add(monitor.directoryPath));
                                                    try {
                                                        await onRunNow(monitor.directoryPath);
                                                    } finally {
                                                        if (isMountedRef.current) {
                                                            setRunningPaths((prev) => {
                                                                const next = new Set(prev);
                                                                next.delete(monitor.directoryPath);
                                                                return next;
                                                            });
                                                        }
                                                    }
                                                }}
                                                disabled={!monitor.isActive || runningPaths.has(monitor.directoryPath)}
                                                className="h-6 w-6 sm:h-9 sm:w-9"
                                                title="Run now"
                                            >
                                                {runningPaths.has(monitor.directoryPath)
                                                    ? <Loader2 className="h-3 w-3 animate-spin sm:h-4 sm:w-4" />
                                                    : <Play className="h-3 w-3 sm:h-4 sm:w-4" />}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onEdit(monitor)}
                                                className="h-6 w-6 sm:h-9 sm:w-9"
                                                title="Edit monitor"
                                            >
                                                <Edit3 className="h-3 w-3 sm:h-4 sm:w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => onDelete(monitor.id)}
                                                className="h-6 w-6 text-destructive hover:text-destructive sm:h-9 sm:w-9"
                                                title="Delete monitor"
                                            >
                                                <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>

                {totalPages >= 1 && (
                    <div className="grid flex-none shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                        <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:gap-2 sm:text-sm">
                            <span>Per page:</span>
                            <Select value={String(pageSize)} onValueChange={(v) => { onPageSizeChange(Number(v) as PageSize); onPageChange(1); }}>
                                <SelectTrigger className="h-8 w-[68px] text-xs sm:h-[40px] sm:w-[80px] sm:text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="min-w-0 w-[68px] sm:w-[80px]">
                                    {PAGE_SIZE_OPTIONS.map((s) => (
                                        <SelectItem key={s} value={String(s)} className="pl-2 text-xs sm:text-sm [&>span:first-child]:hidden">{s}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="scrollbar flex min-w-0 max-w-full justify-self-center gap-1.5 overflow-x-auto px-1 sm:gap-2">
                            <button
                                onClick={() => onPageChange(1)}
                                className={cn(compactPageButtonClass, `p-1.5 sm:p-2 ${currentPage === 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`)}
                                disabled={currentPage === 1}
                                aria-label="First page"
                            >
                                <ChevronFirst className={compactPageIconClass} />
                            </button>

                            <button
                                onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                                className={cn(compactPageButtonClass, `p-1.5 sm:p-2 ${currentPage === 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`)}
                                disabled={currentPage === 1}
                                aria-label="Previous page"
                            >
                                <ChevronLeft className={compactPageIconClass} />
                            </button>

                            {(() => {
                                const maxVisiblePages = 5;
                                let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
                                let endPage = startPage + maxVisiblePages - 1;
                                if (endPage > totalPages) {
                                    startPage = Math.max(1, totalPages - maxVisiblePages + 1);
                                    endPage = totalPages;
                                }
                                const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
                                return (
                                    <>
                                        {startPage > 1 && (
                                            <>
                                                <button onClick={() => onPageChange(1)} className={cn(compactPageButtonClass, "bg-transparent px-2 py-1 hover:bg-muted sm:px-3 sm:py-1.5")}>1</button>
                                                {startPage > 2 && <span className="px-2 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm">...</span>}
                                            </>
                                        )}
                                        {pageNumbers.map(page => (
                                            <button
                                                key={page}
                                                onClick={() => onPageChange(page)}
                                                className={cn(compactPageButtonClass, `px-2 py-1 sm:px-3 sm:py-1.5 ${currentPage === page ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`)}
                                            >
                                                {page}
                                            </button>
                                        ))}
                                        {endPage < totalPages && (
                                            <>
                                                {endPage < totalPages - 1 && <span className="px-2 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm">...</span>}
                                                <button onClick={() => onPageChange(totalPages)} className={cn(compactPageButtonClass, "bg-transparent px-2 py-1 hover:bg-muted sm:px-3 sm:py-1.5")}>{totalPages}</button>
                                            </>
                                        )}
                                    </>
                                );
                            })()}

                            <button
                                onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                                className={cn(compactPageButtonClass, `p-1.5 sm:p-2 ${currentPage === totalPages ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`)}
                                disabled={currentPage === totalPages}
                                aria-label="Next page"
                            >
                                <ChevronRight className={compactPageIconClass} />
                            </button>

                            <button
                                onClick={() => onPageChange(totalPages)}
                                className={cn(compactPageButtonClass, `p-1.5 sm:p-2 ${currentPage === totalPages ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`)}
                                disabled={currentPage === totalPages}
                                aria-label="Last page"
                            >
                                <ChevronLast className={compactPageIconClass} />
                            </button>
                        </div>
                        <div className="whitespace-nowrap text-right text-xs text-muted-foreground">
                            Showing {Math.min((currentPage - 1) * pageSize + 1, totalMonitors)} – {Math.min(currentPage * pageSize, totalMonitors)} of {totalMonitors} monitors
                        </div>
                    </div>
                )}
            </div>

            <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {selectedCount} monitor{selectedCount !== 1 ? 's' : ''}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the selected directory monitors. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => { onBulkDelete(); setConfirmDeleteOpen(false); }}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
