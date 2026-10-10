import React from 'react';
import { LayoutGrid, FolderOpen, RefreshCw } from 'lucide-react';

import { DirectoryRecord } from '@/types/types';
import { FileFilterState } from '@/lib/file-filters';
import { cn } from '@/lib/utils';

import { Button } from './ui/button';
import FileFilterDialog from './FileFilterDialog';
import FileSearch from './FileSearch';
import FileSorting, { type FileSortOption } from './FileSorting';

type FileLayoutMode = 'grid' | 'tree';

interface FileBrowserToolbarProps {
    layoutMode: FileLayoutMode;
    setLayoutMode: React.Dispatch<React.SetStateAction<FileLayoutMode>>;
    isRefreshing: boolean;
    onRefresh: () => Promise<void>;
    showTreeFilters: boolean;
    isTreeRootView: boolean;
    isFilterActive: boolean;
    handleResetFilters: () => void;
    isFilterDialogOpen: boolean;
    setIsFilterDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
    draftFilters: FileFilterState;
    setDraftFilters: React.Dispatch<React.SetStateAction<FileFilterState>>;
    draftIsGroupedView: boolean;
    setDraftIsGroupedView: React.Dispatch<React.SetStateAction<boolean>>;
    directories: DirectoryRecord[];
    draftSelectedDirectoryIds: string[];
    setDraftSelectedDirectoryIds: React.Dispatch<React.SetStateAction<string[]>>;
    handleApplyFilters: () => void;
    onOpenFilters: () => void;
    handleLoadPreset: (filters: FileFilterState) => void;
    handleSetDefaultPreset: (presetId: string | null) => Promise<void>;
    isSortDropdownOpen: boolean;
    setIsSortDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>;
    sortOption: FileSortOption;
    setSortOption: React.Dispatch<React.SetStateAction<FileSortOption>>;
    sortDirection: 'asc' | 'desc';
    setSortDirection: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>;
    treeSortOptions?: Array<{ value: FileSortOption; label: string }>;
    isGroupedView: boolean;
    fileSearchQuery: string;
    setFileSearchQuery: React.Dispatch<React.SetStateAction<string>>;
    searchFocused: boolean;
    setSearchFocused: React.Dispatch<React.SetStateAction<boolean>>;
    onTreeSearchSubmit: (query: string) => Promise<void>;
    onTreeSearchClear: () => void;
}

