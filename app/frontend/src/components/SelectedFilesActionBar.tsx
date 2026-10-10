import React from 'react';
import { ExternalLink, Plus, Trash2, Scissors, Ban, CircleCheck, X, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

import { File } from '@/types/types';
import { fileApi } from '@/api/files';
import { cn } from '@/lib/utils';
import { useSettings } from '@/hooks/useSettings';
import { buildExternalVideoTargetUrl, getExternalVideoCodeFromFileName, isValidExternalVideoTarget } from '@/lib/external-video-targets';

import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from './ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

type FileLayoutMode = 'grid' | 'tree';
type ReleaseTag = 'RM' | 'SUB';
type ReleaseTagAction = 'add' | 'remove';

export const RENAMEABLE_RELEASE_TAG_EXTENSIONS = new Set(['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.srt', '.vtt']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv']);
const RELEASE_TAGS: ReleaseTag[] = ['RM', 'SUB'];

const waitForRandomExternalLinkDelay = () => new Promise((resolve) => {
    window.setTimeout(resolve, Math.random() * 50);
});

export const isReleaseTagRenameableFileName = (name: string) => {
    const extensionIndex = name.lastIndexOf('.');
    return extensionIndex >= 0 && RENAMEABLE_RELEASE_TAG_EXTENSIONS.has(name.slice(extensionIndex).toLowerCase());
};

const isVideoFileName = (name: string) => {
    const extensionIndex = name.lastIndexOf('.');
    return extensionIndex >= 0 && VIDEO_EXTENSIONS.has(name.slice(extensionIndex).toLowerCase());
};

const getReleaseTagParts = (name: string) => {
    const extensionIndex = name.lastIndexOf('.');
    const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
    const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
    const splitMatch = stem.match(/^(.+-\d{2,6}(?:-(?:RM|SUB))*)-(\d{3})$/i);
    const splitSuffix = splitMatch ? `-${splitMatch[2]}` : '';
    const baseStem = splitMatch ? splitMatch[1] : stem;
    const tags: ReleaseTag[] = [];
    const normalizedBaseStem = baseStem.replace(/(?:-(RM|SUB))+$/i, (match) => {
        const matchedTags = match
            .slice(1)
            .split('-')
            .map((value) => value.toUpperCase())
            .filter((value): value is ReleaseTag => value === 'RM' || value === 'SUB');

        tags.push(...matchedTags);
        return '';
    });

    return { normalizedBaseStem, tags, splitSuffix, extension };
};

export const formatReleaseTagName = (name: string, tag: ReleaseTag, action: ReleaseTagAction) => {
    const { normalizedBaseStem, tags, splitSuffix, extension } = getReleaseTagParts(name);
    const selectedTags = new Set(tags);

    if (action === 'add') {
        selectedTags.add(tag);
    } else {
        selectedTags.delete(tag);
    }

    const tagSuffix = RELEASE_TAGS
        .filter((releaseTag) => selectedTags.has(releaseTag))
        .map((releaseTag) => `-${releaseTag}`)
        .join('');

    return `${normalizedBaseStem}${tagSuffix}${splitSuffix}${extension}`;
};

interface SelectedFilesActionBarProps {
    selectedFiles: File[];
    layoutMode: FileLayoutMode;
    singleSelectedFile: File | null;
    setIsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
    openFileMoveDialog: (file: File) => void;
    splitDisableableSelectedFiles: File[];
    subtitleDisableableSelectedFiles: File[];
    splitEnableableSelectedFiles: File[];
    subtitleEnableableSelectedFiles: File[];
    bulkDisableLoading: boolean;
    bulkEnableLoading: boolean;
    handleDisableFromTaskType: (taskType: 'split' | 'subtitle') => Promise<void>;
    handleEnableForTaskType: (taskType: 'split' | 'subtitle') => Promise<void>;
    setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
    showSelectAll: boolean;
    filesCount: number;
    onToggleSelectAll: () => void;
}

export function SelectedFilesActionBar({
    selectedFiles,
    layoutMode,
    singleSelectedFile,
    setIsDialogOpen,
    openFileMoveDialog,
    splitDisableableSelectedFiles,
    subtitleDisableableSelectedFiles,
    splitEnableableSelectedFiles,
    subtitleEnableableSelectedFiles,
    bulkDisableLoading,
    bulkEnableLoading,
    handleDisableFromTaskType,
    handleEnableForTaskType,
    setSelectedFiles,
    showSelectAll,
    filesCount,
    onToggleSelectAll,
}: SelectedFilesActionBarProps) {
    const { settings } = useSettings();
    const queryClient = useQueryClient();
    const [bulkReleaseTagLoading, setBulkReleaseTagLoading] = React.useState<`${ReleaseTagAction}-${ReleaseTag}` | null>(null);
    const [deleteFromDisk, setDeleteFromDisk] = React.useState(true);
    const [deleteFromDatabase, setDeleteFromDatabase] = React.useState(true);
    const [selectedExternalTargetKeys, setSelectedExternalTargetKeys] = React.useState<Set<string>>(() => new Set());
    const selectedReleaseTagRenameableFiles = React.useMemo(
        () => selectedFiles.filter((file) => isReleaseTagRenameableFileName(file.name)),
        [selectedFiles],
    );
    const selectedVideoFiles = React.useMemo(
        () => selectedFiles.filter((file) => isVideoFileName(file.name)),
        [selectedFiles],
    );
    const externalVideoTargets = React.useMemo(
        () => settings.external_video_targets.filter(isValidExternalVideoTarget),
        [settings.external_video_targets],
    );
    const selectedExternalTargets = React.useMemo(
        () => externalVideoTargets.filter((target) => selectedExternalTargetKeys.has(target.label + target.url_template)),
        [externalVideoTargets, selectedExternalTargetKeys],
    );
    const selectedVideoCodes = React.useMemo(
        () => Array.from(new Set(selectedVideoFiles.map((file) => getExternalVideoCodeFromFileName(file.name)))),
        [selectedVideoFiles],
    );

    const openVideoCodesInSelectedExternalTargets = async () => {
        if (selectedVideoCodes.length === 0 || selectedExternalTargets.length === 0) {
            return;
        }

        const links = selectedVideoCodes.flatMap((videoCode) => (
            selectedExternalTargets.map((target) => buildExternalVideoTargetUrl(target, videoCode))
        ));
        const openedTabs = links.map(() => {
            const tab = window.open('about:blank', '_blank');
            if (!tab) {
                return null;
            }

            try {
                tab.opener = null;
            } catch {
                // Some browsers block reassignment; opening still works without it.
            }

            return tab;
        });

        for (let linkIndex = 0; linkIndex < links.length; linkIndex += 1) {
            const tab = openedTabs[linkIndex];
            if (tab) {
                tab.location.href = links[linkIndex];
            }

            if (linkIndex < links.length - 1) {
                await waitForRandomExternalLinkDelay();
            }
        }
    };

    const handleExternalTargetSelect = (event: Event, targetKey: string) => {
        event.preventDefault();
        setSelectedExternalTargetKeys((prev) => {
            const next = new Set(prev);
            if (next.has(targetKey)) {
                next.delete(targetKey);
            } else {
                next.add(targetKey);
            }
            return next;
        });
    };

    const handleReleaseTagChange = async (tag: ReleaseTag, action: ReleaseTagAction) => {
        const loadingKey = `${action}-${tag}` as const;
        const renameTargets = selectedReleaseTagRenameableFiles
            .map((file) => ({ file, newName: formatReleaseTagName(file.name, tag, action) }))
            .filter(({ file, newName }) => newName !== file.name);

        if (bulkReleaseTagLoading || renameTargets.length === 0) {
            return;
        }

        setBulkReleaseTagLoading(loadingKey);
        try {
            const renamedFiles = await Promise.all(
                renameTargets.map(({ file, newName }) => fileApi.renameFile(file.id, newName)),
            );
            const renamedById = new Map(renamedFiles.map((file) => [file.id, file]));

            setSelectedFiles((prev) =>
                prev.map((file) => renamedById.get(file.id) ?? file),
            );
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['files-grouped'] });
            toast.success(`${action === 'add' ? 'Added' : 'Removed'} -${tag} ${action === 'add' ? 'to' : 'from'} ${renamedFiles.length} file${renamedFiles.length === 1 ? '' : 's'}`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : `Failed to ${action} -${tag}`);
        } finally {
            setBulkReleaseTagLoading(null);
        }
    };

    if (selectedFiles.length === 0) {
        return null;
    }

    return (
        <TooltipProvider delayDuration={150}>
            <div className="flex max-h-40 flex-wrap items-center justify-start gap-2 overflow-y-auto rounded-md border border-border/60 bg-muted/45 px-2 py-2 sm:max-h-none sm:justify-end sm:overflow-visible">
                <div className="flex w-full shrink-0 items-center gap-2 sm:mr-auto sm:w-auto">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                aria-label="Clear selection"
                                onClick={() => setSelectedFiles([])}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>Clear selection</TooltipContent>
                    </Tooltip>
                    <span className="text-sm text-muted-foreground">
                        {selectedFiles.length} selected
                    </span>
                    {showSelectAll && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="ml-2 h-8 text-sm"
                            onClick={onToggleSelectAll}
                            disabled={filesCount === 0}
                        >
                            {selectedFiles.length === filesCount && filesCount > 0 ? 'Deselect All' : 'Select All'}
                        </Button>
                    )}
                </div>
                <Button
                    variant="default"
                    size="sm"
                    className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={() => setIsDialogOpen(true)}
                >
                    <Plus className="h-3.5 w-3.5" />
                    New Task
                </Button>
                {layoutMode === 'tree' && (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!singleSelectedFile}
                        onClick={() => singleSelectedFile && openFileMoveDialog(singleSelectedFile)}
                    >
                        Move
                    </Button>
                )}
                {selectedVideoFiles.length > 0 && externalVideoTargets.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Open All In...
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-52">
                            <DropdownMenuLabel>Select sites</DropdownMenuLabel>
                            {externalVideoTargets.map((target) => {
                                const targetKey = target.label + target.url_template;
                                return (
                                    <DropdownMenuCheckboxItem
                                        key={targetKey}
                                        checked={selectedExternalTargetKeys.has(targetKey)}
                                        onSelect={(event) => handleExternalTargetSelect(event, targetKey)}
                                    >
                                        {target.label}
                                    </DropdownMenuCheckboxItem>
                                );
                            })}
                            <DropdownMenuSeparator />
                            <div className="flex gap-1 px-1 pb-1">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="h-8 flex-1 text-xs"
                                    onClick={() => setSelectedExternalTargetKeys(new Set(externalVideoTargets.map((target) => target.label + target.url_template)))}
                                >
                                    Select all
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    className="h-8 flex-1 text-xs"
                                    onClick={() => setSelectedExternalTargetKeys(new Set())}
                                >
                                    Clear
                                </Button>
                            </div>
                            <div className="px-1 pb-1">
                                <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 w-full text-xs"
                                    disabled={selectedExternalTargets.length === 0}
                                    onClick={() => void openVideoCodesInSelectedExternalTargets()}
                                >
                                    Open in {selectedExternalTargets.length} selected {selectedExternalTargets.length === 1 ? 'site' : 'sites'}
                                </Button>
                            </div>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
                {selectedReleaseTagRenameableFiles.length > 0 && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                disabled={bulkReleaseTagLoading !== null}
                            >
                                <Tag className={cn('h-3.5 w-3.5', bulkReleaseTagLoading !== null && 'animate-pulse')} />
                                Release tag
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() => void handleReleaseTagChange('RM', 'add')}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                {bulkReleaseTagLoading === 'add-RM' ? 'Adding...' : 'Add -RM'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() => void handleReleaseTagChange('SUB', 'add')}
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                {bulkReleaseTagLoading === 'add-SUB' ? 'Adding...' : 'Add -SUB'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() => void handleReleaseTagChange('RM', 'remove')}
                            >
                                <X className="mr-2 h-4 w-4" />
                                {bulkReleaseTagLoading === 'remove-RM' ? 'Removing...' : 'Remove -RM'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer"
                                onClick={() => void handleReleaseTagChange('SUB', 'remove')}
                            >
                                <X className="mr-2 h-4 w-4" />
                                {bulkReleaseTagLoading === 'remove-SUB' ? 'Removing...' : 'Remove -SUB'}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
                {(splitDisableableSelectedFiles.length > 0 ||
                    subtitleDisableableSelectedFiles.length > 0 ||
                    splitEnableableSelectedFiles.length > 0 ||
                    subtitleEnableableSelectedFiles.length > 0) && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5"
                                    disabled={bulkDisableLoading || bulkEnableLoading}
                                >
                                    <Ban className={cn('h-3.5 w-3.5', (bulkDisableLoading || bulkEnableLoading) && 'animate-pulse')} />
                                    Task status
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {splitDisableableSelectedFiles.length > 0 && (
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        onClick={() => void handleDisableFromTaskType('split')}
                                    >
                                        <Scissors className="mr-2 h-4 w-4" />
                                        {bulkDisableLoading ? 'Disabling...' : 'Disable From Split'}
                                    </DropdownMenuItem>
                                )}
                                {subtitleDisableableSelectedFiles.length > 0 && (
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        onClick={() => void handleDisableFromTaskType('subtitle')}
                                    >
                                        <Ban className="mr-2 h-4 w-4" />
                                        {bulkDisableLoading ? 'Disabling...' : 'Disable From Subtitle'}
                                    </DropdownMenuItem>
                                )}
                                {splitEnableableSelectedFiles.length > 0 && (
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        onClick={() => void handleEnableForTaskType('split')}
                                    >
                                        <CircleCheck className="mr-2 h-4 w-4" />
                                        {bulkEnableLoading ? 'Enabling...' : 'Enable For Split'}
                                    </DropdownMenuItem>
                                )}
                                {subtitleEnableableSelectedFiles.length > 0 && (
                                    <DropdownMenuItem
                                        className="cursor-pointer"
                                        onClick={() => void handleEnableForTaskType('subtitle')}
                                    >
                                        <CircleCheck className="mr-2 h-4 w-4" />
                                        {bulkEnableLoading ? 'Enabling...' : 'Enable For Subtitle'}
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" className="gap-1.5">
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''}?</AlertDialogTitle>
                            <AlertDialogDescription>
                                Choose where to delete {selectedFiles.length > 1 ? `these ${selectedFiles.length} files` : `"${selectedFiles[0]?.name}"`}. This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <div className="space-y-3 py-2">
                            <label className="flex items-start gap-3 text-sm">
                                <Checkbox
                                    checked={deleteFromDisk}
                                    onCheckedChange={(checked) => setDeleteFromDisk(checked === true)}
                                />
                                <span className="leading-5">Delete files on disk</span>
                            </label>
                            <label className="flex items-start gap-3 text-sm">
                                <Checkbox
                                    checked={deleteFromDatabase}
                                    onCheckedChange={(checked) => setDeleteFromDatabase(checked === true)}
                                />
                                <span className="leading-5">Delete records in database</span>
                            </label>
                        </div>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                disabled={!deleteFromDisk && !deleteFromDatabase}
                                onClick={async () => {
                                    try {
                                        await Promise.all(selectedFiles.map((file) => fileApi.deleteFile(file.id, { deleteFromDisk, deleteFromDatabase })));
                                        toast.success(`Deleted ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}`);
                                        if (deleteFromDatabase) {
                                            setSelectedFiles([]);
                                        }
                                        queryClient.invalidateQueries({ queryKey: ['files'] });
                                        queryClient.invalidateQueries({ queryKey: ['files-grouped'] });
                                    } catch {
                                        toast.error('Failed to delete selected files');
                                    }
                                }}
                            >
                                Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </TooltipProvider>
    );
}
