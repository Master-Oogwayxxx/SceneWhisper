import { Search, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { Input } from './ui/input'

interface LogSearchProps {
  searchText: string
  setSearchText: (text: string) => void
  onSearchChange: (text: string) => void
  taskIdFilter: string
  setTaskIdFilter: (id: string) => void
}

const LogSearch: React.FC<LogSearchProps> = ({
  searchText,
  setSearchText,
  onSearchChange,
  taskIdFilter,
  setTaskIdFilter,
}) => {
  const [searchDraft, setSearchDraft] = useState(searchText)
  const [taskIdDraft, setTaskIdDraft] = useState(taskIdFilter)

  useEffect(() => {
    setSearchDraft(searchText)
  }, [searchText])

  useEffect(() => {
    setTaskIdDraft(taskIdFilter)
  }, [taskIdFilter])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchText(searchDraft)
    onSearchChange(searchDraft)
  }

  const handleTaskIdSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setTaskIdFilter(taskIdDraft)
  }

  const handleClearSearch = () => {
    setSearchDraft('')
    setSearchText('')
    onSearchChange('')
  }

  const handleClearTaskId = () => {
    setTaskIdDraft('')
    setTaskIdFilter('')
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-white font-medium">Search:</span>
        <form onSubmit={handleSearchSubmit} className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="text"
            placeholder="Search messages…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="h-9 pl-9 pr-9 w-80"
            aria-label="Search logs"
          />
          {searchDraft && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground focus:outline-none"
              aria-label="Clear search"
            >
              <X className="h-full w-full" />
            </button>
          )}
        </form>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-white font-medium">Task ID:</span>
        <form onSubmit={handleTaskIdSubmit} className="relative">
          <Input
            type="text"
            placeholder="UUID"
            value={taskIdDraft}
            onChange={(e) => setTaskIdDraft(e.target.value)}
            className="h-9 w-[350px] pr-9"
            aria-label="Filter by task ID"
          />
          {taskIdDraft && (
            <button
              type="button"
              onClick={handleClearTaskId}
              className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground hover:text-foreground focus:outline-none"
              aria-label="Clear task ID filter"
            >
              <X className="h-full w-full" />
            </button>
          )}
        </form>
      </div>
    </div>
  )
}

export default LogSearch
