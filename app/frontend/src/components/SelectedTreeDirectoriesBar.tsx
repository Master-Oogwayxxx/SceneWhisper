import React from 'react';

import { DirectoryRecord } from '@/types/types';

import { Button } from './ui/button';

interface SelectedTreeDirectoriesBarProps {
    selectedTreeDirectoryIds: string[];
    treeChildDirectories: DirectoryRecord[];
    singleSelectedTreeDirectory: DirectoryRecord | null;
    setSelectedTreeDirectoryIds: React.Dispatch<React.SetStateAction<string[]>>;
    openDirectoryMoveDialog: (directoryId: string) => void;
    openDirectoryRenameDialog: (directoryId: string) => void;
    setDirectoryDeleteTargetIds: React.Dispatch<React.SetStateAction<string[]>>;
}

export function SelectedTreeDirectoriesBar({
    selectedTreeDirectoryIds,
    treeChildDirectories,
    singleSelectedTreeDirectory,
    setSelectedTreeDirectoryIds,
    openDirectoryMoveDialog,
    openDirectoryRenameDialog,
    setDirectoryDeleteTargetIds,
}: SelectedTreeDirectoriesBarProps) {
    if (selectedTreeDirectoryIds.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-md border border-border/60 bg-muted/45 px-2 py-2">
            <span className="mr-auto shrink-0 text-sm text-muted-foreground">
                {selectedTreeDirectoryIds.length} director{selectedTreeDirectoryIds.length === 1 ? 'y' : 'ies'} selected
            </span>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedTreeDirectoryIds(treeChildDirectories.map((directory) => directory.id))}
                disabled={treeChildDirectories.length === 0 || selectedTreeDirectoryIds.length === treeChildDirectories.length}
            >
                Select All
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedTreeDirectoryIds([])}
            >
                Deselect All
            </Button>
            <Button
                variant="outline"
                size="sm"
                disabled={!singleSelectedTreeDirectory}
                onClick={() => singleSelectedTreeDirectory && openDirectoryMoveDialog(singleSelectedTreeDirectory.id)}
            >
                Move
            </Button>
            <Button
                variant="outline"
                size="sm"
                disabled={!singleSelectedTreeDirectory}
                onClick={() => singleSelectedTreeDirectory && openDirectoryRenameDialog(singleSelectedTreeDirectory.id)}
            >
                Rename
            </Button>
            <Button
                variant="destructive"
                size="sm"
                onClick={() => setDirectoryDeleteTargetIds([...selectedTreeDirectoryIds])}
            >
                Delete
            </Button>
        </div>
    );
}
