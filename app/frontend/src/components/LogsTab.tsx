import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Bug, ChevronDown, ChevronRight, Info, TriangleAlert, Wifi, WifiOff, ChevronFirst, ChevronLast, ChevronLeft } from 'lucide-react'
import { logApi } from '@/api/logs'
import type { LogEntry, LogQueryParams } from '@/types/types'
import { copyTextToClipboard } from '@/lib/utils'
import LogSearch from './LogSearch'

function SkeletonLogRow() {
  return (
    <div className="border-b border-gray-100 last:border-0">
      <div className="flex flex-wrap items-start gap-2 px-2 py-2 text-sm sm:flex-nowrap sm:px-3 sm:py-1.5">
        <div className="shrink-0 pt-0.5 font-mono text-xs text-gray-300 sm:w-28">
          <div className="h-4 bg-gray-200 rounded animate-pulse w-full" />
        </div>
        <div className="h-5 bg-gray-200 rounded animate-pulse w-16 shrink-0" />
        <div className="h-4 bg-gray-200 rounded animate-pulse w-20 shrink-0 sm:w-24" />
        <div className="h-4 bg-gray-200 rounded animate-pulse basis-full sm:flex-1 sm:basis-auto" />
      </div>
    </div>
  )
}

const LEVEL_STYLES: Record<string, string> = {
  DEBUG: 'bg-gray-50 text-gray-700',
  INFO: 'bg-blue-100 text-blue-700',
  WARNING: 'bg-amber-100 text-amber-700',
  ERROR: 'bg-red-100 text-red-700',
  CRITICAL: 'bg-red-200 text-red-900 font-bold',
}

const LEVEL_ICONS: Record<string, React.ReactNode> = {
  DEBUG: <Bug size={12} />,
  INFO: <Info size={12} />,
  WARNING: <TriangleAlert size={12} />,
  ERROR: <AlertCircle size={12} />,
  CRITICAL: <AlertCircle size={12} />,
}

