import React from 'react';
import { X } from 'lucide-react';
import { Badge } from './ui/badge';
import { DirectoryRecord } from '@/types/types';
import { FileType, FileFormat, DateRange, FileStatus, FileResolution, FileSizeOperator, FileContentTag } from './FileFilterDialog';

interface FilterBadgesProps {
  appliedFilters: {
    type: FileType[];
    format: FileFormat[];
    dateRange: DateRange[];
    hasScenes: boolean;
    hasSplit: boolean;
    hasSubtitle: boolean;
    hasNoScenes: boolean;
    hasNoSplit: boolean;
    hasNoSubtitle: boolean;
    statusFilter: FileStatus[];
    queueDisabled: boolean;
    queueDisabledNo: boolean;
    splitDisabled: boolean;
    splitDisabledNo: boolean;
    subtitleDisabled: boolean;
    subtitleDisabledNo: boolean;
    noNumberSuffix: boolean;
    newVideos: boolean;
    contentTag: FileContentTag | null;
    resolutionFilter: FileResolution[];
    fileSizeOperator: FileSizeOperator;
    fileSizeValue: number | null;
    selectedDirectoryIds: string[];
    directoryExclude: boolean;
  };
  directories: DirectoryRecord[];
  onRemoveFilter: (filterType: string, value: string | number | boolean) => void;
}

interface BadgeItem {
  label: string;
  filterType: string;
  value: string | number | boolean;
}

export const FilterBadges: React.FC<FilterBadgesProps> = ({
  appliedFilters,
  directories,
  onRemoveFilter,
}) => {
  const generateBadges = (): BadgeItem[] => {
    const badges: BadgeItem[] = [];

    // Array filters - one badge per value
    appliedFilters.type.forEach(t =>
      badges.push({ label: t, filterType: 'type', value: t })
    );
    appliedFilters.format.forEach(f =>
      badges.push({ label: f, filterType: 'format', value: f })
    );
    appliedFilters.dateRange.forEach(d =>
      badges.push({ label: d, filterType: 'dateRange', value: d })
    );
    appliedFilters.statusFilter.forEach(s =>
      badges.push({ label: s, filterType: 'statusFilter', value: s })
    );
    appliedFilters.resolutionFilter.forEach(r =>
      badges.push({ label: r === '480p' ? '480p and below' : r === '4k' ? '4K' : r, filterType: 'resolutionFilter', value: r })
    );
    if (appliedFilters.fileSizeValue !== null) {
      const labelMap: Record<FileSizeOperator, string> = {
        gte: '>=',
        lte: '<=',
        eq: '=',
      };
      badges.push({
        label: `Size ${labelMap[appliedFilters.fileSizeOperator]} ${appliedFilters.fileSizeValue} MB`,
        filterType: 'fileSizeValue',
        value: appliedFilters.fileSizeValue,
      });
    }

    // Boolean filters - only if true
    if (appliedFilters.hasScenes) {
      badges.push({ label: 'Has Scenes', filterType: 'hasScenes', value: true });
    }
    if (appliedFilters.hasSplit) {
      badges.push({ label: 'Has Split', filterType: 'hasSplit', value: true });
    }
    if (appliedFilters.hasSubtitle) {
      badges.push({ label: 'Has Subtitle', filterType: 'hasSubtitle', value: true });
    }
    if (appliedFilters.hasNoScenes) {
      badges.push({ label: 'No Scenes', filterType: 'hasNoScenes', value: true });
    }
    if (appliedFilters.hasNoSplit) {
      badges.push({ label: 'No Split', filterType: 'hasNoSplit', value: true });
    }
    if (appliedFilters.hasNoSubtitle) {
      badges.push({ label: 'No Subtitle', filterType: 'hasNoSubtitle', value: true });
    }
    if (appliedFilters.queueDisabled) {
      badges.push({ label: 'Queue Disabled', filterType: 'queueDisabled', value: true });
    }
    if (appliedFilters.queueDisabledNo) {
      badges.push({ label: 'Queue Enabled', filterType: 'queueDisabledNo', value: true });
    }
    if (appliedFilters.splitDisabled) {
      badges.push({ label: 'Split Disabled', filterType: 'splitDisabled', value: true });
    }
    if (appliedFilters.splitDisabledNo) {
      badges.push({ label: 'Split Enabled', filterType: 'splitDisabledNo', value: true });
    }
    if (appliedFilters.subtitleDisabled) {
      badges.push({ label: 'Subtitle Disabled', filterType: 'subtitleDisabled', value: true });
    }
    if (appliedFilters.subtitleDisabledNo) {
      badges.push({ label: 'Subtitle Enabled', filterType: 'subtitleDisabledNo', value: true });
    }
    if (appliedFilters.noNumberSuffix) {
      badges.push({ label: 'No Number Suffix', filterType: 'noNumberSuffix', value: true });
    }
    if (appliedFilters.newVideos) {
      badges.push({ label: 'New', filterType: 'newVideos', value: true });
    }
    if (appliedFilters.contentTag) {
      const labelMap: Record<FileContentTag, string> = {
        censored: 'Censored',
        uncensored: 'Uncensored',
        subtitled: 'Subtitled',
      };
      badges.push({ label: labelMap[appliedFilters.contentTag], filterType: 'contentTag', value: appliedFilters.contentTag });
    }

    appliedFilters.selectedDirectoryIds.forEach(directoryId => {
      const dir = directories.find(d => d.id === directoryId);
      const dirLabel = dir?.name || directoryId;
      badges.push({
        label: appliedFilters.directoryExclude ? `Not in ${dirLabel}` : dirLabel,
        filterType: 'selectedDirectoryIds',
        value: directoryId,
      });
    });

    return badges;
  };

  const badges = generateBadges();

  // Return null if no badges to render
  if (badges.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-start gap-1.5 overflow-visible sm:flex-nowrap sm:justify-end sm:gap-2 sm:overflow-x-auto">
      {badges.map((badge, idx) => (
        <Badge key={`${badge.filterType}-${idx}`} variant="secondary" className="flex max-w-full items-center gap-1 whitespace-nowrap text-[10px] sm:text-xs">
          {badge.label}
          <button
            onClick={() => onRemoveFilter(badge.filterType, badge.value)}
            className="p-0.5 rounded hover:bg-muted transition-colors"
            aria-label={`Remove ${badge.label} filter`}
          >
            <X className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
};
