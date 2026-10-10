import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react'
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from './ui/dialog';
import { FolderOpen, FileText, SearchX, Captions, ChevronRight } from 'lucide-react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from './ui/skeleton';
import { FileCard } from './FileCard';
import { SubtitleEditorModal } from './SubtitleEditorModal';
import { toast } from 'sonner';
import { File, Directory, DirectoryRecord, FilesResponse, GroupedFilesResponse, Task, TaskStatus } from '@/types/types';
import { fileApi } from '@/api/files';
import { directoryApi } from '@/api/directories';
import { taskApi } from '@/api/tasks';
import { sceneApi } from '@/api/scenes';
import FileFilterDialog from './FileFilterDialog';
import { DateRange, EMPTY_FILE_FILTER_STATE, FileFilterState, FileFormat, FileResolution, FileSizeOperator, FileStatus, FileType, isFileFilterActive } from '@/lib/file-filters';
import FileSorting, { type FileSortOption } from './FileSorting';
import FileSearch from './FileSearch';
import { FileGroupCard } from './FileGroupCard';
import { FileTasksDialog } from './FileTasksDialog';
import { SceneViewerModal } from './SceneViewerModal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from './ui/context-menu';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { cn } from '@/lib/utils'
import { useFileSelection } from '@/hooks/useFileSelection';
import { useSavedFileFilters } from '@/hooks/useSavedFileFilters';
import { FilterBadges } from './FilterBadges';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { FileBrowserToolbar } from './FileBrowserToolbar';
import { SelectedTreeDirectoriesBar } from './SelectedTreeDirectoriesBar';
import { SelectedFilesActionBar } from './SelectedFilesActionBar';
import { FileBrowserPagination } from './FileBrowserPagination';
import { useCancelTask, useDeleteTask } from '@/hooks/useTasks';

const FileRowSkeleton: React.FC = () => (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
    </div>
);

const FileGroupSkeleton: React.FC = () => (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
        <Skeleton className="h-4 w-2/5 mb-1" />
        <FileRowSkeleton />
        <FileRowSkeleton />
        <FileRowSkeleton />
    </div>
);

type FileLayoutMode = 'grid' | 'tree';
type TerminalTaskStatus = Extract<TaskStatus, 'completed' | 'failed' | 'cancelled'>;

const TERMINAL_TASK_STATUSES: readonly TerminalTaskStatus[] = ['completed', 'failed', 'cancelled'];
const FILE_BROWSER_QUERY_STALE_TIME_MS = 30_000;
const FILE_BROWSER_QUERY_CACHE_TIME_MS = 30 * 60 * 1000;
const FILE_SORT_OPTIONS: FileSortOption[] = ['size', 'name', 'folder_name', 'created_at', 'modified_at', 'duration', 'file_count'];
const FILE_SORT_DIRECTIONS: Array<'asc' | 'desc'> = ['asc', 'desc'];
const FILE_TYPES: FileType[] = ['video', 'subtitle', 'other'];
const FILE_FORMATS: FileFormat[] = ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv', 'webm', 'mp3', 'wav', 'aac', 'srt'];
const FILE_DATE_RANGES: DateRange[] = ['today', 'last_7_days', 'last_30_days', 'last_year'];
const FILE_STATUSES: FileStatus[] = ['queued', 'processing', 'completed', 'failed', 'cancelled', 'paused', 'unprocessed'];
const FILE_RESOLUTIONS: FileResolution[] = ['480p', '720p', '1080p', '1440p', '4k'];
const FILE_SIZE_OPERATORS: FileSizeOperator[] = ['gte', 'lte', 'eq'];

const getQueryParam = (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get(key);
};

const getFileQueryParam = (key: string): string | null => getQueryParam(key) ?? getQueryParam(`files.${key}`);

const getQueryList = (key: string): string[] => {
    const value = getFileQueryParam(key);
    return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
};

const getQueryBoolean = (key: string): boolean => getFileQueryParam(key) === '1';