function LevelBadge({ level }: { level: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono ${LEVEL_STYLES[level] ?? 'bg-gray-100 text-gray-300'}`}>
      {LEVEL_ICONS[level]}
      {level}
    </span>
  )
}

function LogRow({ entry, onFilterByTask }: { entry: LogEntry; onFilterByTask: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const raw = entry.created_at ?? ''
  const iso = raw.includes('T') || raw.endsWith('Z') ? raw : raw.replace(' ', 'T') + 'Z'
  const date = new Date(iso)
  const time = isNaN(date.getTime())
    ? raw
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const text = `[${time}] ${entry.level} ${entry.logger_name}: ${entry.message}`
    copyTextToClipboard(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch((err) => {
      console.error('Failed to copy log entry:', err)
    })
  }

  return (
    <div className="border-b border-gray-100 last:border-0">
      <div className="flex flex-wrap items-start gap-2 px-2 py-2 hover:bg-primary/50 text-sm cursor-pointer select-none transition sm:flex-nowrap sm:px-3 sm:py-1.5" onClick={handleCopy} title={copied ? 'Copied!' : 'Click to copy'}>
        <span className="shrink-0 pt-0.5 font-mono text-xs text-gray-300 sm:w-28">{time}</span>
        <LevelBadge level={entry.level} />
        <span className="max-w-[9rem] shrink-0 truncate pt-0.5 text-xs text-gray-300 sm:max-w-[120px]" title={entry.logger_name}>
          {entry.logger_name}
        </span>
        <span className="basis-full break-all font-mono text-white sm:flex-1 sm:basis-auto">{entry.message}</span>
        {entry.task_id != null && (
          <button
            onClick={(e) => { e.stopPropagation(); onFilterByTask(entry.task_id!) }}
            className="shrink-0 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-xs hover:bg-indigo-100"
          >
            #{entry.task_id}
          </button>
        )}
        {entry.exc_text && (
          <button onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }} className="shrink-0 text-gray-300 hover:text-gray-300">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        {copied && (
          <span className="shrink-0 text-xs text-green-600 font-medium">Copied!</span>
        )}
      </div>
      {expanded && entry.exc_text && (
        <pre className="mx-2 mb-2 overflow-x-auto rounded bg-red-50 p-2 text-xs text-red-800 sm:mx-3">{entry.exc_text}</pre>
      )}
    </div>
  )
}

const LEVELS = ['ALL', 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
const PAGE_SIZE = 100

const LEVEL_BUTTON_COLORS: Record<string, { unselected: string; selected: string }> = {
  ALL: { unselected: 'bg-gray-100 text-gray-600 hover:bg-gray-200', selected: 'bg-gray-400 text-white' },
  DEBUG: { unselected: 'bg-gray-100 text-gray-700 hover:bg-gray-200', selected: 'bg-gray-700 text-white' },
  INFO: { unselected: 'bg-blue-50 text-blue-600 hover:bg-blue-100', selected: 'bg-blue-600 text-white' },
  WARNING: { unselected: 'bg-amber-50 text-amber-600 hover:bg-amber-100', selected: 'bg-amber-600 text-white' },
  ERROR: { unselected: 'bg-red-50 text-red-600 hover:bg-red-100', selected: 'bg-red-600 text-white' },
  CRITICAL: { unselected: 'bg-red-100 text-red-700 hover:bg-red-200', selected: 'bg-red-900 text-white' },
}

export function LogsTab() {
  const [mode, setMode] = useState<'live' | 'history'>('live')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const [filters, setFilters] = useState<LogQueryParams>({ limit: PAGE_SIZE, skip: 0 })
  const [total, setTotal] = useState(0)
  const [levelFilter, setLevelFilter] = useState('ALL')
  const [searchText, setSearchText] = useState('')
  const [taskIdFilter, setTaskIdFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  // Live mode: connect SSE
  useEffect(() => {
    if (mode !== 'live') return

    const es = logApi.createLogStream()
    esRef.current = es
    setConnected(false)
    setEntries([])
    setLoading(true)

    es.onopen = () => {
      setConnected(true)
      setLoading(false)
    }
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => {
      const entry: LogEntry = JSON.parse(e.data)
      setEntries(prev => {
        const next = [entry, ...prev]
        return next.length > 500 ? next.slice(0, 500) : next
      })
    }

    return () => {
      es.close()
      esRef.current = null
      setConnected(false)
    }
  }, [mode])

  // History mode: fetch on filter change
  const fetchHistory = useCallback(async (params: LogQueryParams) => {
    try {
      setLoading(true)
      const data = await logApi.getLogs(params)
      setEntries(data.items)
      setTotal(data.total)
    } catch (err) {
      console.error('Failed to fetch logs:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mode !== 'history') return
    const params: LogQueryParams = {
      limit: PAGE_SIZE,
      skip: filters.skip ?? 0,
      ...(levelFilter !== 'ALL' && { level: levelFilter }),
      ...(searchText && { search: searchText }),
      ...(taskIdFilter && { task_id: taskIdFilter }),
    }
    fetchHistory(params)
  }, [mode, levelFilter, filters.skip, taskIdFilter, fetchHistory])

  const handleSearchChange = (val: string) => {
    setSearchText(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      if (mode === 'history') {
        const params: LogQueryParams = {
          limit: PAGE_SIZE,
          skip: 0,
          ...(levelFilter !== 'ALL' && { level: levelFilter }),
          ...(val && { search: val }),
          ...(taskIdFilter && { task_id: taskIdFilter }),
        }
        setLoading(true)
        setFilters(p => ({ ...p, skip: 0 }))
        fetchHistory(params)
      }
    }, 300)
  }

  const handleFilterByTask = (id: string) => {
    setMode('history')
    setLoading(true)
    setTaskIdFilter(id)
    setFilters(p => ({ ...p, skip: 0 }))
  }

  const page = Math.floor((filters.skip ?? 0) / PAGE_SIZE) + 1
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const filteredEntries = levelFilter === 'ALL' ? entries : entries.filter(e => e.level === levelFilter)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background shadow sm:rounded-lg">
      {/* Toolbar */}
      <div className="flex flex-col items-stretch gap-2 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode(mode === 'live' ? 'history' : 'live')}
            className={`flex items-center gap-1.5 rounded px-3 py-1 text-sm font-medium transition ${mode === 'live'
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
          >
            {mode === 'live' ? (
              <>
                <Wifi size={14} className="animate-pulse" /> Live
              </>
            ) : (
              <>
                <WifiOff size={14} /> History
              </>
            )}
          </button>

          {mode === 'live' && (
            <span className={`text-xs ${connected ? 'text-green-600' : 'text-red-500'}`}>
              {connected ? 'Connected' : 'Reconnecting…'}
            </span>
          )}
        </div>

        {/* Level filter (both modes) */}
        <div className="scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
          {LEVELS.map(l => {
            const colors = LEVEL_BUTTON_COLORS[l]
            const isSelected = levelFilter === l
            return (
              <button
                key={l}
                onClick={() => setLevelFilter(levelFilter === l ? 'ALL' : l)}
                onMouseDown={() => { if (mode === 'history') setLoading(true) }}
                className={`shrink-0 rounded px-2.5 py-1 text-xs transition sm:text-sm ${isSelected ? colors.selected : colors.unselected}`}
                title={`Filter by ${l}`}
              >
                {l === 'ALL' ? 'All' : l}
              </button>
            )
          })}
        </div>

        {mode === 'history' && (
          <div className="min-w-0 sm:ml-auto">
            <LogSearch
              searchText={searchText}
              setSearchText={setSearchText}
              onSearchChange={handleSearchChange}
              taskIdFilter={taskIdFilter}
              setTaskIdFilter={(id) => {
                setLoading(true)
                setTaskIdFilter(id)
                setFilters(p => ({ ...p, skip: 0 }))
              }}
            />
          </div>
        )}

        <div ref={topRef} />
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto font-mono text-xs scrollbar">
        {loading ? (
          <div>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonLogRow key={i} />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center text-gray-300 py-12">No log entries</div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center text-gray-300 py-12">No entries match filter</div>
        ) : (
          filteredEntries.map(entry => (
            <LogRow key={entry.id} entry={entry} onFilterByTask={handleFilterByTask} />
          ))
        )}
      </div>

      {/* History pagination */}
      {mode === 'history' && (
        <div className='flex-none flex flex-col gap-1.5 items-center pt-2 border-t border-gray-100 px-3 py-2'>
          <div className="scrollbar -mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1 sm:mx-0 sm:gap-2 sm:px-0">
            <button
              onClick={() => setFilters(p => ({ ...p, skip: 0 }))}
              className={`rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${page === 1 ? 'bg-gray-700 cursor-not-allowed' : 'bg-transparent hover:bg-gray-700'}`}
              disabled={page === 1}
              aria-label="First page"
            >
              <ChevronFirst className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            <button
              onClick={() => setFilters(p => ({ ...p, skip: Math.max(0, (page - 2) * PAGE_SIZE) }))}
              className={`rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${page === 1 ? 'bg-gray-700 cursor-not-allowed' : 'bg-transparent hover:bg-gray-700'}`}
              disabled={page === 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            {(() => {
              const maxVisiblePages = 5;
              let startPage = Math.max(1, page - Math.floor(maxVisiblePages / 2));
              let endPage = startPage + maxVisiblePages - 1;
              if (endPage > totalPages) {
                startPage = Math.max(1, totalPages - maxVisiblePages + 1);
                endPage = totalPages;
              }
              const pageNumbers = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i);
              return (
                <>
                  {startPage > 1 && (
                    <>
                      <button onClick={() => setFilters(p => ({ ...p, skip: 0 }))} className="rounded-md border bg-transparent px-2 py-1 text-xs font-medium hover:bg-gray-700 sm:px-3 sm:py-1.5 sm:text-sm">1</button>
                      {startPage > 2 && <span className="px-2 py-1 text-xs text-white sm:px-3 sm:py-1.5 sm:text-sm">...</span>}
                    </>
                  )}
                  {pageNumbers.map(p => (
                    <button
                      key={p}
                      onClick={() => setFilters(prev => ({ ...prev, skip: (p - 1) * PAGE_SIZE }))}
                      className={`rounded-md border px-2 py-1 text-xs font-medium sm:px-3 sm:py-1.5 sm:text-sm ${page === p ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-gray-700'}`}
                    >
                      {p}
                    </button>
                  ))}
                  {endPage < totalPages && (
                    <>
                      {endPage < totalPages - 1 && <span className="px-2 py-1 text-xs text-white sm:px-3 sm:py-1.5 sm:text-sm">...</span>}
                      <button onClick={() => setFilters(p => ({ ...p, skip: (totalPages - 1) * PAGE_SIZE }))} className="rounded-md border bg-transparent px-2 py-1 text-xs font-medium hover:bg-gray-700 sm:px-3 sm:py-1.5 sm:text-sm">{totalPages}</button>
                    </>
                  )}
                </>
              );
            })()}

            <button
              onClick={() => setFilters(p => ({ ...p, skip: Math.min(total - PAGE_SIZE, page * PAGE_SIZE) }))}
              className={`rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${page === totalPages ? 'bg-gray-700 cursor-not-allowed' : 'bg-transparent hover:bg-gray-700'}`}
              disabled={page === totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>

            <button
              onClick={() => setFilters(p => ({ ...p, skip: (totalPages - 1) * PAGE_SIZE }))}
              className={`rounded-md border p-1.5 text-xs font-medium sm:p-2 sm:text-sm ${page === totalPages ? 'bg-gray-700 cursor-not-allowed' : 'bg-transparent hover:bg-gray-700'}`}
              disabled={page === totalPages}
              aria-label="Last page"
            >
              <ChevronLast className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          </div>
          <div className="whitespace-nowrap text-center text-[10px] text-white sm:text-xs">
            Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)} – {Math.min(page * PAGE_SIZE, total)} of {total} entries
          </div>
        </div>
      )}
    </div>
  )
}
