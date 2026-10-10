import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from './ui/button';
import { Calendar, Clock3, FileText, FolderOpen, SortAsc } from 'lucide-react';

export type FileSortOption = 'size' | 'name' | 'folder_name' | 'created_at' | 'modified_at' | 'duration' | 'file_count'

type SortChoice = {
    value: FileSortOption
    label: string
}

interface FileSortingProps {
    isSortDropdownOpen: boolean
    setIsSortDropdownOpen: (open: boolean) => void
    sortOption: FileSortOption
    setSortOption: React.Dispatch<React.SetStateAction<FileSortOption>>
    sortDirection: 'asc' | 'desc'
    setSortDirection: (direction: 'asc' | 'desc') => void
    options?: SortChoice[]
}

const defaultOptions: SortChoice[] = [
    { value: 'name', label: 'Name' },
    { value: 'folder_name', label: 'Folder Name' },
    { value: 'size', label: 'Size' },
    { value: 'created_at', label: 'Date Created At' },
    { value: 'modified_at', label: 'Date Modified At' },
    { value: 'duration', label: 'Duration' },
]

const FileSorting: React.FC<FileSortingProps> = ({ isSortDropdownOpen, setIsSortDropdownOpen, sortOption, setSortOption, sortDirection, setSortDirection, options = defaultOptions }) => {
    const selectedOption = options.find((option) => option.value === sortOption) ?? options[0]
    const renderSortIcon = () => {
        if (sortOption === 'name') {
            return <SortAsc className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        }
        if (sortOption === 'size') {
            return <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        }
        if (sortOption === 'duration') {
            return <Clock3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        }
        if (sortOption === 'folder_name' || sortOption === 'file_count') {
            return <FolderOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        }
        return <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
    }

    return (
        <div className="inline-flex rounded-md shadow-sm">
            <DropdownMenu open={isSortDropdownOpen} onOpenChange={setIsSortDropdownOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        className="h-8 gap-1 rounded-r-none border-r-0 px-2 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 sm:h-10 sm:gap-2 sm:px-4 sm:text-sm"
                    >
                        {renderSortIcon()}
                        <span className="max-w-[4.5rem] truncate sm:max-w-none">{selectedOption?.label ?? 'Sort'}</span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                    {options.map((option) => (
                        <DropdownMenuItem key={option.value} className='cursor-pointer' onClick={() => {
                            setSortOption(option.value);
                            setIsSortDropdownOpen(false);
                        }}>
                            {option.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <Button
                variant="outline"
                onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                className="h-8 gap-1 rounded-l-none border-l-0 px-2 text-xs sm:h-10 sm:gap-2 sm:px-4 sm:text-sm"
            >
                {sortDirection === 'asc' ? (
                    <>
                        <span>↑</span>
                        <span>Asc</span>
                    </>
                ) : (
                    <>
                        <span>↓</span>
                        <span>Desc</span>
                    </>
                )}
            </Button>
        </div>
    )
}

export default FileSorting
