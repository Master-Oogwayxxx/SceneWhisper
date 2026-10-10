import { Filter, ChevronsUpDown, Calendar, Layers, Languages, ScanSearch, FolderOpen } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Checkbox } from './ui/checkbox'
import { useState } from 'react'
import type { DirectoryRecord } from '@/types/types'

export type TaskTypeFilter = 'scene' | 'split' | 'subtitle' | 'all' | 'merge' | 'analyze_frame_pacing' | 'nvenc_frame_pacing' | 'remux'
export type TaskDateRange = 'today' | 'last_7_days' | 'last_30_days' | 'last_year'
export type TaskFilters = {
  taskType: TaskTypeFilter[]
  dateRange: TaskDateRange[]
  subtitleLanguage: string[]
  sceneDetector: string[]
  selectedDirectoryIds: string[]
  directoryExclude: boolean
}

export const EMPTY_TASK_FILTERS: TaskFilters = {
  taskType: [],
  dateRange: [],
  subtitleLanguage: [],
  sceneDetector: [],
  selectedDirectoryIds: [],
  directoryExclude: false,
}

interface TaskFilterDialogProps {
  isFilterActive: boolean
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  taskTypeFilter: TaskTypeFilter[]
  setTaskTypeFilter: (v: TaskTypeFilter[]) => void
  dateRangeFilter: TaskDateRange[]
  setDateRangeFilter: (v: TaskDateRange[]) => void
  subtitleLanguageFilter: string[]
  setSubtitleLanguageFilter: (v: string[]) => void
  sceneDetectorFilter: string[]
  setSceneDetectorFilter: (v: string[]) => void
  taskDirectoryIds: string[]
  setTaskDirectoryIds: (v: string[]) => void
  directoryExclude: boolean
  setDirectoryExclude: (v: boolean) => void
  availableLanguages: string[]
  availableDetectors: string[]
  directories: DirectoryRecord[]
  onApply: () => void
  onReset: () => void
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
        <Button variant='outline' className='w-full justify-between font-normal h-9'>
          <span className='truncate text-sm'>{displayLabel}</span>
          <ChevronsUpDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='p-1 w-[var(--radix-popover-trigger-width)]' align='start'>
        {options.map(opt => (
          <div
            key={opt.value}
            className='flex items-center gap-2 px-2 py-2 rounded-sm cursor-pointer hover:bg-accent select-none'
            onClick={() => toggle(opt.value)}
          >
            <Checkbox checked={values.includes(opt.value)} onCheckedChange={() => toggle(opt.value)} />
            <span className='text-sm'>{opt.label}</span>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

const TASK_TYPE_OPTIONS: { value: TaskTypeFilter; label: string }[] = [
  { value: 'scene', label: 'Scene Detection' },
  { value: 'split', label: 'Video Split' },
  { value: 'subtitle', label: 'Subtitle Generation' },
  { value: 'all', label: 'All Processing' },
  { value: 'merge', label: 'Merge' },
  { value: 'analyze_frame_pacing', label: 'Analyze + Frame Pacing Repair' },
  { value: 'nvenc_frame_pacing', label: 'Frame Pacing Repair' },
  { value: 'remux', label: 'Remux' },
]

const DATE_RANGE_OPTIONS: { value: TaskDateRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_year', label: 'Last year' },
]

export function TaskFilterDialog({
  isFilterActive,
  isOpen,
  setIsOpen,
  taskTypeFilter,
  setTaskTypeFilter,
  dateRangeFilter,
  setDateRangeFilter,
  subtitleLanguageFilter,
  setSubtitleLanguageFilter,
  sceneDetectorFilter,
  setSceneDetectorFilter,
  taskDirectoryIds,
  setTaskDirectoryIds,
  directoryExclude,
  setDirectoryExclude,
  availableLanguages,
  availableDetectors,
  directories,
  onApply,
  onReset,
}: TaskFilterDialogProps) {
  const [isDirectoryModalOpen, setIsDirectoryModalOpen] = useState(false)

  const handleResetClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onReset()
  }

  const languageOptions = availableLanguages.map(l => ({ value: l, label: l }))
  const detectorOptions = availableDetectors.map(d => ({ value: d, label: d }))
  const selectableDirectories = directories.filter(d => {
    if (d.parent_id === null) return false
    const parent = directories.find(p => p.id === d.parent_id)
    return parent?.parent_id === null
  })

  const handleDirectoryToggle = (id: string) => {
    setTaskDirectoryIds(
      taskDirectoryIds.includes(id)
        ? taskDirectoryIds.filter(selectedId => selectedId !== id)
        : [...taskDirectoryIds, id]
    )
  }

  const handleDirectoryClear = () => {
    setTaskDirectoryIds([])
    setDirectoryExclude(false)
  }

  const selectedDirectoryLabel =
    taskDirectoryIds.length === 0
      ? 'All directories'
      : taskDirectoryIds.length === 1
        ? `${directoryExclude ? 'Not in ' : ''}${directories.find(d => d.id === taskDirectoryIds[0])?.name || 'Select directory'}`
        : `${directoryExclude ? 'Excluding' : 'Including'} ${taskDirectoryIds.length} directories`

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <div className='relative shrink-0'>
        <DialogTrigger asChild>
          <Button
            variant={isFilterActive ? 'default' : 'outline'}
            className='h-8 gap-1.5 px-2 text-xs sm:h-10 sm:px-3 sm:text-sm'
            aria-label='Filter tasks'
          >
            <Filter className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
            <span className='hidden sm:inline'>Filter</span>
          </Button>
        </DialogTrigger>
        {isFilterActive && (
          <button
            type='button'
            aria-label='Clear task filters'
            className='absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-background bg-primary-foreground text-primary shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1'
            onClick={handleResetClick}
          >
            ×
          </button>
        )}
      </div>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>Filter Tasks</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <Label className='text-sm font-medium flex items-center gap-2'>
              <Layers className='w-3.5 h-3.5' />Task type
            </Label>
            <MultiSelect
              options={TASK_TYPE_OPTIONS}
              values={taskTypeFilter}
              onChange={setTaskTypeFilter}
              placeholder='All types'
            />
          </div>

          <div className='flex flex-col gap-2'>
            <Label className='text-sm font-medium flex items-center gap-2'>
              <Calendar className='w-3.5 h-3.5' />Date created
            </Label>
            <MultiSelect
              options={DATE_RANGE_OPTIONS}
              values={dateRangeFilter}
              onChange={setDateRangeFilter}
              placeholder='All time'
            />
          </div>

          {languageOptions.length > 0 && (
            <div className='flex flex-col gap-2'>
              <Label className='text-sm font-medium flex items-center gap-2'>
                <Languages className='w-3.5 h-3.5' />Subtitle language
              </Label>
              <MultiSelect
                options={languageOptions}
                values={subtitleLanguageFilter}
                onChange={setSubtitleLanguageFilter}
                placeholder='All languages'
              />
            </div>
          )}

          {detectorOptions.length > 0 && (
            <div className='flex flex-col gap-2'>
              <Label className='text-sm font-medium flex items-center gap-2'>
                <ScanSearch className='w-3.5 h-3.5' />Scene detector
              </Label>
              <MultiSelect
                options={detectorOptions}
                values={sceneDetectorFilter}
                onChange={setSceneDetectorFilter}
                placeholder='All detectors'
              />
            </div>
          )}

          {selectableDirectories.length > 0 && (
            <div className='flex flex-col gap-2'>
              <Label className='text-sm font-medium flex items-center gap-2'>
                <FolderOpen className='w-3.5 h-3.5' />Directory
              </Label>
              <Dialog open={isDirectoryModalOpen} onOpenChange={setIsDirectoryModalOpen}>
                <DialogTrigger asChild>
                  <Button variant='outline' className='w-full justify-start font-normal h-9 text-sm'>
                    <span className='truncate'>{selectedDirectoryLabel}</span>
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Select Directory</DialogTitle>
                  </DialogHeader>
                  <div className='max-h-[60vh] overflow-y-auto scrollbar pr-4'>
                    <div className='flex rounded-md border overflow-hidden text-xs mb-3'>
                      <button
                        type='button'
                        onClick={() => setDirectoryExclude(false)}
                        className={`flex-1 py-1.5 transition-colors ${!directoryExclude ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                      >
                        Include
                      </button>
                      <button
                        type='button'
                        onClick={() => setDirectoryExclude(true)}
                        className={`flex-1 py-1.5 border-l transition-colors ${directoryExclude ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
                      >
                        Exclude
                      </button>
                    </div>
                    <div className='flex items-center gap-3 p-2 rounded cursor-pointer' onClick={handleDirectoryClear}>
                      <Checkbox
                        id='task-dir-all'
                        checked={taskDirectoryIds.length === 0}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={handleDirectoryClear}
                      />
                      <Label htmlFor='task-dir-all' className='flex-1 cursor-pointer'>All</Label>
                    </div>
                    {selectableDirectories.map(d => (
                      <div key={d.id} className='flex items-center gap-3 p-2 rounded cursor-pointer' onClick={() => handleDirectoryToggle(d.id)}>
                        <Checkbox
                          id={`task-dir-${d.id}`}
                          checked={taskDirectoryIds.includes(d.id)}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={() => handleDirectoryToggle(d.id)}
                        />
                        <div className='min-w-0 flex-1'>
                          <Label htmlFor={`task-dir-${d.id}`} className='cursor-pointer block truncate text-sm'>{d.name}</Label>
                        </div>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        <div className='flex justify-between items-center pt-4'>
          <Button variant='outline' onClick={handleResetClick} size='sm'>
            Reset
          </Button>
          <div className='flex gap-2'>
            <Button variant='outline' onClick={() => setIsOpen(false)} size='sm'>
              Cancel
            </Button>
            <Button onClick={onApply} size='sm' className='bg-primary hover:bg-primary/90'>
              Apply Filters
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
