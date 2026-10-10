import { Search } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { Input } from './ui/input'

interface FileSearchProps {
    fileSearchQuery: string
    setFileSearchQuery: React.Dispatch<React.SetStateAction<string>>
    searchFocused: boolean
    setSearchFocused: (focused: boolean) => void
    onSubmitQuery?: (query: string) => void | Promise<void>
    onClearQuery?: () => void | Promise<void>
    liveSearchEnabled?: boolean
}

const FileSearch: React.FC<FileSearchProps> = ({ fileSearchQuery, setFileSearchQuery, searchFocused, setSearchFocused, onSubmitQuery, onClearQuery, liveSearchEnabled = true }) => {
    const [draft, setDraft] = useState(fileSearchQuery)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        setDraft(fileSearchQuery)
    }, [fileSearchQuery])

    useEffect(() => {
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value
        setDraft(value)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        if (!liveSearchEnabled) return
        debounceRef.current = setTimeout(() => setFileSearchQuery(value), 350)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (debounceRef.current) clearTimeout(debounceRef.current)
        setFileSearchQuery(draft)
        await onSubmitQuery?.(draft)
    }

    const handleClear = async () => {
        setDraft('')
        if (debounceRef.current) clearTimeout(debounceRef.current)
        setFileSearchQuery('')
        await onClearQuery?.()
    }

    return (
        <form onSubmit={handleSubmit} className="relative w-full min-w-0 sm:w-[min(100%,34ch)]">
            <Search
                className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground sm:left-3 sm:h-4 sm:w-4"
                aria-hidden
            />
            <Input
                className="h-8 w-full px-2 pl-8 pr-7 text-xs sm:h-10 sm:pl-9 sm:pr-9 sm:text-sm"
                placeholder="Search files..."
                value={draft}
                onChange={handleChange}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => {
                    window.setTimeout(() => setSearchFocused(false), 180);
                }}
                aria-label="Search files"
                aria-autocomplete="list"
                aria-expanded={searchFocused && Boolean(draft.trim())}
                autoComplete="off"
            />
            {draft && (
                <button
                    type="button"
                    onClick={handleClear}
                    className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none sm:right-3 sm:h-4 sm:w-4"
                    aria-label="Clear search"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-full w-full">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            )}
        </form>
    )
}

export default FileSearch