const getQueryNumber = (key: string, fallback: number): number => {
    const value = getFileQueryParam(key);
    const parsed = value ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getQueryFileSizeValue = (): number | null => {
    const value = getFileQueryParam('size');
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const getInitialFileSortOption = (): FileSortOption => {
    const value = getFileQueryParam('sort');
    return FILE_SORT_OPTIONS.includes(value as FileSortOption) ? value as FileSortOption : 'name';
};

const getInitialFileSortDirection = (): 'asc' | 'desc' => {
    const value = getFileQueryParam('dir');
    return FILE_SORT_DIRECTIONS.includes(value as 'asc' | 'desc') ? value as 'asc' | 'desc' : 'asc';
};

const getInitialFileFilters = (): FileFilterState => {
    const sizeOperator = getFileQueryParam('sizeOp');
    return {
        ...EMPTY_FILE_FILTER_STATE,
        type: getQueryList('type').filter((value): value is FileType => FILE_TYPES.includes(value as FileType)),
        format: getQueryList('format').filter((value): value is FileFormat => FILE_FORMATS.includes(value as FileFormat)),
        dateRange: getQueryList('date').filter((value): value is DateRange => FILE_DATE_RANGES.includes(value as DateRange)),
        hasScenes: getQueryBoolean('hasScenes'),
        hasSplit: getQueryBoolean('hasSplit'),
        hasSubtitle: getQueryBoolean('hasSubtitle'),
        hasNoScenes: getQueryBoolean('noScenes'),
        hasNoSplit: getQueryBoolean('noSplit'),
        hasNoSubtitle: getQueryBoolean('noSubtitle'),
        statusFilter: getQueryList('status').filter((value): value is FileStatus => FILE_STATUSES.includes(value as FileStatus)),
        queueDisabled: getQueryBoolean('queueDisabled'),
        queueDisabledNo: getQueryBoolean('queueEnabled'),
        splitDisabled: getQueryBoolean('splitDisabled'),
        splitDisabledNo: getQueryBoolean('splitEnabled'),
        subtitleDisabled: getQueryBoolean('subtitleDisabled'),
        subtitleDisabledNo: getQueryBoolean('subtitleEnabled'),
        noNumberSuffix: getQueryBoolean('noNumberSuffix'),
        newVideos: getQueryBoolean('newVideos'),
        contentTag: (() => {
            const value = getFileQueryParam('content');
            return value === 'censored' || value === 'uncensored' || value === 'subtitled' ? value : null;
        })(),
        resolutionFilter: getQueryList('resolution').filter((value): value is FileResolution => FILE_RESOLUTIONS.includes(value as FileResolution)),
        fileSizeOperator: FILE_SIZE_OPERATORS.includes(sizeOperator as FileSizeOperator) ? sizeOperator as FileSizeOperator : 'gte',
        fileSizeValue: getQueryFileSizeValue(),
        selectedDirectoryIds: getQueryList('dirs'),
        directoryExclude: getQueryBoolean('dirExclude'),
        isGroupedView: getQueryBoolean('grouped'),
    };
};

const FILE_QUERY_PARAMS = [
    'q', 'page', 'pageSize', 'sort', 'dir', 'grouped', 'type', 'format', 'date',
    'hasScenes', 'hasSplit', 'hasSubtitle', 'noScenes', 'noSplit', 'noSubtitle',
    'status', 'queueDisabled', 'queueEnabled', 'splitDisabled', 'splitEnabled',
    'subtitleDisabled', 'subtitleEnabled', 'noNumberSuffix', 'newVideos', 'content',
    'resolution', 'sizeOp', 'size', 'dirs', 'dirExclude',
];

const setListParam = (params: URLSearchParams, key: string, values: string[]) => {
    if (values.length) {
        params.set(key, values.join(','));
    } else {
        params.delete(key);
    }
};

const setStringParam = (params: URLSearchParams, key: string, value: string, fallback = '') => {
    if (value !== fallback) {
        params.set(key, value);
    } else {
        params.delete(key);
    }
};

const setNumberParam = (params: URLSearchParams, key: string, value: number, fallback: number) => {
    if (value !== fallback) {
        params.set(key, String(value));
    } else {
        params.delete(key);
    }
};

const setBooleanParam = (params: URLSearchParams, key: string, value: boolean) => {
    if (value) {
        params.set(key, '1');
    } else {
        params.delete(key);
    }
};

const fileSizeMbToBytes = (value: number | null | undefined): number | undefined => {
    if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
    return Math.round(value * 1024 * 1024);
};

const normalizeFiltersForApply = (filters: FileFilterState): FileFilterState => {
    return filters;
};

interface FileBrowserProps {
    layoutMode: FileLayoutMode;
    fileSearchQuery: string;
    searchFocused: boolean;
    selectedFiles: File[];
    setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>;
    setLayoutMode: React.Dispatch<React.SetStateAction<FileLayoutMode>>;
    setFileSearchQuery: React.Dispatch<React.SetStateAction<string>>;
    setSelectedFileForInfo: React.Dispatch<React.SetStateAction<File | Directory | null>>;
    setIsFileInfoModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setIsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setSearchFocused: React.Dispatch<React.SetStateAction<boolean>>;
    setSelectedGroupFiles: React.Dispatch<React.SetStateAction<File[] | null>>;
    setIsGroupModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    highlightFileId?: string | null;
    isActive: boolean;
}

const normalizePath = (value: string) => value.replace(/\//g, '\\').replace(/\\+$/, '');
const getDirectoryPathFromFilePath = (filePath: string) => {
    const normalized = normalizePath(filePath);
    const lastSeparator = normalized.lastIndexOf('\\');
    return lastSeparator >= 0 ? normalized.slice(0, lastSeparator) : normalized;
};

const replaceFileInFilesResponse = (
    oldData: FilesResponse | undefined,
    updatedFile: File,
    previousFileId = updatedFile.id,
) => {
    if (!oldData?.files) {
        return oldData;
    }

    return {
        ...oldData,
        files: oldData.files.map((file) => file.id === previousFileId ? updatedFile : file),
    };
};

const replaceFileInGroupedResponse = (
    oldData: GroupedFilesResponse | undefined,
    updatedFile: File,
    previousFileId = updatedFile.id,
) => {
    if (!oldData?.groups) {
        return oldData;
    }

    const groups = Object.fromEntries(
        Object.entries(oldData.groups).map(([groupId, files]) => [
            groupId,
            files.map((file) => file.id === previousFileId ? updatedFile : file),
        ]),
    );

    return { ...oldData, groups };
};

const replaceFileInAnyFilesResponse = (
    oldData: FilesResponse | GroupedFilesResponse | undefined,
    updatedFile: File,
    previousFileId = updatedFile.id,
) => {
    if (!oldData) {
        return oldData;
    }

    if ('files' in oldData) {
        return replaceFileInFilesResponse(oldData, updatedFile, previousFileId);
    }

    return replaceFileInGroupedResponse(oldData, updatedFile, previousFileId);
};


const FileBrowserTab: React.FC<FileBrowserProps> = ({
    layoutMode,
    setLayoutMode,
    fileSearchQuery,
    setFileSearchQuery,
    searchFocused,
    selectedFiles,
    setSelectedFiles,
    setSelectedFileForInfo,
    setIsFileInfoModalOpen,
    setIsDialogOpen,
    setSearchFocused,
    setSelectedGroupFiles,
    setIsGroupModalOpen,
    highlightFileId,
    isActive,
}) => {
    const queryClient = useQueryClient();
    const cancelTaskMutation = useCancelTask();
    const deleteTaskMutation = useDeleteTask();
    const fileRefsMap = useRef<Record<string, HTMLDivElement | null>>({});
    const treeClickTimeoutRef = useRef<number | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
    const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
    const initialFileFilters = useMemo(() => getInitialFileFilters(), []);
    const [sortOption, setSortOption] = useState<FileSortOption>(getInitialFileSortOption);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(getInitialFileSortDirection);
    const [treeSortOption, setTreeSortOption] = useState<FileSortOption>(getInitialFileSortOption);
    const [isFilterActive, setIsFilterActive] = useState(() => isFileFilterActive(initialFileFilters) || initialFileFilters.isGroupedView);
    const [isGroupedView, setIsGroupedView] = useState(initialFileFilters.isGroupedView);
    const [draftIsGroupedView, setDraftIsGroupedView] = useState(initialFileFilters.isGroupedView);
    const [subtitleToEdit, setSubtitleToEdit] = useState<File | null>(null);
    const [fileTasksTarget, setFileTasksTarget] = useState<File | null>(null);
    const [isSubtitleEditorOpen, setIsSubtitleEditorOpen] = useState(false);
    const [sceneViewerFile, setSceneViewerFile] = useState<File | null>(null);
    const defaultItemsPerPage = typeof window !== 'undefined' && window.innerWidth >= 1921 ? 50 : 25;
    const [currentPage, setCurrentPage] = useState(() => getQueryNumber('page', 1));
    const [itemsPerPage, setItemsPerPage] = useState(() => getQueryNumber('pageSize', defaultItemsPerPage));
    const [selectedDirectoryIds, setSelectedDirectoryIds] = useState<string[]>(initialFileFilters.selectedDirectoryIds);
    const [draftSelectedDirectoryIds, setDraftSelectedDirectoryIds] = useState<string[]>(initialFileFilters.selectedDirectoryIds);
    const [selectedTreeDirectoryIds, setSelectedTreeDirectoryIds] = useState<string[]>([]);
    const [treeDirectoryId, setTreeDirectoryId] = useState<string | null>(null);
    const [directoryDeleteTargetIds, setDirectoryDeleteTargetIds] = useState<string[]>([]);
    const [deleteDirectoriesFromDisk, setDeleteDirectoriesFromDisk] = useState(true);
    const [deleteDirectoriesFromDatabase, setDeleteDirectoriesFromDatabase] = useState(true);
    const [directoryRenameTargetId, setDirectoryRenameTargetId] = useState<string | null>(null);
    const [directoryRenameValue, setDirectoryRenameValue] = useState('');
    const [directoryMoveTargetId, setDirectoryMoveTargetId] = useState<string | null>(null);
    const [directoryMoveDestinationId, setDirectoryMoveDestinationId] = useState('');
    const [fileMoveTargetId, setFileMoveTargetId] = useState<string | null>(null);
    const [fileMoveDestinationId, setFileMoveDestinationId] = useState('');
    const [draftFilters, setDraftFilters] = useState<FileFilterState>(initialFileFilters);
    const [bulkDisableLoading, setBulkDisableLoading] = useState(false);
    const [bulkEnableLoading, setBulkEnableLoading] = useState(false);
    const { presets, updatePreset } = useSavedFileFilters();

    const [appliedFilters, setAppliedFilters] = useState<FileFilterState>(initialFileFilters);

    useEffect(() => {
        if (!isActive) return;
        const url = new URL(window.location.href);
        const params = url.searchParams;
        FILE_QUERY_PARAMS.forEach((key) => params.delete(`files.${key}`));
        setStringParam(params, 'q', fileSearchQuery);
        setNumberParam(params, 'page', currentPage, 1);
        setNumberParam(params, 'pageSize', itemsPerPage, defaultItemsPerPage);
        setStringParam(params, 'sort', sortOption, 'name');
        setStringParam(params, 'dir', sortDirection, 'asc');
        setBooleanParam(params, 'grouped', isGroupedView);
        setListParam(params, 'type', appliedFilters.type);
        setListParam(params, 'format', appliedFilters.format);
        setListParam(params, 'date', appliedFilters.dateRange);
        setBooleanParam(params, 'hasScenes', appliedFilters.hasScenes);
        setBooleanParam(params, 'hasSplit', appliedFilters.hasSplit);
        setBooleanParam(params, 'hasSubtitle', appliedFilters.hasSubtitle);
        setBooleanParam(params, 'noScenes', appliedFilters.hasNoScenes);
        setBooleanParam(params, 'noSplit', appliedFilters.hasNoSplit);
        setBooleanParam(params, 'noSubtitle', appliedFilters.hasNoSubtitle);
        setListParam(params, 'status', appliedFilters.statusFilter);
        setBooleanParam(params, 'queueDisabled', appliedFilters.queueDisabled);
        setBooleanParam(params, 'queueEnabled', appliedFilters.queueDisabledNo);
        setBooleanParam(params, 'splitDisabled', appliedFilters.splitDisabled);
        setBooleanParam(params, 'splitEnabled', appliedFilters.splitDisabledNo);
        setBooleanParam(params, 'subtitleDisabled', appliedFilters.subtitleDisabled);
        setBooleanParam(params, 'subtitleEnabled', appliedFilters.subtitleDisabledNo);
        setBooleanParam(params, 'noNumberSuffix', appliedFilters.noNumberSuffix);
        setBooleanParam(params, 'newVideos', appliedFilters.newVideos);
        setStringParam(params, 'content', appliedFilters.contentTag ?? '');
        setListParam(params, 'resolution', appliedFilters.resolutionFilter);
        setStringParam(params, 'sizeOp', appliedFilters.fileSizeOperator, 'gte');
        if (appliedFilters.fileSizeValue !== null) {
            params.set('size', String(appliedFilters.fileSizeValue));
        } else {
            params.delete('size');
        }
        setListParam(params, 'dirs', selectedDirectoryIds);
        setBooleanParam(params, 'dirExclude', appliedFilters.directoryExclude);
        window.history.replaceState(window.history.state, '', url);
    }, [isActive, fileSearchQuery, currentPage, itemsPerPage, defaultItemsPerPage, sortOption, sortDirection, isGroupedView, appliedFilters, selectedDirectoryIds]);

    const { data: directoriesData } = useQuery({
        queryKey: ['directories'],
        queryFn: () => fileApi.getDirectories(),
        staleTime: FILE_BROWSER_QUERY_STALE_TIME_MS,
        gcTime: FILE_BROWSER_QUERY_CACHE_TIME_MS,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });
    const directories: DirectoryRecord[] = directoriesData ?? [];
    const defaultTreeRootDirectory = useMemo(
        () => directories.find((directory) => directory.parent_id === null && normalizePath(directory.name).toLowerCase() === 'videos')
            ?? directories.find((directory) => directory.parent_id === null)
            ?? null,
        [directories],
    );
    const directoriesById = useMemo(
        () => new Map(directories.map((directory) => [directory.id, directory])),
        [directories],
    );
    const treeBreadcrumbs = useMemo(() => {
        if (!treeDirectoryId || !defaultTreeRootDirectory) return [];
        const breadcrumbs: DirectoryRecord[] = [];
        let currentDirectory = directoriesById.get(treeDirectoryId) ?? null;
        while (currentDirectory) {
            if (currentDirectory.id === defaultTreeRootDirectory.id) {
                break;
            }
            breadcrumbs.unshift(currentDirectory);
            currentDirectory = currentDirectory.parent_id ? directoriesById.get(currentDirectory.parent_id) ?? null : null;
        }
        return breadcrumbs;
    }, [defaultTreeRootDirectory, directoriesById, treeDirectoryId]);
    const isTreeRootView = layoutMode === 'tree' && treeDirectoryId === defaultTreeRootDirectory?.id;
    const treeDirectoryCountIds = useMemo(
        () => directories.filter((directory) => directory.parent_id === (treeDirectoryId ?? defaultTreeRootDirectory?.id ?? null)).map((directory) => directory.id),
        [defaultTreeRootDirectory?.id, directories, treeDirectoryId],
    );

    const { data: treeDirectoryFileCounts = {} } = useQuery<Record<string, { videoCount: number; subtitleCount: number }>>({
        queryKey: ['tree-directory-file-counts', treeDirectoryCountIds],
        queryFn: async () => {
            const directoryDetails = await Promise.all(
                treeDirectoryCountIds.map(async (directoryId) => {
                    const info = await directoryApi.getDirectoryInfo(directoryId);
                    return [
                        directoryId,
                        {
                            videoCount: info.files.filter((file) => file.file_type === 'video').length,
                            subtitleCount: info.files.filter((file) => file.file_type === 'subtitle').length,
                        },
                    ] as const;
                }),
            );
            return Object.fromEntries(directoryDetails);
        },
        enabled: layoutMode === 'tree' && treeDirectoryCountIds.length > 0,
        staleTime: FILE_BROWSER_QUERY_STALE_TIME_MS,
        gcTime: FILE_BROWSER_QUERY_CACHE_TIME_MS,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });
    const treeChildDirectories = useMemo(() => {
        const parentId = treeDirectoryId ?? defaultTreeRootDirectory?.id ?? null;
        const sorted = directories.filter((directory) => directory.parent_id === parentId);
        sorted.sort((a, b) => {
            if (treeSortOption === 'file_count') {
                const countA = (treeDirectoryFileCounts[a.id]?.videoCount ?? 0) + (treeDirectoryFileCounts[a.id]?.subtitleCount ?? 0);
                const countB = (treeDirectoryFileCounts[b.id]?.videoCount ?? 0) + (treeDirectoryFileCounts[b.id]?.subtitleCount ?? 0);
                if (countA !== countB) {
                    return sortDirection === 'asc' ? countA - countB : countB - countA;
                }
            }

            const nameCompare = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            return sortDirection === 'asc' ? nameCompare : -nameCompare;
        });
        return sorted;
    }, [defaultTreeRootDirectory?.id, directories, treeDirectoryFileCounts, treeDirectoryId, treeSortOption, sortDirection]);
    const singleSelectedTreeDirectoryId = selectedTreeDirectoryIds.length === 1 ? selectedTreeDirectoryIds[0] : null;
    const singleSelectedTreeDirectory = singleSelectedTreeDirectoryId ? directoriesById.get(singleSelectedTreeDirectoryId) ?? null : null;
    const singleSelectedFile = selectedFiles.length === 1 ? selectedFiles[0] ?? null : null;
    const moveTargetDirectory = directoryMoveTargetId ? directoriesById.get(directoryMoveTargetId) ?? null : null;
    const moveTargetFile = fileMoveTargetId ? selectedFiles.find((file) => file.id === fileMoveTargetId) ?? null : null;
    const availableMoveDestinations = useMemo(() => {
        if (!moveTargetDirectory) {
            return [] as DirectoryRecord[];
        }

        const targetPath = normalizePath(moveTargetDirectory.path).toLowerCase();
        return directories.filter((directory) => {
            if (directory.id === moveTargetDirectory.id) {
                return false;
            }

            const candidatePath = normalizePath(directory.path).toLowerCase();
            return candidatePath !== targetPath && !candidatePath.startsWith(`${targetPath}\\`);
        });
    }, [directories, moveTargetDirectory]);
    const availableFileMoveDestinations = useMemo(() => {
        if (!moveTargetFile) {
            return [] as DirectoryRecord[];
        }

        const currentDirectoryPath = getDirectoryPathFromFilePath(moveTargetFile.path).toLowerCase();
        return directories.filter((directory) => normalizePath(directory.path).toLowerCase() !== currentDirectoryPath);
    }, [directories, moveTargetFile]);

    const { data: fileBadgeTasksData } = useQuery({
        queryKey: ['tasks', 'active-file-badges'],
        queryFn: ({ signal }) => taskApi.getFileBadgeTasks(signal),
        refetchInterval: 5000,
        staleTime: FILE_BROWSER_QUERY_STALE_TIME_MS,
        gcTime: FILE_BROWSER_QUERY_CACHE_TIME_MS,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });

    const {
        isPending,
        isFetching: isFilesFetching,
        isPlaceholderData: isFilesPlaceholderData,
        data,
        isError,
        error: queryError,
    } = useQuery({
        queryKey: [
            'files',
            currentPage,
            itemsPerPage,
            fileSearchQuery,
            appliedFilters.type,
            appliedFilters.format,
            appliedFilters.dateRange,
            appliedFilters.hasScenes,
            appliedFilters.hasSplit,
            appliedFilters.hasSubtitle,
            appliedFilters.hasNoScenes,
            appliedFilters.hasNoSplit,
            appliedFilters.hasNoSubtitle,
            appliedFilters.statusFilter,
            appliedFilters.queueDisabled,
            appliedFilters.queueDisabledNo,
            appliedFilters.splitDisabled,
            appliedFilters.splitDisabledNo,
            appliedFilters.subtitleDisabled,
            appliedFilters.subtitleDisabledNo,
            appliedFilters.noNumberSuffix,
            appliedFilters.newVideos,
            appliedFilters.contentTag,
            appliedFilters.resolutionFilter,
            appliedFilters.fileSizeOperator,
            appliedFilters.fileSizeValue,
            selectedDirectoryIds,
            appliedFilters.directoryExclude,
            sortOption,
            sortDirection,
        ],
        queryFn: ({ signal }) => {
            return fileApi.getFiles({
                page: currentPage,
                limit: itemsPerPage,
                search: fileSearchQuery,
                type: appliedFilters.type.length ? appliedFilters.type.join(',') : null,
                format: appliedFilters.format.length ? appliedFilters.format.join(',') : null,
                dateRange: appliedFilters.dateRange.length ? appliedFilters.dateRange.join(',') : null,
                directoryId: selectedDirectoryIds.length ? selectedDirectoryIds.join(',') : null,
                directoryExclude: selectedDirectoryIds.length > 0 ? appliedFilters.directoryExclude : undefined,
                sortBy: sortOption,
                sortDir: sortDirection,
                hasScenes: appliedFilters.hasScenes || undefined,
                hasSplit: appliedFilters.hasSplit || undefined,
                hasSubtitle: appliedFilters.hasSubtitle || undefined,
                hasNoScenes: appliedFilters.hasNoScenes || undefined,
                hasNoSplit: appliedFilters.hasNoSplit || undefined,
                hasNoSubtitle: appliedFilters.hasNoSubtitle || undefined,
                status: appliedFilters.statusFilter.length ? appliedFilters.statusFilter.join(',') : null,
                queueDisabled: appliedFilters.queueDisabled ? true : appliedFilters.queueDisabledNo ? false : undefined,
                splitDisabled: appliedFilters.splitDisabled ? true : appliedFilters.splitDisabledNo ? false : undefined,
                subtitleDisabled: appliedFilters.subtitleDisabled ? true : appliedFilters.subtitleDisabledNo ? false : undefined,
                noNumberSuffix: appliedFilters.noNumberSuffix || undefined,
                newVideos: appliedFilters.newVideos || undefined,
                contentTag: appliedFilters.contentTag,
                resolution: appliedFilters.resolutionFilter.length ? appliedFilters.resolutionFilter.join(',') : null,
                fileSizeOperator: appliedFilters.fileSizeOperator,
                fileSizeBytes: fileSizeMbToBytes(appliedFilters.fileSizeValue),
            }, signal);
        },
        enabled: layoutMode !== 'tree' && !isGroupedView,
        staleTime: FILE_BROWSER_QUERY_STALE_TIME_MS,
        gcTime: FILE_BROWSER_QUERY_CACHE_TIME_MS,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
    });

    const {
        isPending: isGroupedPending,
        isFetching: isGroupedFetching,
        isPlaceholderData: isGroupedPlaceholderData,
        data: groupedData,
    } = useQuery({
        queryKey: [
            'files-grouped',
            currentPage,
            itemsPerPage,
            fileSearchQuery,
            appliedFilters.type,
            appliedFilters.format,
            appliedFilters.dateRange,
            appliedFilters.hasScenes,
            appliedFilters.hasSplit,
            appliedFilters.hasSubtitle,
            appliedFilters.hasNoScenes,
            appliedFilters.hasNoSplit,
            appliedFilters.hasNoSubtitle,
            appliedFilters.statusFilter,
            appliedFilters.queueDisabled,
            appliedFilters.queueDisabledNo,
            appliedFilters.splitDisabled,
            appliedFilters.splitDisabledNo,
            appliedFilters.subtitleDisabled,
            appliedFilters.subtitleDisabledNo,
            appliedFilters.noNumberSuffix,
            appliedFilters.newVideos,
            appliedFilters.contentTag,
            appliedFilters.resolutionFilter,
            appliedFilters.fileSizeOperator,
            appliedFilters.fileSizeValue,
            selectedDirectoryIds,
            appliedFilters.directoryExclude,
            sortOption,
            sortDirection,
        ],
        queryFn: ({ signal }) => fileApi.getGroupedFiles({
            page: currentPage,
            limit: itemsPerPage,
            search: fileSearchQuery,
            type: appliedFilters.type.length ? appliedFilters.type.join(',') : null,
            format: appliedFilters.format.length ? appliedFilters.format.join(',') : null,
            dateRange: appliedFilters.dateRange.length ? appliedFilters.dateRange.join(',') : null,
            directoryId: selectedDirectoryIds.length ? selectedDirectoryIds.join(',') : null,
            directoryExclude: selectedDirectoryIds.length > 0 ? appliedFilters.directoryExclude : undefined,
            sortBy: sortOption,
            sortDir: sortDirection,
            hasScenes: appliedFilters.hasScenes || undefined,
            hasSplit: appliedFilters.hasSplit || undefined,
            hasSubtitle: appliedFilters.hasSubtitle || undefined,
            hasNoScenes: appliedFilters.hasNoScenes || undefined,
            hasNoSplit: appliedFilters.hasNoSplit || undefined,
            hasNoSubtitle: appliedFilters.hasNoSubtitle || undefined,
            status: appliedFilters.statusFilter.length ? appliedFilters.statusFilter.join(',') : null,
            queueDisabled: appliedFilters.queueDisabled ? true : appliedFilters.queueDisabledNo ? false : undefined,
            splitDisabled: appliedFilters.splitDisabled ? true : appliedFilters.splitDisabledNo ? false : undefined,
            subtitleDisabled: appliedFilters.subtitleDisabled ? true : appliedFilters.subtitleDisabledNo ? false : undefined,
            noNumberSuffix: appliedFilters.noNumberSuffix || undefined,
            newVideos: appliedFilters.newVideos || undefined,
            contentTag: appliedFilters.contentTag,
            resolution: appliedFilters.resolutionFilter.length ? appliedFilters.resolutionFilter.join(',') : null,
            fileSizeOperator: appliedFilters.fileSizeOperator,
            fileSizeBytes: fileSizeMbToBytes(appliedFilters.fileSizeValue),
        }, signal),
        enabled: layoutMode !== 'tree' && isGroupedView,
        staleTime: FILE_BROWSER_QUERY_STALE_TIME_MS,
        gcTime: FILE_BROWSER_QUERY_CACHE_TIME_MS,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
    });

    const {
        isPending: isTreeFilesPending,
        isFetching: isTreeFilesFetching,
        isPlaceholderData: isTreeFilesPlaceholderData,
        data: treeFilesData,
    } = useQuery<FilesResponse | GroupedFilesResponse>({
        queryKey: [
            'files-tree-folder',
            treeDirectoryId,
            currentPage,
            itemsPerPage,
            fileSearchQuery,
            appliedFilters.type,
            appliedFilters.format,
            appliedFilters.dateRange,
            appliedFilters.hasScenes,
            appliedFilters.hasSplit,
            appliedFilters.hasSubtitle,
            appliedFilters.hasNoScenes,
            appliedFilters.hasNoSplit,
            appliedFilters.hasNoSubtitle,
            appliedFilters.statusFilter,
            appliedFilters.queueDisabled,
            appliedFilters.queueDisabledNo,
            appliedFilters.splitDisabled,
            appliedFilters.splitDisabledNo,
            appliedFilters.subtitleDisabled,
            appliedFilters.subtitleDisabledNo,
            appliedFilters.noNumberSuffix,
            appliedFilters.newVideos,
            appliedFilters.contentTag,
            appliedFilters.resolutionFilter,
            appliedFilters.fileSizeOperator,
            appliedFilters.fileSizeValue,
            sortOption,
            sortDirection,
            isGroupedView,
        ],
        queryFn: ({ signal }) => {
            if (!treeDirectoryId) {
                return Promise.resolve(
                    isGroupedView
                        ? { groups: {}, page: currentPage, limit: itemsPerPage, total: 0, totalPages: 1 }
                        : { files: [], page: currentPage, limit: itemsPerPage, total: 0, totalPages: 1 },
                );
            }

            const baseParams = {
                page: currentPage,
                limit: itemsPerPage,
                search: fileSearchQuery,
                type: appliedFilters.type.length ? appliedFilters.type.join(',') : null,
                format: appliedFilters.format.length ? appliedFilters.format.join(',') : null,
                dateRange: appliedFilters.dateRange.length ? appliedFilters.dateRange.join(',') : null,
                directoryId: treeDirectoryId,
                directoryExclude: undefined,
                sortBy: sortOption,
                sortDir: sortDirection,
                hasScenes: appliedFilters.hasScenes || undefined,
                hasSplit: appliedFilters.hasSplit || undefined,
                hasSubtitle: appliedFilters.hasSubtitle || undefined,
                hasNoScenes: appliedFilters.hasNoScenes || undefined,
                hasNoSplit: appliedFilters.hasNoSplit || undefined,
                hasNoSubtitle: appliedFilters.hasNoSubtitle || undefined,
                status: appliedFilters.statusFilter.length ? appliedFilters.statusFilter.join(',') : null,
                queueDisabled: appliedFilters.queueDisabled ? true : appliedFilters.queueDisabledNo ? false : undefined,
                splitDisabled: appliedFilters.splitDisabled ? true : appliedFilters.splitDisabledNo ? false : undefined,
                subtitleDisabled: appliedFilters.subtitleDisabled ? true : appliedFilters.subtitleDisabledNo ? false : undefined,
                noNumberSuffix: appliedFilters.noNumberSuffix || undefined,
                newVideos: appliedFilters.newVideos || undefined,
                contentTag: appliedFilters.contentTag,
                resolution: appliedFilters.resolutionFilter.length ? appliedFilters.resolutionFilter.join(',') : null,
                fileSizeOperator: appliedFilters.fileSizeOperator,
                fileSizeBytes: fileSizeMbToBytes(appliedFilters.fileSizeValue),
            } as const;

            return isGroupedView
                ? fileApi.getGroupedFiles(baseParams, signal)
                : fileApi.getFiles(baseParams, signal);
        },
        enabled: layoutMode === 'tree' && treeDirectoryId !== null,
        staleTime: FILE_BROWSER_QUERY_STALE_TIME_MS,
        gcTime: FILE_BROWSER_QUERY_CACHE_TIME_MS,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        placeholderData: keepPreviousData,
    });

    const fileMatchesTypeFilter = useCallback((file: File) => {
        if (appliedFilters.type.length === 0) return true;

        const normalizedName = file.name.toLowerCase();
        const normalizedFormat = file.format?.toLowerCase();
        const isSubtitle = file.file_type === 'subtitle'
            || normalizedFormat === '.srt'
            || normalizedFormat === '.vtt'
            || normalizedName.endsWith('.srt')
            || normalizedName.endsWith('.vtt');
        if (isSubtitle) return appliedFilters.type.includes('subtitle');

        return appliedFilters.type.includes(file.file_type as FileType);
    }, [appliedFilters.type]);
    const filterFilesForVisibleTypes = useCallback((items: File[]) => (
        items.filter(fileMatchesTypeFilter)
    ), [fileMatchesTypeFilter]);
    const filterGroupsForVisibleTypes = useCallback((groups: File[][]) => (
        groups
            .map(filterFilesForVisibleTypes)
            .filter((group) => group.length > 0)
    ), [filterFilesForVisibleTypes]);

    const files = useMemo(() => filterFilesForVisibleTypes(data?.files ?? []), [data?.files, filterFilesForVisibleTypes]);
    const treeFiles = useMemo(() => {
        if (!treeDirectoryId || isGroupedView) return [];
        const result = treeFilesData as { files?: File[] } | undefined;
        return filterFilesForVisibleTypes(result?.files ?? []);
    }, [filterFilesForVisibleTypes, isGroupedView, treeDirectoryId, treeFilesData]);
    const treeGroupedFiles = useMemo(() => {
        if (!treeDirectoryId || !isGroupedView) return [];
        const result = treeFilesData as { groups?: Record<string, File[]> } | undefined;
        return filterGroupsForVisibleTypes(Object.values(result?.groups ?? {}));
    }, [filterGroupsForVisibleTypes, isGroupedView, treeDirectoryId, treeFilesData]);
    const treeHasVisibleFiles = isGroupedView ? treeGroupedFiles.length > 0 : treeFiles.length > 0;
    const showTreeFilters = layoutMode !== 'tree' || treeHasVisibleFiles;
    const treeSortOptions = useMemo(() => {
        if (treeHasVisibleFiles) {
            return [
                { value: 'name' as const, label: 'Name' },
                { value: 'folder_name' as const, label: 'Folder Name' },
                { value: 'size' as const, label: 'Size' },
                { value: 'created_at' as const, label: 'Date Created At' },
                { value: 'modified_at' as const, label: 'Date Modified At' },
                { value: 'duration' as const, label: 'Duration' },
            ];
        }

        return [
            { value: 'name' as const, label: 'Folder Name' },
            { value: 'file_count' as const, label: 'File Count' },
        ];
    }, [treeHasVisibleFiles]);
    const defaultPreset = useMemo(() => presets.find((preset) => preset.isDefault), [presets]);
    const hasAppliedDefaultPreset = useRef(false);
    const suspendedDefaultPresetRef = useRef<FileFilterState | null>(null);
    const hasFileUrlState = useMemo(() => (
        typeof window !== 'undefined'
        && Array.from(new URLSearchParams(window.location.search).keys()).some((key) => (
            key.startsWith('files.') || FILE_QUERY_PARAMS.includes(key)
        ))
    ), []);
    const activeTaskFileIds = useMemo(() => {
        return new Set(
            (fileBadgeTasksData ?? [])
                .filter((task) => task.status === 'processing' || task.status === 'queued')
                .map((task) => task.file?.id)
                .filter((id): id is string => Boolean(id)),
        );
    }, [fileBadgeTasksData]);
    const processingTaskIdsByFileId = useMemo(() => {
        const taskIds = new Map<string, string>();
        for (const task of fileBadgeTasksData ?? []) {
            if (task.status === 'processing' && task.file?.id) {
                taskIds.set(task.file.id, task.id);
            }
        }
        return taskIds;
    }, [fileBadgeTasksData]);
    const terminalTaskStatusByFileId = useMemo(() => {
        const latestTasks = new Map<string, Task>();

        for (const task of fileBadgeTasksData ?? []) {
            if (!task.file?.id || !TERMINAL_TASK_STATUSES.includes(task.status as TerminalTaskStatus)) {
                continue;
            }

            const existing = latestTasks.get(task.file.id);
            const taskTime = new Date(task.completedAt ?? task.createdAt).getTime();
            const existingTime = existing ? new Date(existing.completedAt ?? existing.createdAt).getTime() : Number.NEGATIVE_INFINITY;

            if (!existing || taskTime > existingTime) {
                latestTasks.set(task.file.id, task);
            }
        }

        const statuses = new Map<string, TerminalTaskStatus>();
        latestTasks.forEach((task, fileId) => {
            statuses.set(fileId, task.status as TerminalTaskStatus);
        });
        return statuses;
    }, [fileBadgeTasksData]);
    const splitDisableableSelectedFiles = useMemo(
        () => selectedFiles.filter((file) => !file.split_disabled),
        [selectedFiles],
    );
    const subtitleDisableableSelectedFiles = useMemo(
        () => selectedFiles.filter((file) => !file.subtitle_disabled),
        [selectedFiles],
    );
    const splitEnableableSelectedFiles = useMemo(
        () => selectedFiles.filter((file) => file.split_disabled),
        [selectedFiles],
    );
    const subtitleEnableableSelectedFiles = useMemo(
        () => selectedFiles.filter((file) => file.subtitle_disabled),
        [selectedFiles],
    );
    const handleFileSearchQueryChange = useCallback<React.Dispatch<React.SetStateAction<string>>>((nextQuery) => {
        setSelectedFiles([]);
        setFileSearchQuery(nextQuery);
    }, [setFileSearchQuery, setSelectedFiles]);
    const { handleFileClick } = useFileSelection(files, selectedFiles, setSelectedFiles)

    const handleFileClickWrapper = (file: File, index: number, e: React.MouseEvent) => {
        handleFileClick(file, index, e);
    };
    const handleTreeNavigate = (directoryId: string | null) => {
        setTreeDirectoryId(directoryId);
        setCurrentPage(1);
        setSelectedFiles([]);
        setSelectedTreeDirectoryIds([]);
    };
    const getDirectoryActionTargetIds = (directoryId: string) => (
        selectedTreeDirectoryIds.includes(directoryId) ? selectedTreeDirectoryIds : [directoryId]
    );
    const toggleTreeDirectorySelection = (directoryId: string) => {
        setSelectedTreeDirectoryIds((prev) => (
            prev.includes(directoryId)
                ? prev.filter((id) => id !== directoryId)
                : [...prev, directoryId]
        ));
    };
    const handleTreeSearchSubmit = async (query: string) => {
        if (layoutMode !== 'tree') {
            return;
        }

        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            handleTreeNavigate(defaultTreeRootDirectory?.id ?? null);
            return;
        }

        try {
            const result = await fileApi.getFiles({
                page: 1,
                limit: 1,
                search: trimmedQuery,
                type: appliedFilters.type.length ? appliedFilters.type.join(',') : null,
                format: appliedFilters.format.length ? appliedFilters.format.join(',') : null,
                dateRange: appliedFilters.dateRange.length ? appliedFilters.dateRange.join(',') : null,
                directoryId: null,
                directoryExclude: undefined,
                sortBy: sortOption,
                sortDir: sortDirection,
                hasScenes: appliedFilters.hasScenes || undefined,
                hasSplit: appliedFilters.hasSplit || undefined,
                hasSubtitle: appliedFilters.hasSubtitle || undefined,
                hasNoScenes: appliedFilters.hasNoScenes || undefined,
                hasNoSplit: appliedFilters.hasNoSplit || undefined,
                hasNoSubtitle: appliedFilters.hasNoSubtitle || undefined,
                status: appliedFilters.statusFilter.length ? appliedFilters.statusFilter.join(',') : null,
                queueDisabled: appliedFilters.queueDisabled ? true : appliedFilters.queueDisabledNo ? false : undefined,
                splitDisabled: appliedFilters.splitDisabled ? true : appliedFilters.splitDisabledNo ? false : undefined,
                subtitleDisabled: appliedFilters.subtitleDisabled ? true : appliedFilters.subtitleDisabledNo ? false : undefined,
                noNumberSuffix: appliedFilters.noNumberSuffix || undefined,
                newVideos: appliedFilters.newVideos || undefined,
                contentTag: appliedFilters.contentTag,
                resolution: appliedFilters.resolutionFilter.length ? appliedFilters.resolutionFilter.join(',') : null,
                fileSizeOperator: appliedFilters.fileSizeOperator,
                fileSizeBytes: fileSizeMbToBytes(appliedFilters.fileSizeValue),
            });

            const firstMatch = result.files[0];
            if (!firstMatch) {
                return;
            }

            const fileDirectoryPath = getDirectoryPathFromFilePath(firstMatch.path).toLowerCase();
            const containingDirectory = directories
                .filter((directory) => {
                    const directoryPath = normalizePath(directory.path).toLowerCase();
                    return fileDirectoryPath === directoryPath || fileDirectoryPath.startsWith(`${directoryPath}\\`);
                })
                .sort((a, b) => b.path.length - a.path.length)[0];

            if (containingDirectory) {
                handleTreeNavigate(containingDirectory.id);
            }
        } catch {
            toast.error('Failed to find matching file');
        }
    };
    const handleTreeSearchClear = () => {
        if (layoutMode !== 'tree') {
            return;
        }
        handleTreeNavigate(defaultTreeRootDirectory?.id ?? null);
    };
    const handleOpenSelectedTreeDirectories = (directoryIds: string[]) => {
        if (directoryIds.length !== 1) {
            return;
        }
        handleTreeNavigate(directoryIds[0]);
    };
    const invalidateDirectoryQueries = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['directories'] }),
            queryClient.invalidateQueries({ queryKey: ['tree-directory-file-counts'] }),
            queryClient.invalidateQueries({ queryKey: ['files'] }),
            queryClient.invalidateQueries({ queryKey: ['files-grouped'] }),
            queryClient.invalidateQueries({ queryKey: ['files-tree-folder'] }),
        ]);
    };
    const openDirectoryRenameDialog = (directoryId: string) => {
        const directory = directoriesById.get(directoryId);
        if (!directory) {
            return;
        }

        setDirectoryRenameTargetId(directoryId);
        setDirectoryRenameValue(directory.name);
    };
    const openDirectoryMoveDialog = (directoryId: string) => {
        const directory = directoriesById.get(directoryId);
        if (!directory) {
            return;
        }

        setDirectoryMoveTargetId(directoryId);
        setDirectoryMoveDestinationId(directory.parent_id ?? defaultTreeRootDirectory?.id ?? '');
    };
    const openFileMoveDialog = (file: File) => {
        const currentDirectoryPath = getDirectoryPathFromFilePath(file.path).toLowerCase();
        const currentDirectory = directories.find((directory) => normalizePath(directory.path).toLowerCase() === currentDirectoryPath) ?? null;

        setFileMoveTargetId(file.id);
        setFileMoveDestinationId(currentDirectory?.parent_id ?? defaultTreeRootDirectory?.id ?? '');
    };
    const handleRenameSelectedTreeDirectory = async () => {
        if (!directoryRenameTargetId) {
            return;
        }

        const nextName = directoryRenameValue.trim();
        if (!nextName) {
            toast.error('Directory name is required');
            return;
        }

        try {
            await directoryApi.renameDirectory(directoryRenameTargetId, nextName);
            toast.success(`Renamed to "${nextName}"`);
            setDirectoryRenameTargetId(null);
            setDirectoryRenameValue('');
            await invalidateDirectoryQueries();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to rename directory');
        }
    };
    const handleMoveSelectedTreeDirectory = async () => {
        if (!directoryMoveTargetId || !directoryMoveDestinationId) {
            return;
        }

        try {
            await directoryApi.moveDirectory(directoryMoveTargetId, directoryMoveDestinationId);
            const destinationDirectory = directoriesById.get(directoryMoveDestinationId);
            toast.success(destinationDirectory ? `Moved to "${destinationDirectory.name}"` : 'Directory moved');
            setDirectoryMoveTargetId(null);
            setDirectoryMoveDestinationId('');
            await invalidateDirectoryQueries();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to move directory');
        }
    };
    const handleMoveSelectedFile = async () => {
        if (!fileMoveTargetId || !fileMoveDestinationId) {
            return;
        }

        try {
            await fileApi.moveFile(fileMoveTargetId, fileMoveDestinationId);
            const destinationDirectory = directoriesById.get(fileMoveDestinationId);
            toast.success(destinationDirectory ? `Moved to "${destinationDirectory.name}"` : 'File moved');
            setFileMoveTargetId(null);
            setFileMoveDestinationId('');
            setSelectedFiles([]);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['files'] }),
                queryClient.invalidateQueries({ queryKey: ['files-grouped'] }),
                queryClient.invalidateQueries({ queryKey: ['directories'] }),
            ]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to move file');
        }
    };
    const handleDeleteSelectedTreeDirectories = async () => {
        if (directoryDeleteTargetIds.length === 0) {
            return;
        }

        try {
            await Promise.all(directoryDeleteTargetIds.map((directoryId) => directoryApi.deleteDirectory(directoryId, {
                deleteFromDisk: deleteDirectoriesFromDisk,
                deleteFromDatabase: deleteDirectoriesFromDatabase,
            })));
            toast.success(`Deleted ${directoryDeleteTargetIds.length} director${directoryDeleteTargetIds.length === 1 ? 'y' : 'ies'}`);
            if (deleteDirectoriesFromDatabase && treeDirectoryId) {
                const currentDirectory = directoriesById.get(treeDirectoryId);
                const deletedPaths = directoryDeleteTargetIds
                    .map((directoryId) => directoriesById.get(directoryId)?.path)
                    .filter((path): path is string => Boolean(path))
                    .map((path) => normalizePath(path).toLowerCase());
                const currentPath = currentDirectory ? normalizePath(currentDirectory.path).toLowerCase() : null;
                if (currentPath && deletedPaths.some((path) => currentPath === path || currentPath.startsWith(`${path}\\`))) {
                    handleTreeNavigate(defaultTreeRootDirectory?.id ?? null);
                }
            }
            if (deleteDirectoriesFromDatabase) {
                setSelectedTreeDirectoryIds([]);
            }
            setDirectoryDeleteTargetIds([]);
            await invalidateDirectoryQueries();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to delete selected directories');
        }
    };

    const renderTreeFolderCard = (directory: DirectoryRecord) => {
        const childCount = directories.filter((candidate) => candidate.parent_id === directory.id).length;
        const directoryCounts = treeDirectoryFileCounts[directory.id];
        const videoCount = directoryCounts?.videoCount ?? 0;
        const subtitleCount = directoryCounts?.subtitleCount ?? 0;
        const isSelected = selectedTreeDirectoryIds.includes(directory.id);
        const actionTargetIds = getDirectoryActionTargetIds(directory.id);
        return (
            <ContextMenu key={directory.id}>
                <ContextMenuTrigger asChild>
                    <button
                        type="button"
                        onClick={() => {
                            if (treeClickTimeoutRef.current) {
                                window.clearTimeout(treeClickTimeoutRef.current);
                            }
                            treeClickTimeoutRef.current = window.setTimeout(() => {
                                toggleTreeDirectorySelection(directory.id);
                                treeClickTimeoutRef.current = null;
                            }, 180);
                        }}
                        onDoubleClick={() => {
                            if (treeClickTimeoutRef.current) {
                                window.clearTimeout(treeClickTimeoutRef.current);
                                treeClickTimeoutRef.current = null;
                            }
                            handleTreeNavigate(directory.id);
                        }}
                        className={cn(
                            'flex w-full items-stretch gap-3 rounded-lg border border-border/60 bg-background/60 p-4 text-left transition-colors hover:bg-muted/60',
                            isSelected && 'border-primary bg-primary/5',
                        )}
                    >
                        <div className="flex w-8 shrink-0 items-center justify-center">
                            <FolderOpen className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium">{directory.name}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                                    <FileText className="h-3.5 w-3.5" />
                                    {videoCount} video{videoCount === 1 ? '' : 's'}
                                </Badge>
                                <Badge variant="secondary" className="flex items-center gap-1 text-xs">
                                    <Captions className="h-3.5 w-3.5" />
                                    {subtitleCount} subtitle{subtitleCount === 1 ? '' : 's'}
                                </Badge>
                            </div>
                        </div>
                    </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-40">
                    <ContextMenuItem
                        className="cursor-pointer"
                        disabled={actionTargetIds.length !== 1}
                        onClick={() => handleOpenSelectedTreeDirectories(actionTargetIds)}
                    >
                        Open
                    </ContextMenuItem>
                    <ContextMenuItem
                        className="cursor-pointer"
                        disabled={actionTargetIds.length !== 1}
                        onClick={() => openDirectoryMoveDialog(actionTargetIds[0])}
                    >
                        Move
                    </ContextMenuItem>
                    <ContextMenuItem
                        className="cursor-pointer"
                        disabled={actionTargetIds.length !== 1}
                        onClick={() => openDirectoryRenameDialog(actionTargetIds[0])}
                    >
                        Rename
                    </ContextMenuItem>
                    <ContextMenuItem
                        className="cursor-pointer text-destructive focus:text-destructive"
                        onClick={() => setDirectoryDeleteTargetIds([...actionTargetIds])}
                    >
                        Delete
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>
        );
    };
    const treeTotal = isGroupedView ? ((treeFilesData as GroupedFilesResponse | undefined)?.total ?? 0) : ((treeFilesData as FilesResponse | undefined)?.total ?? 0);
    const treeTotalPages = isGroupedView ? ((treeFilesData as GroupedFilesResponse | undefined)?.totalPages ?? 1) : ((treeFilesData as FilesResponse | undefined)?.totalPages ?? 1);
    const total = layoutMode === 'tree' && treeDirectoryId !== null ? treeTotal : isGroupedView ? (groupedData?.total ?? 0) : (data?.total ?? 0);
    const totalPages = layoutMode === 'tree' && treeDirectoryId !== null ? treeTotalPages : isGroupedView ? (groupedData?.totalPages ?? 1) : (data?.totalPages ?? 1);
    const groupedFiles = filterGroupsForVisibleTypes(Object.values(groupedData?.groups ?? {}));
    const layoutContainerClass = layoutMode === 'grid'
        ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 1921:grid-cols-5 gap-4'
        : layoutMode === 'tree'
            ? 'flex flex-col gap-3'
            : 'flex flex-col gap-4';
    const loadingLayoutContainerClass = layoutMode === 'grid'
        ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'
        : 'flex flex-col gap-4';
    const fileSkeletonCount = Math.min(itemsPerPage, 50);
    const isFilesLoading = isPending || isFilesFetching || isFilesPlaceholderData || (data !== undefined && data.page !== currentPage);
    const isGroupedLoading = isGroupedPending || isGroupedFetching || isGroupedPlaceholderData || (groupedData !== undefined && groupedData.page !== currentPage);
    const isTreeFilesLoading = isTreeFilesPending || isTreeFilesFetching || isTreeFilesPlaceholderData || (treeFilesData !== undefined && treeFilesData.page !== currentPage);

    const viewFileInfo = async (file: File) => {
        try {
            const fileInfo = await fileApi.getFileInfo(file.id);
            setSelectedFileForInfo(fileInfo);
            setIsFileInfoModalOpen(true);
        } catch (err) {
            console.error('Failed to fetch file info:', err);
            toast.error('Failed to load file information');
        }
    };

    const addFileToNewTask = (file: File) => {
        setSelectedFiles([file]);
        setIsDialogOpen(true);
    };

    const moveSingleFile = (file: File) => {
        setSelectedFiles([file]);
        openFileMoveDialog(file);
    };

    const toggleFileTaskTypeDisabled = async (file: File, taskType: 'split' | 'subtitle') => {
        try {
            const disabled = taskType === 'split' ? file.split_disabled : file.subtitle_disabled
            if (disabled) {
                await fileApi.bulkEnableTaskType(taskType, [file.id])
            } else {
                await fileApi.bulkDisableTaskType(taskType, [file.id])
            }
            queryClient.invalidateQueries({ queryKey: ['files'] })
            queryClient.invalidateQueries({ queryKey: ['files-grouped'] })
            queryClient.invalidateQueries({ queryKey: ['files-tree-folder'] })
        } catch {
            toast.error(`Failed to update ${taskType} setting`)
        }
    };

    const deleteScenesForFile = async (file: File) => {
        try {
            await sceneApi.deleteScenesForFile(file.id)
            queryClient.invalidateQueries({ queryKey: ['files'] })
            queryClient.invalidateQueries({ queryKey: ['files-grouped'] })
            queryClient.invalidateQueries({ queryKey: ['files-tree-folder'] })
            toast.success(`Scenes deleted for "${file.name}"`)
        } catch {
            toast.error('Failed to delete scenes')
        }
    };

    const isVideoFile = (file: File) => (
        file.name.endsWith('.mp4') || file.name.endsWith('.mkv') || file.name.endsWith('.avi') || file.name.endsWith('.mov') || file.name.endsWith('.flv') || file.name.endsWith('.wmv')
    );

    const renderGroupedFileCard = (group: File[]) => {
        const originalFile = group[0];
        const selected = selectedFiles.some(f => f.id === originalFile.id);
        const videoFile = isVideoFile(originalFile);

        return (
            <ContextMenu key={originalFile.id}>
                <ContextMenuTrigger asChild>
                    <div
                        className={cn('h-full', highlightFileId === originalFile.id && 'animate-highlight-flash')}
                        onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                    >
                        <FileGroupCard
                            files={group}
                            selected={selected}
                            onOpenDetails={(files) => {
                                setSelectedGroupFiles(files);
                                setIsGroupModalOpen(true);
                            }}
                        />
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-52">
                    <ContextMenuItem
                        className="cursor-pointer"
                        onClick={() => {
                            setSelectedGroupFiles(group);
                            setIsGroupModalOpen(true);
                        }}
                    >
                        View Group Details
                    </ContextMenuItem>
                    <ContextMenuItem className="cursor-pointer" onClick={() => void viewFileInfo(originalFile)}>
                        View Info
                    </ContextMenuItem>
                    {videoFile && (originalFile.has_scenes || originalFile.has_split || originalFile.has_subtitle) && (
                        <ContextMenuItem className="cursor-pointer" onClick={() => handleViewFileGroup(originalFile)}>
                            View Processed Files
                        </ContextMenuItem>
                    )}
                    {videoFile && (
                        <ContextMenuItem className="cursor-pointer" onClick={() => setFileTasksTarget(originalFile)}>
                            View Tasks
                        </ContextMenuItem>
                    )}
                    {videoFile && (
                        <ContextMenuItem className="cursor-pointer" onClick={() => setSceneViewerFile(originalFile)}>
                            {originalFile.has_scenes ? 'View Scenes' : 'Create Custom Scene'}
                        </ContextMenuItem>
                    )}
                    {videoFile && (
                        <ContextMenuItem
                            className={cn('cursor-pointer', originalFile.queue_disabled && 'cursor-not-allowed opacity-50')}
                            onClick={(event) => {
                                if (originalFile.queue_disabled) {
                                    event.preventDefault();
                                    return;
                                }
                                addFileToNewTask(originalFile);
                            }}
                        >
                            Add to New Task
                        </ContextMenuItem>
                    )}
                    {videoFile && (
                        <ContextMenuItem className="cursor-pointer" onClick={() => void toggleFileTaskTypeDisabled(originalFile, 'split')}>
                            {originalFile.split_disabled ? 'Enable for Split' : 'Disable From Split'}
                        </ContextMenuItem>
                    )}
                    {videoFile && (
                        <ContextMenuItem className="cursor-pointer" onClick={() => void toggleFileTaskTypeDisabled(originalFile, 'subtitle')}>
                            {originalFile.subtitle_disabled ? 'Enable for Subtitle' : 'Disable From Subtitle'}
                        </ContextMenuItem>
                    )}
                    <ContextMenuItem className="cursor-pointer" onClick={() => moveSingleFile(originalFile)}>
                        Move
                    </ContextMenuItem>
                    {originalFile.name.endsWith('.srt') && (
                        <ContextMenuItem className="cursor-pointer" onClick={() => setSubtitleToEdit(originalFile)}>
                            Edit Subtitle
                        </ContextMenuItem>
                    )}
                    {originalFile.has_scenes && (
                        <ContextMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => void deleteScenesForFile(originalFile)}>
                            Delete Scenes
                        </ContextMenuItem>
                    )}
                </ContextMenuContent>
            </ContextMenu>
        );
    };

    const renderFileCard = (file: File, index: number) => (
        <div
            key={file.id}
            ref={(el) => { if (el) fileRefsMap.current[file.id] = el; else delete fileRefsMap.current[file.id]; }}
            className={cn('h-full', highlightFileId === file.id && 'animate-highlight-flash')}
            onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
        >
            <FileCard
                item={file}
                rootPath={defaultTreeRootDirectory?.path}
                onClick={(e) => handleFileClickWrapper(file, index, e)}
                selected={selectedFiles.some(f => f.id === file.id)}
                onViewInfo={(file) => void viewFileInfo(file as File)}
                onViewFileTasks={(file) => setFileTasksTarget(file)}
                onAddToNewTask={addFileToNewTask}
                onEditSubtitle={(file) => {
                    setSubtitleToEdit(file);
                    setIsSubtitleEditorOpen(true);
                }}
                onMoveFile={moveSingleFile}
                onDeleteFile={async (file, options) => {
                    try {
                        await fileApi.deleteFile(file.id, options);
                        if (options?.deleteFromDatabase !== false) {
                            setSelectedFiles(prev => prev.filter(f => f.id !== file.id));
                        }
                        toast.success(`File "${file.name}" deleted`);
                        queryClient.invalidateQueries({ queryKey: ['files'] });
                        queryClient.invalidateQueries({ queryKey: ['files-grouped'] });
                    } catch (err) {
                        toast.error('Failed to delete file');
                    }
                }}
                onRenameFile={async (file, newName) => {
                    const optimistic = { ...file, name: newName };
                    const previousFiles = queryClient.getQueriesData<FilesResponse>({ queryKey: ['files'] });
                    const previousGrouped = queryClient.getQueriesData<GroupedFilesResponse>({ queryKey: ['files-grouped'] });
                    const previousTree = queryClient.getQueriesData<FilesResponse | GroupedFilesResponse>({ queryKey: ['files-tree-folder'] });

                    queryClient.setQueriesData<FilesResponse>({ queryKey: ['files'] }, (oldData) => replaceFileInFilesResponse(oldData, optimistic));
                    queryClient.setQueriesData<GroupedFilesResponse>({ queryKey: ['files-grouped'] }, (oldData) => replaceFileInGroupedResponse(oldData, optimistic));
                    queryClient.setQueriesData<FilesResponse | GroupedFilesResponse>({ queryKey: ['files-tree-folder'] }, (oldData) => replaceFileInAnyFilesResponse(oldData, optimistic));
                    setSelectedFiles((prev) => prev.map((selectedFile) => selectedFile.id === file.id ? optimistic : selectedFile));

                    try {
                        const renamedFile = await fileApi.renameFile(file.id, newName);
                        queryClient.setQueriesData<FilesResponse>({ queryKey: ['files'] }, (oldData) => replaceFileInFilesResponse(oldData, renamedFile, file.id));
                        queryClient.setQueriesData<GroupedFilesResponse>({ queryKey: ['files-grouped'] }, (oldData) => replaceFileInGroupedResponse(oldData, renamedFile, file.id));
                        queryClient.setQueriesData<FilesResponse | GroupedFilesResponse>({ queryKey: ['files-tree-folder'] }, (oldData) => replaceFileInAnyFilesResponse(oldData, renamedFile, file.id));
                        setSelectedFiles((prev) => prev.map((selectedFile) => selectedFile.id === file.id ? renamedFile : selectedFile));
                        toast.success(`Renamed to "${newName}"`);
                        queryClient.invalidateQueries({ queryKey: ['files'] });
                        queryClient.invalidateQueries({ queryKey: ['files-grouped'] });
                        queryClient.invalidateQueries({ queryKey: ['files-tree-folder'] });
                    } catch (err) {
                        previousFiles.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
                        previousGrouped.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
                        previousTree.forEach(([queryKey, data]) => queryClient.setQueryData(queryKey, data));
                        setSelectedFiles((prev) => prev.map((selectedFile) => selectedFile.id === file.id ? file : selectedFile));
                        toast.error(err instanceof Error ? err.message : 'Failed to rename file');
                    }
                }}
                onToggleTaskTypeDisabled={(file, taskType) => void toggleFileTaskTypeDisabled(file, taskType)}
                onViewFileGroup={handleViewFileGroup}
                onViewScenes={(file) => setSceneViewerFile(file)}
                processingTaskId={processingTaskIdsByFileId.get(file.id)}
                onCancelTask={async (taskId) => {
                    try {
                        await cancelTaskMutation.mutateAsync(taskId);
                        toast.success('Task cancelled');
                        await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ['tasks', 'active-file-badges'] }),
                            queryClient.invalidateQueries({ queryKey: ['files'] }),
                            queryClient.invalidateQueries({ queryKey: ['files-grouped'] }),
                        ]);
                    } catch {
                        toast.error('Failed to cancel task');
                    }
                }}
                onDeleteTask={async (taskId) => {
                    try {
                        await deleteTaskMutation.mutateAsync(taskId);
                        toast.success('Task deleted');
                        await Promise.all([
                            queryClient.invalidateQueries({ queryKey: ['tasks', 'active-file-badges'] }),
                            queryClient.invalidateQueries({ queryKey: ['files'] }),
                            queryClient.invalidateQueries({ queryKey: ['files-grouped'] }),
                        ]);
                    } catch (error) {
                        toast.error(error instanceof Error ? error.message : 'Failed to delete task');
                        throw error;
                    }
                }}
                onDeleteScenes={deleteScenesForFile}
                hasActiveTask={activeTaskFileIds.has(file.id)}
                terminalTaskStatus={activeTaskFileIds.has(file.id) ? undefined : terminalTaskStatusByFileId.get(file.id)}
            />
        </div>
    );

    useEffect(() => {
        if (!defaultTreeRootDirectory) return;
        setTreeDirectoryId((current) => current ?? defaultTreeRootDirectory.id);
    }, [defaultTreeRootDirectory]);

    useEffect(() => {
        if (hasFileUrlState) return
        if (hasAppliedDefaultPreset.current) return
        if (!defaultPreset) return
        hasAppliedDefaultPreset.current = true
        applyFiltersSnapshot(defaultPreset.filters, defaultPreset.filters.isGroupedView)
    }, [defaultPreset, hasFileUrlState])

    useEffect(() => {
        if (layoutMode !== 'tree' && treeDirectoryId !== null) {
            setTreeDirectoryId(null);
        }
    }, [layoutMode, treeDirectoryId]);

    const applyFiltersSnapshot = (filters: FileFilterState, isGroupedOverride?: boolean) => {
        const selectedIds = filters.selectedDirectoryIds ?? (filters.selectedDirectoryId ? [filters.selectedDirectoryId] : []);
        const grouped = isGroupedOverride ?? filters.isGroupedView;
        const normalizedFilters = {
            ...filters,
            queueDisabled: filters.queueDisabled ?? false,
            queueDisabledNo: filters.queueDisabledNo ?? false,
            splitDisabled: filters.splitDisabled ?? false,
            splitDisabledNo: filters.splitDisabledNo ?? false,
            subtitleDisabled: filters.subtitleDisabled ?? false,
            subtitleDisabledNo: filters.subtitleDisabledNo ?? false,
            noNumberSuffix: filters.noNumberSuffix ?? false,
            newVideos: filters.newVideos ?? false,
            contentTag: filters.contentTag ?? null,
            fileSizeOperator: filters.fileSizeOperator ?? 'gte',
            fileSizeValue: filters.fileSizeValue ?? null,
            selectedDirectoryIds: selectedIds,
            directoryExclude: selectedIds.length > 0 ? (filters.directoryExclude ?? false) : false,
            isGroupedView: grouped,
        };
        setDraftFilters(normalizedFilters);
        setDraftIsGroupedView(grouped);
        setDraftSelectedDirectoryIds(selectedIds);
        setAppliedFilters(normalizedFilters);
        setIsGroupedView(grouped);
        setSelectedDirectoryIds(selectedIds);
        setIsFilterActive(isFileFilterActive(normalizedFilters) || grouped);
        setCurrentPage(1);
    };

    useEffect(() => {
        if (!defaultPreset) return;

        const defaultSelectedIds = defaultPreset.filters.selectedDirectoryIds
            ?? (defaultPreset.filters.selectedDirectoryId ? [defaultPreset.filters.selectedDirectoryId] : []);
        const normalizedDefaultPreset = {
            ...defaultPreset.filters,
            queueDisabled: defaultPreset.filters.queueDisabled ?? false,
            queueDisabledNo: defaultPreset.filters.queueDisabledNo ?? false,
            splitDisabled: defaultPreset.filters.splitDisabled ?? false,
            splitDisabledNo: defaultPreset.filters.splitDisabledNo ?? false,
            subtitleDisabled: defaultPreset.filters.subtitleDisabled ?? false,
            subtitleDisabledNo: defaultPreset.filters.subtitleDisabledNo ?? false,
            noNumberSuffix: defaultPreset.filters.noNumberSuffix ?? false,
            newVideos: defaultPreset.filters.newVideos ?? false,
            contentTag: defaultPreset.filters.contentTag ?? null,
            fileSizeOperator: defaultPreset.filters.fileSizeOperator ?? 'gte',
            fileSizeValue: defaultPreset.filters.fileSizeValue ?? null,
            selectedDirectoryIds: defaultSelectedIds,
            directoryExclude: defaultSelectedIds.length > 0 ? (defaultPreset.filters.directoryExclude ?? false) : false,
            isGroupedView: defaultPreset.filters.isGroupedView,
        };
        const appliedIsDefaultPreset = JSON.stringify(appliedFilters) === JSON.stringify(normalizedDefaultPreset)
            && isGroupedView === normalizedDefaultPreset.isGroupedView;
        const appliedIsEmpty = JSON.stringify(appliedFilters) === JSON.stringify({ ...EMPTY_FILE_FILTER_STATE }) && !isGroupedView;

        if (layoutMode === 'tree') {
            if (!suspendedDefaultPresetRef.current && appliedIsDefaultPreset) {
                suspendedDefaultPresetRef.current = normalizedDefaultPreset;
                applyFiltersSnapshot({ ...EMPTY_FILE_FILTER_STATE }, false);
            }
            return;
        }

        if (suspendedDefaultPresetRef.current && appliedIsEmpty) {
            applyFiltersSnapshot(suspendedDefaultPresetRef.current, suspendedDefaultPresetRef.current.isGroupedView);
        }
        suspendedDefaultPresetRef.current = null;
    }, [appliedFilters, defaultPreset, isGroupedView, layoutMode]);

    const handleApplyFilters = () => {
        applyFiltersSnapshot(normalizeFiltersForApply({ ...draftFilters, selectedDirectoryIds: draftSelectedDirectoryIds, directoryExclude: draftSelectedDirectoryIds.length > 0 ? draftFilters.directoryExclude : false, isGroupedView: draftIsGroupedView }));
        setIsFilterDialogOpen(false);
    };

    const handleResetFilters = () => {
        setDraftFilters({ ...EMPTY_FILE_FILTER_STATE });
        setAppliedFilters({ ...EMPTY_FILE_FILTER_STATE });
        setDraftIsGroupedView(false);
        setIsGroupedView(false);
        setDraftSelectedDirectoryIds([]);
        setSelectedDirectoryIds([]);
        handleFileSearchQueryChange('');
        setIsFilterDialogOpen(false);
        setIsFilterActive(false);
        setCurrentPage(1);
    };

    /**
     * Load a saved preset into the filter dialog draft.
     * @param filters - Full preset snapshot including directory and grouped view
     */
    const handleLoadPreset = (filters: FileFilterState) => {
        const selectedIds = filters.selectedDirectoryIds ?? (filters.selectedDirectoryId ? [filters.selectedDirectoryId] : []);
        setDraftFilters({
            ...filters,
            queueDisabled: filters.queueDisabled ?? false,
            queueDisabledNo: filters.queueDisabledNo ?? false,
            splitDisabled: filters.splitDisabled ?? false,
            splitDisabledNo: filters.splitDisabledNo ?? false,
            subtitleDisabled: filters.subtitleDisabled ?? false,
            subtitleDisabledNo: filters.subtitleDisabledNo ?? false,
            noNumberSuffix: filters.noNumberSuffix ?? false,
            newVideos: filters.newVideos ?? false,
            contentTag: filters.contentTag ?? null,
            fileSizeOperator: filters.fileSizeOperator ?? 'gte',
            fileSizeValue: filters.fileSizeValue ?? null,
            selectedDirectoryIds: selectedIds,
            directoryExclude: selectedIds.length > 0 ? (filters.directoryExclude ?? false) : false,
        });
        setDraftIsGroupedView(filters.isGroupedView);
        setDraftSelectedDirectoryIds(selectedIds);
    };

    const handleSetDefaultPreset = async (presetId: string | null) => {
        const currentDefault = presets.find((preset) => preset.isDefault);
        const target = presetId ? presets.find((preset) => preset.id === presetId) : currentDefault;
        if (!target) return;
        try {
            if (currentDefault && currentDefault.id !== target.id) {
                await updatePreset({ id: currentDefault.id, updates: { isDefault: false } });
            }
            await updatePreset({ id: target.id, updates: { isDefault: presetId !== null } });
        } catch {
            toast.error('Failed to update default filter')
        }
    };

    const handleRemoveFilter = (filterType: string, value: string | number | boolean) => {
        if (filterType !== 'selectedDirectoryIds') {
            setAppliedFilters((prev) => {
                if (filterType === 'type' || filterType === 'format' || filterType === 'dateRange' || filterType === 'statusFilter' || filterType === 'resolutionFilter') {
                    const key = filterType as 'type' | 'format' | 'dateRange' | 'statusFilter' | 'resolutionFilter'
                    return { ...prev, [key]: prev[key].filter((v) => v !== value) }
                }
                if (
                    filterType === 'fileSizeValue' ||
                    filterType === 'hasScenes' ||
                    filterType === 'hasSplit' ||
                    filterType === 'hasSubtitle' ||
                    filterType === 'hasNoScenes' ||
                    filterType === 'hasNoSplit' ||
                    filterType === 'hasNoSubtitle' ||
                    filterType === 'queueDisabled' ||
                    filterType === 'queueDisabledNo' ||
                    filterType === 'splitDisabled' ||
                    filterType === 'splitDisabledNo' ||
                    filterType === 'subtitleDisabled' ||
                    filterType === 'subtitleDisabledNo' ||
                    filterType === 'noNumberSuffix' ||
                    filterType === 'newVideos' ||
                    filterType === 'contentTag'
                ) {
                    if (filterType === 'fileSizeValue') {
                        return { ...prev, fileSizeValue: null }
                    }
                    if (filterType === 'contentTag') {
                        return { ...prev, contentTag: null }
                    }
                    return { ...prev, [filterType]: false }
                }
                return prev
            })
        }

        if (filterType === 'selectedDirectoryIds') {
            setSelectedDirectoryIds((prev) => prev.filter((id) => id !== value))
            setAppliedFilters((prev) => ({ ...prev, selectedDirectoryIds: prev.selectedDirectoryIds.filter((id) => id !== value) }))
        }

        setCurrentPage(1)
    }

    useEffect(() => {
        setCurrentPage(1);
    }, [
        fileSearchQuery,
        sortOption,
        sortDirection,
        selectedDirectoryIds,
    ]);

    useEffect(() => {
        if (!highlightFileId) return
        const element = fileRefsMap.current[highlightFileId]
        if (!element) return
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [highlightFileId])

    const handleViewFileGroup = async (file: File) => {
        try {
            const allFilesData = await fileApi.getFileWithChildren(file.id);
            setSelectedGroupFiles(filterFilesForVisibleTypes(allFilesData.files ?? []));
            setIsGroupModalOpen(true);
        } catch (err) {
            console.error('Failed to fetch grouped files:', err);
            toast.error('Failed to load file group');
        }
    };

    const handleDisableFromTaskType = async (taskType: 'split' | 'subtitle') => {
        const disableableFiles = selectedFiles.filter((file) => taskType === 'split' ? !file.split_disabled : !file.subtitle_disabled);
        if (bulkDisableLoading || disableableFiles.length === 0) {
            return;
        }

        setBulkDisableLoading(true);
        try {
            const updatedFiles = await fileApi.bulkDisableTaskType(taskType, disableableFiles.map((file) => file.id));
            const updatedIds = new Set(updatedFiles.map((file) => file.id));
            queryClient.setQueryData(['files', currentPage, itemsPerPage, fileSearchQuery, appliedFilters.type, appliedFilters.format, appliedFilters.dateRange, appliedFilters.hasScenes, appliedFilters.hasSplit, appliedFilters.hasSubtitle, appliedFilters.hasNoScenes, appliedFilters.hasNoSplit, appliedFilters.hasNoSubtitle, appliedFilters.statusFilter, appliedFilters.queueDisabled, appliedFilters.queueDisabledNo, appliedFilters.splitDisabled, appliedFilters.splitDisabledNo, appliedFilters.subtitleDisabled, appliedFilters.subtitleDisabledNo, appliedFilters.noNumberSuffix, appliedFilters.newVideos, appliedFilters.contentTag, appliedFilters.resolutionFilter, appliedFilters.fileSizeOperator, appliedFilters.fileSizeValue, selectedDirectoryIds, appliedFilters.directoryExclude, sortOption, sortDirection], (prev: any) => {
                if (!prev?.files) {
                    return prev;
                }
                return {
                    ...prev,
                    files: prev.files.map((file: File) => updatedIds.has(file.id) ? { ...file, [`${taskType}_disabled`]: true } : file),
                };
            });
            setSelectedFiles((prev) =>
                prev.map((file) => updatedIds.has(file.id) ? { ...file, [`${taskType}_disabled`]: true } : file),
            );
            await queryClient.invalidateQueries({ queryKey: ['files-grouped'] });
            toast.success(`Disabled ${updatedFiles.length} file${updatedFiles.length === 1 ? '' : 's'} from ${taskType}`);
        } catch (err) {
            toast.error(`Failed to disable files from ${taskType}`);
        } finally {
            setBulkDisableLoading(false);
        }
    };

    const handleEnableForTaskType = async (taskType: 'split' | 'subtitle') => {
        const enableableSelectedFiles = selectedFiles.filter((file) => taskType === 'split' ? file.split_disabled : file.subtitle_disabled);
        if (bulkEnableLoading || enableableSelectedFiles.length === 0) {
            return;
        }

        setBulkEnableLoading(true);
        try {
            const updatedFiles = await fileApi.bulkEnableTaskType(taskType, enableableSelectedFiles.map((file) => file.id));
            const updatedIds = new Set(updatedFiles.map((file) => file.id));
            queryClient.setQueryData(['files', currentPage, itemsPerPage, fileSearchQuery, appliedFilters.type, appliedFilters.format, appliedFilters.dateRange, appliedFilters.hasScenes, appliedFilters.hasSplit, appliedFilters.hasSubtitle, appliedFilters.hasNoScenes, appliedFilters.hasNoSplit, appliedFilters.hasNoSubtitle, appliedFilters.statusFilter, appliedFilters.queueDisabled, appliedFilters.queueDisabledNo, appliedFilters.splitDisabled, appliedFilters.splitDisabledNo, appliedFilters.subtitleDisabled, appliedFilters.subtitleDisabledNo, appliedFilters.noNumberSuffix, appliedFilters.newVideos, appliedFilters.contentTag, appliedFilters.resolutionFilter, appliedFilters.fileSizeOperator, appliedFilters.fileSizeValue, selectedDirectoryIds, appliedFilters.directoryExclude, sortOption, sortDirection], (prev: any) => {
                if (!prev?.files) {
                    return prev;
                }
                return {
                    ...prev,
                    files: prev.files.map((file: File) => updatedIds.has(file.id) ? { ...file, [`${taskType}_disabled`]: false } : file),
                };
            });
            setSelectedFiles((prev) =>
                prev.map((file) => updatedIds.has(file.id) ? { ...file, [`${taskType}_disabled`]: false } : file),
            );
            await queryClient.invalidateQueries({ queryKey: ['files-grouped'] });
            toast.success(`Enabled ${updatedFiles.length} file${updatedFiles.length === 1 ? '' : 's'} for ${taskType}`);
        } catch (err) {
            toast.error(`Failed to enable files for ${taskType}`);
        } finally {
            setBulkEnableLoading(false);
        }
    };

    return <>
        <div className="flex flex-col gap-2 pb-2 pt-1 pr-1">
        <FileBrowserToolbar
            layoutMode={layoutMode}
            setLayoutMode={setLayoutMode}
            isRefreshing={isRefreshing}
            onRefresh={async () => {
                setIsRefreshing(true);
                try {
                    await queryClient.invalidateQueries({ queryKey: ['files'] });
                    await queryClient.invalidateQueries({ queryKey: ['files-grouped'] });
                } finally {
                    window.setTimeout(() => setIsRefreshing(false), 600);
                }
            }}
            showTreeFilters={showTreeFilters}
            isTreeRootView={isTreeRootView}
            isFilterActive={isFilterActive}
            handleResetFilters={handleResetFilters}
            isFilterDialogOpen={isFilterDialogOpen}
            setIsFilterDialogOpen={setIsFilterDialogOpen}
            draftFilters={draftFilters}
            setDraftFilters={setDraftFilters}
            draftIsGroupedView={draftIsGroupedView}
            setDraftIsGroupedView={setDraftIsGroupedView}
            directories={directories}
            draftSelectedDirectoryIds={draftSelectedDirectoryIds}
            setDraftSelectedDirectoryIds={setDraftSelectedDirectoryIds}
            handleApplyFilters={handleApplyFilters}
            onOpenFilters={() => {
                setDraftIsGroupedView(isGroupedView);
                setDraftSelectedDirectoryIds(selectedDirectoryIds);
                setDraftFilters({
                    ...appliedFilters,
                    selectedDirectoryIds,
                    directoryExclude: selectedDirectoryIds.length > 0 ? appliedFilters.directoryExclude : false,
                    isGroupedView,
                });
            }}
            handleLoadPreset={handleLoadPreset}
            handleSetDefaultPreset={handleSetDefaultPreset}
            isSortDropdownOpen={isSortDropdownOpen}
            setIsSortDropdownOpen={setIsSortDropdownOpen}
            sortOption={layoutMode === 'tree' && !treeHasVisibleFiles ? treeSortOption : sortOption}
            setSortOption={layoutMode === 'tree' && !treeHasVisibleFiles ? setTreeSortOption : setSortOption}
            sortDirection={sortDirection}
            setSortDirection={setSortDirection}
            treeSortOptions={layoutMode === 'tree' ? treeSortOptions : undefined}
            isGroupedView={isGroupedView}
            fileSearchQuery={fileSearchQuery}
            setFileSearchQuery={handleFileSearchQueryChange}
            searchFocused={searchFocused}
            setSearchFocused={setSearchFocused}
            onTreeSearchSubmit={handleTreeSearchSubmit}
            onTreeSearchClear={handleTreeSearchClear}
        />

        {showTreeFilters && !isTreeRootView && (
            <FilterBadges
                appliedFilters={{
                    ...appliedFilters,
                    selectedDirectoryIds: selectedDirectoryIds,
                    resolutionFilter: appliedFilters.resolutionFilter,
                }}
                directories={directories}
                onRemoveFilter={handleRemoveFilter}
            />
        )}
        <SelectedTreeDirectoriesBar
            selectedTreeDirectoryIds={selectedTreeDirectoryIds}
            treeChildDirectories={treeChildDirectories}
            singleSelectedTreeDirectory={singleSelectedTreeDirectory}
            setSelectedTreeDirectoryIds={setSelectedTreeDirectoryIds}
            openDirectoryMoveDialog={openDirectoryMoveDialog}
            openDirectoryRenameDialog={openDirectoryRenameDialog}
            setDirectoryDeleteTargetIds={setDirectoryDeleteTargetIds}
        />

        <SelectedFilesActionBar
            selectedFiles={selectedFiles}
            layoutMode={layoutMode}
            singleSelectedFile={singleSelectedFile}
            setIsDialogOpen={setIsDialogOpen}
            openFileMoveDialog={openFileMoveDialog}
            splitDisableableSelectedFiles={splitDisableableSelectedFiles}
            subtitleDisableableSelectedFiles={subtitleDisableableSelectedFiles}
            splitEnableableSelectedFiles={splitEnableableSelectedFiles}
            subtitleEnableableSelectedFiles={subtitleEnableableSelectedFiles}
            bulkDisableLoading={bulkDisableLoading}
            bulkEnableLoading={bulkEnableLoading}
            handleDisableFromTaskType={handleDisableFromTaskType}
            handleEnableForTaskType={handleEnableForTaskType}
            setSelectedFiles={setSelectedFiles}
            showSelectAll={layoutMode !== 'tree' && !isGroupedView}
            filesCount={files.length}
            onToggleSelectAll={() => selectedFiles.length === files.length ? setSelectedFiles([]) : setSelectedFiles(files)}
        />
        {layoutMode === 'tree' && treeBreadcrumbs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 py-1"
                    onClick={() => handleTreeNavigate(null)}
                >
                    {defaultTreeRootDirectory?.name ?? 'videos'}
                </Button>
                {treeBreadcrumbs.map((directory, index) => (
                    <React.Fragment key={directory.id}>
                        <ChevronRight className="h-3.5 w-3.5" />
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                                'h-auto px-2 py-1',
                                index === treeBreadcrumbs.length - 1 && 'font-medium text-foreground',
                            )}
                            onClick={() => handleTreeNavigate(directory.id)}
                        >
                            {directory.name}
                        </Button>
                    </React.Fragment>
                ))}
            </div>
        )}
        </div>

        {/* Scrollable directory content */}
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto p-2 scrollbar relative">
            <div className="">
                {layoutMode !== 'tree' && isFilesLoading && !isGroupedView ? (
                    <div className={loadingLayoutContainerClass}>
                        {Array.from({ length: fileSkeletonCount }).map((_, i) => (
                            <FileRowSkeleton key={i} />
                        ))}
                    </div>
                ) : layoutMode !== 'tree' && !isFilesLoading && !isGroupedLoading && total === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
                        {fileSearchQuery || isFilterActive ? (
                            <>
                                <SearchX className="w-12 h-12 opacity-30" />
                                <p className="text-sm font-medium">No files match your search</p>
                                <p className="text-xs opacity-70">Try adjusting your filters or search term</p>
                            </>
                        ) : (
                            <>
                                <FolderOpen className="w-12 h-12 opacity-30" />
                                <p className="text-sm font-medium">No files yet</p>
                                <p className="text-xs opacity-70">Upload files to get started</p>
                            </>
                        )}
                    </div>
                ) : layoutMode === 'tree' ? (
                    <div className="flex flex-col gap-4">
                        {treeChildDirectories.length > 0 ? (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                                {treeChildDirectories.map((directory) => renderTreeFolderCard(directory))}
                            </div>
                        ) : treeDirectoryId === null ? (
                            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                                <FolderOpen className="w-12 h-12 opacity-30" />
                                <p className="text-sm font-medium">No folders found</p>
                            </div>
                        ) : null}

                        {treeDirectoryId !== null && isTreeFilesLoading ? (
                            <div className={isGroupedView ? 'flex flex-col gap-4' : 'grid grid-cols-1 gap-4 xl:grid-cols-4'}>
                                {Array.from({ length: fileSkeletonCount }).map((_, i) => (
                                    isGroupedView ? <FileGroupSkeleton key={i} /> : <FileRowSkeleton key={i} />
                                ))}
                            </div>
                        ) : isGroupedView ? (
                            treeGroupedFiles.length > 0 ? (
                                <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                                    {treeGroupedFiles.map((group) => renderGroupedFileCard(group))}
                                </div>
                            ) : treeChildDirectories.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                                    <SearchX className="w-12 h-12 opacity-30" />
                                    <p className="text-sm font-medium">This folder is empty</p>
                                </div>
                            ) : null
                        ) : treeFiles.length > 0 ? (
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
                                {treeFiles.map((file, index) => renderFileCard(file, index))}
                            </div>
                        ) : treeChildDirectories.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
                                <SearchX className="w-12 h-12 opacity-30" />
                                <p className="text-sm font-medium">This folder is empty</p>
                            </div>
                        ) : null}
                    </div>
                ) : isGroupedView && isGroupedLoading ? (
                    <div className="flex flex-col gap-4">
                        {Array.from({ length: fileSkeletonCount }).map((_, i) => (
                            <FileGroupSkeleton key={i} />
                        ))}
                    </div>
                ) : isGroupedView ? (
                    <div className={layoutContainerClass}>
                        {groupedFiles.map((group) => renderGroupedFileCard(group))}
                    </div>
                ) : (
                    <div className={layoutContainerClass}>
                        {files.map((file, index) => renderFileCard(file, index))}
                    </div>
                )}
            </div>
        </div>

        {/* Pagination */}
        {((layoutMode !== 'tree') || treeDirectoryId !== null) && (
            <FileBrowserPagination
                currentPage={currentPage}
                totalPages={totalPages}
                itemsPerPage={itemsPerPage}
                setItemsPerPage={setItemsPerPage}
                setCurrentPage={setCurrentPage}
                total={total}
                hideItemsPerPageOnMobile
            />
        )}

        <SubtitleEditorModal
            file={subtitleToEdit}
            isOpen={isSubtitleEditorOpen}
            onClose={() => { setIsSubtitleEditorOpen(false); setSubtitleToEdit(null); }}
        />
        <SceneViewerModal
            file={sceneViewerFile}
            isOpen={!!sceneViewerFile}
            onClose={() => setSceneViewerFile(null)}
        />
        {fileTasksTarget && (
            <FileTasksDialog
                file={fileTasksTarget}
                open={!!fileTasksTarget}
                onOpenChange={(o) => { if (!o) setFileTasksTarget(null) }}
            />
        )}
        <AlertDialog open={directoryDeleteTargetIds.length > 0} onOpenChange={(open) => { if (!open) setDirectoryDeleteTargetIds([]) }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete {directoryDeleteTargetIds.length} director{directoryDeleteTargetIds.length === 1 ? 'y' : 'ies'}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Choose where to delete the selected director{directoryDeleteTargetIds.length === 1 ? 'y' : 'ies'}. This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-3 py-2">
                    <label className="flex items-start gap-3 text-sm">
                        <Checkbox
                            checked={deleteDirectoriesFromDisk}
                            onCheckedChange={(checked) => setDeleteDirectoriesFromDisk(checked === true)}
                        />
                        <span className="leading-5">Delete directories on disk</span>
                    </label>
                    <label className="flex items-start gap-3 text-sm">
                        <Checkbox
                            checked={deleteDirectoriesFromDatabase}
                            onCheckedChange={(checked) => setDeleteDirectoriesFromDatabase(checked === true)}
                        />
                        <span className="leading-5">Delete records in database</span>
                    </label>
                </div>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={!deleteDirectoriesFromDisk && !deleteDirectoriesFromDatabase}
                        onClick={handleDeleteSelectedTreeDirectories}
                    >
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        <Dialog
            open={directoryRenameTargetId !== null}
            onOpenChange={(open) => {
                if (!open) {
                    setDirectoryRenameTargetId(null);
                    setDirectoryRenameValue('');
                }
            }}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Rename directory</DialogTitle>
                    <DialogDescription>
                        Update the selected folder name.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <Label htmlFor="directory-rename-input">Directory name</Label>
                    <Input
                        id="directory-rename-input"
                        value={directoryRenameValue}
                        onChange={(event) => setDirectoryRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void handleRenameSelectedTreeDirectory();
                            }
                        }}
                        placeholder="Enter directory name"
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => { setDirectoryRenameTargetId(null); setDirectoryRenameValue(''); }}>
                        Cancel
                    </Button>
                    <Button onClick={() => void handleRenameSelectedTreeDirectory()} disabled={!directoryRenameValue.trim()}>
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <Dialog
            open={directoryMoveTargetId !== null}
            onOpenChange={(open) => {
                if (!open) {
                    setDirectoryMoveTargetId(null);
                    setDirectoryMoveDestinationId('');
                }
            }}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Move directory</DialogTitle>
                    <DialogDescription>
                        Choose where to move this folder.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <Label htmlFor="directory-move-destination">Destination</Label>
                    <Select value={directoryMoveDestinationId} onValueChange={setDirectoryMoveDestinationId}>
                        <SelectTrigger id="directory-move-destination">
                            <SelectValue placeholder="Select a destination" />
                        </SelectTrigger>
                        <SelectContent>
                            {availableMoveDestinations.map((directory) => (
                                <SelectItem key={directory.id} value={directory.id}>
                                    {directory.path}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => { setDirectoryMoveTargetId(null); setDirectoryMoveDestinationId(''); }}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void handleMoveSelectedTreeDirectory()}
                        disabled={
                            !moveTargetDirectory
                            || !directoryMoveDestinationId
                            || directoryMoveDestinationId === moveTargetDirectory.parent_id
                        }
                    >
                        Move
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <Dialog
            open={fileMoveTargetId !== null}
            onOpenChange={(open) => {
                if (!open) {
                    setFileMoveTargetId(null);
                    setFileMoveDestinationId('');
                }
            }}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Move file</DialogTitle>
                    <DialogDescription>
                        Choose where to move {moveTargetFile ? `"${moveTargetFile.name}"` : 'this file'}.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <Label htmlFor="file-move-destination">Destination</Label>
                    <Select value={fileMoveDestinationId} onValueChange={setFileMoveDestinationId}>
                        <SelectTrigger id="file-move-destination">
                            <SelectValue placeholder="Select a destination" />
                        </SelectTrigger>
                        <SelectContent>
                            {availableFileMoveDestinations.map((directory) => (
                                <SelectItem key={directory.id} value={directory.id}>
                                    {directory.path}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => { setFileMoveTargetId(null); setFileMoveDestinationId(''); }}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void handleMoveSelectedFile()}
                        disabled={!moveTargetFile || !fileMoveDestinationId}
                    >
                        Move
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </>
}

export default FileBrowserTab
