import { Filter, ChevronsUpDown, Tag, FolderOpen, Layers, FileText, Calendar, Activity, HardDrive, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog"
import { Button } from "./ui/button"
import { Label } from "./ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { Checkbox } from "./ui/checkbox"
import { Switch } from "./ui/switch"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { useState } from "react"
import { DirectoryRecord } from "@/types/types"
import {
    FileStatus,
    FileType,
    FileFormat,
    DateRange,
    FileResolution,
    FileSizeOperator,
    FileContentTag,
    FileFilterState,
} from "@/lib/file-filters"
import { SavedFileFiltersSection } from "./SavedFileFiltersSection"

export type { FileStatus, FileType, FileFormat, DateRange, FileResolution, FileSizeOperator, FileContentTag, FileFilterState }
interface FilterDialogProps {
    isFilterActive: boolean
    handleResetFilters: () => void
    isFilterDialogOpen: boolean
    setIsFilterDialogOpen: (open: boolean) => void
    fileTypeFilter: FileType[]
    setFileTypeFilter: (v: FileType[]) => void
    fileFormatFilter: FileFormat[]
    setFileFormatFilter: (v: FileFormat[]) => void
    dateRangeFilter: DateRange[]
    setDateRangeFilter: (v: DateRange[]) => void
    handleApplyFilters: () => void
    onOpen?: () => void
    hasScenes: boolean
    setHasScenes: (v: boolean) => void
    hasSplit: boolean
    setHasSplit: (v: boolean) => void
    hasSubtitle: boolean
    setHasSubtitle: (v: boolean) => void
    hasNoScenes: boolean
    setHasNoScenes: (v: boolean) => void
    hasNoSplit: boolean
    setHasNoSplit: (v: boolean) => void
    hasNoSubtitle: boolean
    setHasNoSubtitle: (v: boolean) => void
    isGroupedView: boolean
    setIsGroupedView: (v: boolean) => void
    directories: DirectoryRecord[]
    selectedDirectoryIds: string[]
    setSelectedDirectoryIds: (ids: string[]) => void
    directoryExclude: boolean
    setDirectoryExclude: (v: boolean) => void
    statusFilter: FileStatus[]
    setStatusFilter: (v: FileStatus[]) => void
    queueDisabled: boolean
    setQueueDisabled: (v: boolean) => void
    queueDisabledNo: boolean
    setQueueDisabledNo: (v: boolean) => void
    splitDisabled: boolean
    setSplitDisabled: (v: boolean) => void
    splitDisabledNo: boolean
    setSplitDisabledNo: (v: boolean) => void
    subtitleDisabled: boolean
    setSubtitleDisabled: (v: boolean) => void
    subtitleDisabledNo: boolean
    setSubtitleDisabledNo: (v: boolean) => void
    noNumberSuffix: boolean
    setNoNumberSuffix: (v: boolean) => void
    newVideos: boolean
    setNewVideos: (v: boolean) => void
    contentTag: FileContentTag | null
    setContentTag: (v: FileContentTag | null) => void
    resolutionFilter: FileResolution[]
    setResolutionFilter: (v: FileResolution[]) => void
    fileSizeOperator: FileSizeOperator
    setFileSizeOperator: (v: FileSizeOperator) => void
    fileSizeValue: number | null
    setFileSizeValue: (v: number | null) => void
    onLoadPreset: (filters: FileFilterState) => void
    onSetDefaultPreset: (presetId: string | null) => Promise<void>
}

function MultiSelect<T extends string>({
    options,
    values,
    onChange,
    placeholder,
}: {
    options: { value: T; label: string }[]
    values: T[]
    onChange: (values: T[]) => void
    placeholder: string
}) {
    const [open, setOpen] = useState(false)

    const toggle = (value: T) => {
        onChange(values.includes(value) ? values.filter(v => v !== value) : [...values, value])
    }

    const displayLabel =
        values.length === 0
            ? placeholder
            : values.length === 1
                ? options.find(o => o.value === values[0])?.label ?? values[0]
                : `${values.length} selected`

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal h-9">
                    <span className="truncate text-sm">{displayLabel}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="p-1 w-[var(--radix-popover-trigger-width)]" align="start">
                {options.map(opt => (
                    <div
                        key={opt.value}
                        className="flex items-center gap-2 px-2 py-2 rounded-sm cursor-pointer hover:bg-accent select-none"
                        onClick={() => toggle(opt.value)}
                    >
                        <Checkbox checked={values.includes(opt.value)} onCheckedChange={() => toggle(opt.value)} />
                        <span className="text-sm">{opt.label}</span>
                    </div>
                ))}
            </PopoverContent>
        </Popover>
    )
}

