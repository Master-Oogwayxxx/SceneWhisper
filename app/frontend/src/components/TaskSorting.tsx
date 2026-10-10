import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from './ui/button';
import { SortAsc } from 'lucide-react';

export type TaskSortField =
  | 'name'
  | 'createdAt'
  | 'startedAt'
  | 'completedAt'
  | 'pausedAt'
  | 'elapsedSeconds'
  | 'status'
  | 'type'

interface TaskSortingProps {
  isSortDropdownOpen: boolean
  setIsSortDropdownOpen: (open: boolean) => void
  sortField: TaskSortField
  setSortField: React.Dispatch<React.SetStateAction<TaskSortField>>
  sortDirection: 'asc' | 'desc'
  setSortDirection: (direction: 'asc' | 'desc') => void
}

const SORT_OPTIONS: { value: TaskSortField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'createdAt', label: 'Created At' },
  { value: 'startedAt', label: 'Started At' },
  { value: 'completedAt', label: 'Completed At' },
  { value: 'pausedAt', label: 'Paused At' },
  { value: 'elapsedSeconds', label: 'Duration' },
  { value: 'status', label: 'Status' },
  { value: 'type', label: 'Type' },
]


const TaskSorting: React.FC<TaskSortingProps> = ({
  isSortDropdownOpen,
  setIsSortDropdownOpen,
  sortField,
  setSortField,
  sortDirection,
  setSortDirection,
}) => {
  return (
    <div className="inline-flex rounded-md shadow-sm shrink-0">
      <DropdownMenu open={isSortDropdownOpen} onOpenChange={setIsSortDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-r-none border-r-0 px-2 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 sm:h-[40px] sm:px-3 sm:text-sm"
          >
            <SortAsc className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            {SORT_OPTIONS.find((o) => o.value === sortField)?.label}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {SORT_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.value}
              className="cursor-pointer"
              onClick={() => {
                setSortField(opt.value)
                setIsSortDropdownOpen(false)
              }}
            >
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
        className="h-8 rounded-l-none border-l-0 px-2 text-xs sm:h-[40px] sm:px-3 sm:text-sm"
      >
        {sortDirection === 'asc' ? (
          <>
            <span>↑</span>
            <span className="hidden sm:inline">Asc</span>
          </>
        ) : (
          <>
            <span>↓</span>
            <span className="hidden sm:inline">Desc</span>
          </>
        )}
      </Button>
    </div>
  )
}

export default TaskSorting