export function FileBrowserToolbar({
    layoutMode,
    setLayoutMode,
    isRefreshing,
    onRefresh,
    showTreeFilters,
    isTreeRootView,
    isFilterActive,
    handleResetFilters,
    isFilterDialogOpen,
    setIsFilterDialogOpen,
    draftFilters,
    setDraftFilters,
    draftIsGroupedView,
    setDraftIsGroupedView,
    directories,
    draftSelectedDirectoryIds,
    setDraftSelectedDirectoryIds,
    handleApplyFilters,
    onOpenFilters,
    handleLoadPreset,
    handleSetDefaultPreset,
    isSortDropdownOpen,
    setIsSortDropdownOpen,
    sortOption,
    setSortOption,
    sortDirection,
    setSortDirection,
    treeSortOptions,
    isGroupedView,
    fileSearchQuery,
    setFileSearchQuery,
    searchFocused,
    setSearchFocused,
    onTreeSearchSubmit,
    onTreeSearchClear,
}: FileBrowserToolbarProps) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-row flex-wrap items-start justify-between gap-2 sm:flex-nowrap sm:items-center sm:gap-3">
                <div className="flex gap-2 sm:gap-4">
                    <div className="inline-flex h-8 items-center gap-1 rounded-md bg-muted p-0.5 sm:h-[40px] sm:gap-2 sm:rounded-lg sm:p-1">
                        <Button
                            variant={layoutMode === 'grid' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setLayoutMode('grid')}
                            className="h-7 w-7 rounded-sm p-0 sm:h-8 sm:w-auto sm:rounded-md sm:px-3"
                            aria-label="Grid view"
                        >
                            <LayoutGrid className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                        <Button
                            variant={layoutMode === 'tree' ? 'default' : 'ghost'}
                            size="sm"
                            onClick={() => setLayoutMode('tree')}
                            className="h-7 w-7 rounded-sm p-0 sm:h-8 sm:w-auto sm:rounded-md sm:px-3"
                            aria-label="Folder or directory structure view"
                        >
                            <FolderOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                        </Button>
                    </div>
                </div>

                <div className="contents sm:flex sm:min-w-0 sm:flex-1 sm:items-center sm:justify-end sm:gap-2">
                    <div className="grid min-w-0 grid-cols-[auto_auto_auto] gap-1.5 sm:flex sm:w-auto sm:flex-none sm:items-center sm:justify-end sm:gap-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 sm:h-10 sm:w-10"
                            title="Refresh"
                            aria-label="Refresh files"
                            onClick={() => void onRefresh()}
                        >
                            <RefreshCw className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4', isRefreshing && 'animate-spin')} aria-hidden />
                        </Button>

                        {showTreeFilters && !isTreeRootView && (
                            <FileFilterDialog
                                isFilterActive={isFilterActive}
                                handleResetFilters={handleResetFilters}
                                isFilterDialogOpen={isFilterDialogOpen}
                                setIsFilterDialogOpen={setIsFilterDialogOpen}
                                fileTypeFilter={draftFilters.type}
                                setFileTypeFilter={(v) => setDraftFilters((prev) => ({ ...prev, type: v }))}
                                fileFormatFilter={draftFilters.format}
                                setFileFormatFilter={(v) => setDraftFilters((prev) => ({ ...prev, format: v }))}
                                dateRangeFilter={draftFilters.dateRange}
                                setDateRangeFilter={(v) => setDraftFilters((prev) => ({ ...prev, dateRange: v }))}
                                handleApplyFilters={handleApplyFilters}
                                isGroupedView={draftIsGroupedView}
                                setIsGroupedView={setDraftIsGroupedView}
                                directories={directories}
                                selectedDirectoryIds={draftSelectedDirectoryIds}
                                setSelectedDirectoryIds={setDraftSelectedDirectoryIds}
                                directoryExclude={draftFilters.directoryExclude}
                                setDirectoryExclude={(v) => setDraftFilters((prev) => ({ ...prev, directoryExclude: v }))}
                                hasScenes={draftFilters.hasScenes}
                                setHasScenes={(v) => setDraftFilters((prev) => ({ ...prev, hasScenes: v }))}
                                hasSplit={draftFilters.hasSplit}
                                setHasSplit={(v) => setDraftFilters((prev) => ({ ...prev, hasSplit: v }))}
                                hasSubtitle={draftFilters.hasSubtitle}
                                setHasSubtitle={(v) => setDraftFilters((prev) => ({ ...prev, hasSubtitle: v }))}
                                hasNoScenes={draftFilters.hasNoScenes}
                                setHasNoScenes={(v) => setDraftFilters((prev) => ({ ...prev, hasNoScenes: v }))}
                                hasNoSplit={draftFilters.hasNoSplit}
                                setHasNoSplit={(v) => setDraftFilters((prev) => ({ ...prev, hasNoSplit: v }))}
                                hasNoSubtitle={draftFilters.hasNoSubtitle}
                                setHasNoSubtitle={(v) => setDraftFilters((prev) => ({ ...prev, hasNoSubtitle: v }))}
                                statusFilter={draftFilters.statusFilter}
                                setStatusFilter={(v) => setDraftFilters((prev) => ({ ...prev, statusFilter: v }))}
                                queueDisabled={draftFilters.queueDisabled}
                                setQueueDisabled={(v) => setDraftFilters((prev) => ({ ...prev, queueDisabled: v }))}
                                queueDisabledNo={draftFilters.queueDisabledNo}
                                setQueueDisabledNo={(v) => setDraftFilters((prev) => ({ ...prev, queueDisabledNo: v }))}
                                splitDisabled={draftFilters.splitDisabled}
                                setSplitDisabled={(v) => setDraftFilters((prev) => ({ ...prev, splitDisabled: v }))}
                                splitDisabledNo={draftFilters.splitDisabledNo}
                                setSplitDisabledNo={(v) => setDraftFilters((prev) => ({ ...prev, splitDisabledNo: v }))}
                                subtitleDisabled={draftFilters.subtitleDisabled}
                                setSubtitleDisabled={(v) => setDraftFilters((prev) => ({ ...prev, subtitleDisabled: v }))}
                                subtitleDisabledNo={draftFilters.subtitleDisabledNo}
                                setSubtitleDisabledNo={(v) => setDraftFilters((prev) => ({ ...prev, subtitleDisabledNo: v }))}
                                noNumberSuffix={draftFilters.noNumberSuffix}
                                setNoNumberSuffix={(v) => setDraftFilters((prev) => ({ ...prev, noNumberSuffix: v }))}
                                newVideos={draftFilters.newVideos}
                                setNewVideos={(v) => setDraftFilters((prev) => ({ ...prev, newVideos: v }))}
                                contentTag={draftFilters.contentTag}
                                setContentTag={(v) => setDraftFilters((prev) => ({ ...prev, contentTag: v }))}
                                resolutionFilter={draftFilters.resolutionFilter}
                                setResolutionFilter={(v) => setDraftFilters((prev) => ({ ...prev, resolutionFilter: v }))}
                                fileSizeOperator={draftFilters.fileSizeOperator}
                                setFileSizeOperator={(v) => setDraftFilters((prev) => ({ ...prev, fileSizeOperator: v }))}
                                fileSizeValue={draftFilters.fileSizeValue}
                                setFileSizeValue={(v) => setDraftFilters((prev) => ({ ...prev, fileSizeValue: v }))}
                                onOpen={onOpenFilters}
                                onLoadPreset={handleLoadPreset}
                                onSetDefaultPreset={handleSetDefaultPreset}
                            />
                        )}

                        <div className="min-w-0">
                            <FileSorting
                                isSortDropdownOpen={isSortDropdownOpen}
                                setIsSortDropdownOpen={setIsSortDropdownOpen}
                                sortOption={sortOption}
                                setSortOption={setSortOption}
                                sortDirection={sortDirection}
                                setSortDirection={setSortDirection}
                                options={treeSortOptions}
                            />
                        </div>

                    </div>

                    <div className="w-full min-w-0 sm:w-auto">
                        <FileSearch
                            fileSearchQuery={fileSearchQuery}
                            setFileSearchQuery={setFileSearchQuery}
                            searchFocused={searchFocused}
                            setSearchFocused={setSearchFocused}
                            onSubmitQuery={onTreeSearchSubmit}
                            onClearQuery={onTreeSearchClear}
                            liveSearchEnabled={layoutMode !== 'tree'}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