const FILE_TYPE_OPTIONS: { value: FileType; label: string }[] = [
    { value: 'video', label: 'Video files' },
    { value: 'subtitle', label: 'Subtitles' },
    { value: 'other', label: 'Other' },
]

const FILE_FORMAT_OPTIONS: { value: FileFormat; label: string }[] = [
    { value: 'mp4', label: 'MP4' },
    { value: 'mov', label: 'MOV' },
    { value: 'avi', label: 'AVI' },
    { value: 'mkv', label: 'MKV' },
    { value: 'wmv', label: 'WMV' },
    { value: 'flv', label: 'FLV' },
    { value: 'webm', label: 'WEBM' },
    { value: 'mp3', label: 'MP3' },
    { value: 'wav', label: 'WAV' },
    { value: 'aac', label: 'AAC' },
    { value: 'srt', label: 'SRT' },
]

const FILE_RESOLUTION_OPTIONS: { value: FileResolution; label: string }[] = [
    { value: '480p', label: '480p and below' },
    { value: '720p', label: '720p' },
    { value: '1080p', label: '1080p' },
    { value: '1440p', label: '1440p' },
    { value: '4k', label: '4K' },
]

const FILE_STATUS_OPTIONS: { value: FileStatus; label: string }[] = [
    { value: 'unprocessed', label: 'Unprocessed' },
    { value: 'queued', label: 'Queued' },
    { value: 'processing', label: 'Processing' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'paused', label: 'Paused' },
]

const FILE_SIZE_OPERATOR_OPTIONS: { value: FileSizeOperator; label: string }[] = [
    { value: 'gte', label: 'Greater than or equal' },
    { value: 'lte', label: 'Less than or equal' },
    { value: 'eq', label: 'Equal' },
]

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'last_7_days', label: 'Last 7 days' },
    { value: 'last_30_days', label: 'Last 30 days' },
    { value: 'last_year', label: 'Last year' },
]

const FileFilterDialog: React.FC<FilterDialogProps> = ({
    isFilterActive,
    handleResetFilters,
    isFilterDialogOpen,
    setIsFilterDialogOpen,
    fileTypeFilter,
    setFileTypeFilter,
    fileFormatFilter,
    setFileFormatFilter,
    dateRangeFilter,
    setDateRangeFilter,
    handleApplyFilters,
    onOpen,
    hasScenes,
    setHasScenes,
    hasSplit,
    setHasSplit,
    hasSubtitle,
    setHasSubtitle,
    hasNoScenes,
    setHasNoScenes,
    hasNoSplit,
    setHasNoSplit,
    hasNoSubtitle,
    setHasNoSubtitle,
    isGroupedView,
    setIsGroupedView,
    directories,
    selectedDirectoryIds,
    setSelectedDirectoryIds,
    directoryExclude,
    setDirectoryExclude,
    statusFilter,
    setStatusFilter,
    queueDisabled,
    setQueueDisabled,
    queueDisabledNo,
    setQueueDisabledNo,
    splitDisabled,
    setSplitDisabled,
    splitDisabledNo,
    setSplitDisabledNo,
    subtitleDisabled,
    setSubtitleDisabled,
    subtitleDisabledNo,
    setSubtitleDisabledNo,
    noNumberSuffix,
    setNoNumberSuffix,
    newVideos,
    setNewVideos,
    contentTag,
    setContentTag,
    resolutionFilter,
    setResolutionFilter,
    fileSizeOperator,
    setFileSizeOperator,
    fileSizeValue,
    setFileSizeValue,
    onLoadPreset,
    onSetDefaultPreset,
}) => {
    const [isDirectoryModalOpen, setIsDirectoryModalOpen] = useState(false)

    const currentFilters: FileFilterState = {
        type: fileTypeFilter,
        format: fileFormatFilter,
        dateRange: dateRangeFilter,
        hasScenes,
        hasSplit,
        hasSubtitle,
        hasNoScenes,
        hasNoSplit,
        hasNoSubtitle,
        statusFilter,
        queueDisabled,
        queueDisabledNo,
        splitDisabled,
        splitDisabledNo,
        subtitleDisabled,
        subtitleDisabledNo,
        noNumberSuffix,
        newVideos,
        contentTag,
        resolutionFilter,
        fileSizeOperator,
        fileSizeValue,
        selectedDirectoryIds,
        directoryExclude,
        isGroupedView,
    }

    const handleOpenChange = (open: boolean) => {
        if (open) onOpen?.()
        setIsFilterDialogOpen(open)
    }

    const handleDirectoryToggle = (id: string) => {
        setSelectedDirectoryIds(
            selectedDirectoryIds.includes(id)
                ? selectedDirectoryIds.filter(selectedId => selectedId !== id)
                : [...selectedDirectoryIds, id]
        )
    }

    const handleDirectoryClear = () => {
        setSelectedDirectoryIds([])
        setDirectoryExclude(false)
    }

    const selectedDirectoryLabel =
        selectedDirectoryIds.length === 0
            ? 'All directories'
            : selectedDirectoryIds.length === 1
                ? `${directoryExclude ? 'Not in ' : ''}${directories.find(d => d.id === selectedDirectoryIds[0])?.name || 'Select directory'}`
                : `${directoryExclude ? 'Excluding' : 'Including'} ${selectedDirectoryIds.length} directories`

    const handleResetClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        handleResetFilters()
    }

    return (
        <Dialog open={isFilterDialogOpen} onOpenChange={handleOpenChange}>
            <div className="relative shrink-0">
                <DialogTrigger asChild>
                    <Button
                        variant={isFilterActive ? "default" : "outline"}
                        className="h-8 gap-1 px-2 text-xs sm:h-10 sm:gap-1.5 sm:px-3 sm:text-sm"
                        aria-label="Filter files"
                    >
                        <Filter className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        <span className="hidden sm:inline">Filter</span>
                    </Button>
                </DialogTrigger>
                {isFilterActive && (
                    <button
                        type="button"
                        aria-label="Clear file filters"
                        className="absolute -right-[7.5px] top-1 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-background bg-primary-foreground text-sm leading-none text-primary shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:-right-1.5 sm:top-0"
                        onClick={handleResetClick}
                    >
                        ×
                    </button>
                )}
            </div>
            <DialogContent className="max-w-md max-h-[95vh] overflow-hidden flex flex-col">
                <DialogHeader className="shrink-0">
                    <DialogTitle>Filter Files</DialogTitle>
                </DialogHeader>
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar pr-1">
                    <div className="grid grid-cols-2 gap-4">
                        <SavedFileFiltersSection
                            currentFilters={currentFilters}
                            onLoadPreset={onLoadPreset}
                            onSetDefaultPreset={onSetDefaultPreset}
                            directories={directories}
                        />
                        <div className="flex flex-col gap-2">
                            <Label className="text-sm font-medium flex items-center gap-2"><FileText className="w-3.5 h-3.5" />File type</Label>
                            <MultiSelect
                                options={FILE_TYPE_OPTIONS}
                                values={fileTypeFilter}
                                onChange={setFileTypeFilter}
                                placeholder="All types"
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className="text-sm font-medium flex items-center gap-2"><FileText className="w-3.5 h-3.5" />File format</Label>
                            <MultiSelect
                                options={FILE_FORMAT_OPTIONS}
                                values={fileFormatFilter}
                                onChange={setFileFormatFilter}
                                placeholder="All formats"
                            />
                        </div>
                        {directories.length > 0 && (
                            <div className="flex flex-col gap-2">
                                <Label className="text-sm font-medium flex items-center gap-2"><FolderOpen className="w-3.5 h-3.5" />Directory</Label>
                                <Dialog open={isDirectoryModalOpen} onOpenChange={setIsDirectoryModalOpen}>
                                    <DialogTrigger asChild>
                                        <Button variant="outline" className="w-full justify-start font-normal h-9 text-sm">
                                            {selectedDirectoryLabel}
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Select Directory</DialogTitle>
                                        </DialogHeader>
                                        <div className="max-h-[60vh] overflow-y-auto scrollbar pr-4">
                                            <div className="flex rounded-md border overflow-hidden text-xs mb-3">
                                                <button
                                                    type="button"
                                                    onClick={() => setDirectoryExclude(false)}
                                                    className={`flex-1 py-1.5 transition-colors ${!directoryExclude ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                                                >
                                                    Include
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setDirectoryExclude(true)}
                                                    className={`flex-1 py-1.5 border-l transition-colors ${directoryExclude ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                                                >
                                                    Exclude
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-3 p-2 rounded cursor-pointer" onClick={handleDirectoryClear}>
                                                <Checkbox
                                                    id="dir-all"
                                                    checked={selectedDirectoryIds.length === 0}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onCheckedChange={handleDirectoryClear}
                                                />
                                                <Label htmlFor="dir-all" className="flex-1 cursor-pointer">All</Label>
                                            </div>
                                            {directories
                                                .filter(d => {
                                                    if (d.parent_id === null) return false
                                                    const parent = directories.find(p => p.id === d.parent_id)
                                                    return parent?.parent_id === null
                                                })
                                                .map(d => (
                                                    <div key={d.id} className="flex items-center gap-3 p-2 rounded cursor-pointer" onClick={() => handleDirectoryToggle(d.id)}>
                                                        <Checkbox
                                                            id={`dir-${d.id}`}
                                                            checked={selectedDirectoryIds.includes(d.id)}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onCheckedChange={() => handleDirectoryToggle(d.id)}
                                                        />
                                                        <div className="flex-1">
                                                            <Label htmlFor={`dir-${d.id}`} className="cursor-pointer block text-sm">{d.name}</Label>
                                                        </div>
                                                    </div>
                                                ))}
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        )}
                        <div className="flex flex-col gap-2">
                            <Label className="text-sm font-medium flex items-center gap-2"><Calendar className="w-3.5 h-3.5" />Date range</Label>
                            <MultiSelect
                                options={DATE_RANGE_OPTIONS}
                                values={dateRangeFilter}
                                onChange={setDateRangeFilter}
                                placeholder="All time"
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className="text-sm font-medium flex items-center gap-2"><Activity className="w-3.5 h-3.5" />Status</Label>
                            <MultiSelect
                                options={FILE_STATUS_OPTIONS}
                                values={statusFilter}
                                onChange={setStatusFilter}
                                placeholder="All statuses"
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label className="text-sm font-medium flex items-center gap-2"><Activity className="w-3.5 h-3.5" />Resolution</Label>
                            <MultiSelect
                                options={FILE_RESOLUTION_OPTIONS}
                                values={resolutionFilter}
                                onChange={setResolutionFilter}
                                placeholder="All resolutions"
                            />
                        </div>
                        <div className="col-span-2 flex flex-col gap-2">
                            <Label className="text-sm font-medium flex items-center gap-2"><HardDrive className="w-3.5 h-3.5" />File size</Label>
                            <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2 pl-0.5">
                                <Select value={fileSizeOperator} onValueChange={(value) => setFileSizeOperator(value as FileSizeOperator)}>
                                    <SelectTrigger className="h-9 text-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {FILE_SIZE_OPERATOR_OPTIONS.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="relative">
                                    <Input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={fileSizeValue ?? ''}
                                        onChange={(event) => {
                                            const value = event.target.value
                                            const numericValue = Number(value)
                                            setFileSizeValue(value === '' || !Number.isFinite(numericValue) ? null : Math.max(0, numericValue))
                                        }}
                                        placeholder="0"
                                        className="h-9 pr-16 text-sm"
                                    />
                                    {fileSizeValue !== null && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="absolute right-7 top-1/2 h-6 w-6 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground"
                                            onClick={() => setFileSizeValue(null)}
                                            aria-label="Clear file size"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                    )}
                                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">MB</span>
                                </div>
                            </div>
                        </div>
                        <div className="col-span-2 flex flex-col gap-3 pt-4 border-t">
                            <Label className="text-sm font-medium flex items-center gap-2"><Layers className="w-3.5 h-3.5" />Processing</Label>
                            <div className="flex flex-col gap-2">
                                {([
                                    { label: 'Scenes', pos: hasScenes, setPos: setHasScenes, neg: hasNoScenes, setNeg: setHasNoScenes, posLabel: 'Has', negLabel: 'Has no' },
                                    { label: 'Split', pos: hasSplit, setPos: setHasSplit, neg: hasNoSplit, setNeg: setHasNoSplit, posLabel: 'Has', negLabel: 'Has no' },
                                    { label: 'Subtitle', pos: hasSubtitle, setPos: setHasSubtitle, neg: hasNoSubtitle, setNeg: setHasNoSubtitle, posLabel: 'Has', negLabel: 'Has no' },
                                    { label: 'Queue', pos: queueDisabledNo, setPos: setQueueDisabledNo, neg: queueDisabled, setNeg: setQueueDisabled, posLabel: 'Enabled', negLabel: 'Disabled' },
                                    { label: 'Split', pos: splitDisabledNo, setPos: setSplitDisabledNo, neg: splitDisabled, setNeg: setSplitDisabled, posLabel: 'Enabled', negLabel: 'Disabled' },
                                    { label: 'Subtitle', pos: subtitleDisabledNo, setPos: setSubtitleDisabledNo, neg: subtitleDisabled, setNeg: setSubtitleDisabled, posLabel: 'Enabled', negLabel: 'Disabled' },
                                ]).map(({ label, pos, setPos, neg, setNeg, posLabel, negLabel }) => (
                                    <div key={label} className="flex items-center gap-3">
                                        <span className="text-sm text-muted-foreground w-14 shrink-0">{label}</span>
                                        <div className="flex rounded-md border overflow-hidden text-xs flex-1">
                                            <button
                                                type="button"
                                                onClick={() => { setPos(!pos); if (!pos) setNeg(false); }}
                                                className={`flex-1 py-1.5 transition-colors ${pos ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                                            >
                                                {posLabel}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { setPos(false); setNeg(false); }}
                                                className={`flex-1 py-1.5 border-x transition-colors ${!pos && !neg ? 'bg-muted text-foreground font-medium' : 'hover:bg-muted text-muted-foreground'}`}
                                            >
                                                Any
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { setNeg(!neg); if (!neg) setPos(false); }}
                                                className={`flex-1 py-1.5 transition-colors ${neg ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                                            >
                                                {negLabel}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-muted-foreground w-14 shrink-0">Original</span>
                                    <div className="flex rounded-md border overflow-hidden text-xs flex-1">
                                        <button
                                            type="button"
                                            onClick={() => setNoNumberSuffix(true)}
                                            className={`flex-1 py-1.5 transition-colors ${noNumberSuffix ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                                        >
                                            Yes
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setNoNumberSuffix(false)}
                                            className={`flex-1 py-1.5 border-l transition-colors ${!noNumberSuffix ? 'bg-muted text-foreground font-medium' : 'hover:bg-muted text-muted-foreground'}`}
                                        >
                                            Any
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-muted-foreground w-14 shrink-0">New</span>
                                    <div className="flex rounded-md border overflow-hidden text-xs flex-1">
                                        <button
                                            type="button"
                                            onClick={() => setNewVideos(true)}
                                            className={`flex-1 py-1.5 transition-colors ${newVideos ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                                        >
                                            Yes
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setNewVideos(false)}
                                            className={`flex-1 py-1.5 border-l transition-colors ${!newVideos ? 'bg-muted text-foreground font-medium' : 'hover:bg-muted text-muted-foreground'}`}
                                        >
                                            Any
                                        </button>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-muted-foreground w-14 shrink-0">Kind</span>
                                    <div className="flex rounded-md border overflow-hidden text-xs flex-1">
                                        {([
                                            ['censored', 'Censored'],
                                            ['uncensored', 'Uncensored'],
                                            ['subtitled', 'Subtitled'],
                                        ] as const).map(([value, label]) => (
                                            <button
                                                key={value}
                                                type="button"
                                                onClick={() => setContentTag(contentTag === value ? null : value)}
                                                className={`flex-1 py-1.5 transition-colors ${contentTag === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => setContentTag(null)}
                                            className={`flex-1 py-1.5 border-l transition-colors ${contentTag === null ? 'bg-muted text-foreground font-medium' : 'hover:bg-muted text-muted-foreground'}`}
                                        >
                                            Any
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="col-span-2 flex flex-col gap-2 pt-4 border-t">
                            <Label className="text-sm font-medium flex items-center gap-2"><Tag className="w-3.5 h-3.5" />Group Similar</Label>
                            <div className="flex items-center gap-2 h-9">
                                <Switch
                                    checked={isGroupedView}
                                    onCheckedChange={setIsGroupedView}
                                    id="group-toggle"
                                />
                                <label htmlFor="group-toggle" className="text-sm text-muted-foreground cursor-pointer">
                                    {isGroupedView ? 'On' : 'Off'}
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex justify-between items-center pt-4 shrink-0 border-t">
                    <Button variant="outline" onClick={handleResetClick} size="sm">
                        Reset
                    </Button>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => handleOpenChange(false)} size="sm">
                            Cancel
                        </Button>
                        <Button onClick={handleApplyFilters} size="sm" className="bg-primary hover:bg-primary/90">
                            Apply Filters
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default FileFilterDialog
