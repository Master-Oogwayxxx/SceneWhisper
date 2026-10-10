import { useMemo, useState } from 'react'
import { RefreshCw, Search, Trash2 } from 'lucide-react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fileApi } from '@/api/files'
import type { DeletedFile } from '@/types/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FileBrowserPagination } from '@/components/FileBrowserPagination'

const DEFAULT_PAGE_SIZE = 50
const REFRESH_SPIN_MIN_MS = 600

const FILE_TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'video', label: 'Video' },
  { value: 'subtitle', label: 'Subtitle' },
  { value: 'other', label: 'Other' },
] as const

function formatBytes(size?: number | null) {
  if (size == null) return 'Unknown'
  if (size === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  return `${(size / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatDate(value?: string | null) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function labelize(value?: string | null) {
  if (!value) return 'Unknown'
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function DeletedHistoryRow({ item }: { item: DeletedFile }) {
  return (
    <tr className="border-b border-border/70 last:border-0 hover:bg-secondary/40">
      <td className="w-[17rem] px-3 py-2 align-top">
        <div className="font-medium text-foreground">{formatDate(item.deleted_at)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{labelize(item.source)}</div>
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium" title={item.name}>{item.name}</span>
          {item.format && <Badge variant="outline" className="shrink-0 uppercase">{item.format.replace('.', '')}</Badge>}
        </div>
        <div className="mt-1 break-all text-xs text-muted-foreground">{item.path}</div>
      </td>
      <td className="w-32 px-3 py-2 align-top text-sm text-muted-foreground">{formatBytes(item.size)}</td>
      <td className="w-36 px-3 py-2 align-top">
        <Badge variant="secondary">{labelize(item.file_type)}</Badge>
      </td>
      <td className="w-56 px-3 py-2 align-top">
        <div className="text-sm text-foreground">{labelize(item.reason)}</div>
        {item.file_record_id && (
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground" title={item.file_record_id}>
            {item.file_record_id}
          </div>
        )}
      </td>
    </tr>
  )
}

function DeletedHistoryMobileCard({ item }: { item: DeletedFile }) {
  return (
    <article className="rounded-md border border-border bg-background p-3 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold text-foreground" title={item.name}>
              {item.name}
            </h3>
            {item.format && (
              <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                {item.format.replace('.', '')}
              </Badge>
            )}
          </div>
          <div className="mt-1 text-xs font-medium text-muted-foreground">{formatDate(item.deleted_at)}</div>
        </div>
        <Badge variant="secondary" className="shrink-0 text-[10px]">
          {labelize(item.file_type)}
        </Badge>
      </div>

      <div className="mt-3 break-all rounded-md bg-secondary/35 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
        {item.path}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] font-medium uppercase text-muted-foreground">Size</div>
          <div className="mt-0.5 text-foreground">{formatBytes(item.size)}</div>
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase text-muted-foreground">Source</div>
          <div className="mt-0.5 text-foreground">{labelize(item.source)}</div>
        </div>
        <div className="col-span-2">
          <div className="text-[10px] font-medium uppercase text-muted-foreground">Reason</div>
          <div className="mt-0.5 text-foreground">{labelize(item.reason)}</div>
          {item.file_record_id && (
            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={item.file_record_id}>
              {item.file_record_id}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function DeletedHistorySkeleton() {
  return (
    <tr className="border-b border-border/70">
      <td className="px-3 py-3"><div className="h-4 w-40 animate-pulse rounded bg-secondary" /></td>
      <td className="px-3 py-3">
        <div className="h-4 w-64 animate-pulse rounded bg-secondary" />
        <div className="mt-2 h-3 w-full animate-pulse rounded bg-secondary/70" />
      </td>
      <td className="px-3 py-3"><div className="h-4 w-16 animate-pulse rounded bg-secondary" /></td>
      <td className="px-3 py-3"><div className="h-5 w-20 animate-pulse rounded-full bg-secondary" /></td>
      <td className="px-3 py-3"><div className="h-4 w-28 animate-pulse rounded bg-secondary" /></td>
    </tr>
  )
}

function DeletedHistoryMobileSkeleton() {
  return (
    <div className="rounded-md border border-border bg-background p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="h-4 w-4/5 animate-pulse rounded bg-secondary" />
          <div className="mt-2 h-3 w-32 animate-pulse rounded bg-secondary/70" />
        </div>
        <div className="h-5 w-16 animate-pulse rounded-full bg-secondary" />
      </div>
      <div className="mt-3 h-12 w-full animate-pulse rounded bg-secondary/70" />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="h-8 animate-pulse rounded bg-secondary/70" />
        <div className="h-8 animate-pulse rounded bg-secondary/70" />
        <div className="col-span-2 h-8 animate-pulse rounded bg-secondary/70" />
      </div>
    </div>
  )
}

export function DeletedHistoryTab() {
  const [search, setSearch] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState('')
  const [fileType, setFileType] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [isRefreshSpinning, setIsRefreshSpinning] = useState(false)

  const query = useQuery({
    queryKey: ['deleted-history', page, pageSize, submittedSearch, fileType],
    queryFn: () => fileApi.getDeletedHistory({ page, limit: pageSize, search: submittedSearch, fileType }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })

  const total = query.data?.total ?? 0
  const totalPages = Math.max(query.data?.totalPages ?? 1, 1)
  const isPageLoading = query.isLoading || query.isFetching || query.isPlaceholderData || (query.data !== undefined && query.data.page !== page)
  const rangeLabel = useMemo(() => {
    if (total === 0) return '0 deleted files'
    const start = (page - 1) * pageSize + 1
    const end = Math.min(page * pageSize, total)
    return `${start}-${end} of ${total} deleted files`
  }, [page, pageSize, total])

  const applySearch = () => {
    setSubmittedSearch(search.trim())
    setPage(1)
  }

  const handleFileTypeChange = (value: string) => {
    setFileType(value)
    setPage(1)
  }

  const handleRefresh = async () => {
    setIsRefreshSpinning(true)
    try {
      await query.refetch()
    } finally {
      window.setTimeout(() => setIsRefreshSpinning(false), REFRESH_SPIN_MIN_MS)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background shadow sm:rounded-lg">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive sm:h-9 sm:w-9">
            <Trash2 className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Deleted History</h2>
            <p className="truncate text-xs text-muted-foreground">{rangeLabel}</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
          <div className="scrollbar -mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:gap-2 sm:px-0 sm:pb-0">
            {FILE_TYPE_OPTIONS.map((option) => (
              <Button
                key={option.value || 'all'}
                type="button"
                size="sm"
                variant={fileType === option.value ? 'default' : 'outline'}
                onClick={() => handleFileTypeChange(option.value)}
                className="h-8 shrink-0 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm"
              >
                {option.label}
              </Button>
            ))}
            <Button type="button" size="icon" variant="ghost" onClick={() => void handleRefresh()} title="Refresh" aria-label="Refresh deleted history" className="h-8 w-8 shrink-0 sm:h-9 sm:w-9">
              <RefreshCw className={`h-4 w-4 ${isRefreshSpinning || query.isLoading || query.isFetching ? 'animate-spin' : ''}`} aria-hidden />
            </Button>
          </div>
          <div className="relative min-w-0 sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') applySearch()
              }}
              placeholder="Search deleted files"
              className="h-9 pl-9 text-sm sm:h-10"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar sm:hidden">
        <div className="space-y-2 p-2">
          {isPageLoading ? (
            Array.from({ length: Math.min(pageSize, 8) }).map((_, index) => <DeletedHistoryMobileSkeleton key={index} />)
          ) : query.data?.items.length ? (
            query.data.items.map((item) => <DeletedHistoryMobileCard key={item.id} item={item} />)
          ) : (
            <div className="px-3 py-14 text-center text-sm text-muted-foreground">
              No deleted files found
            </div>
          )}
        </div>
      </div>

      <div className="hidden min-h-0 flex-1 overflow-auto scrollbar sm:block">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-border bg-background/95 text-xs uppercase text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-semibold">Deleted</th>
              <th className="px-3 py-2 font-semibold">File</th>
              <th className="px-3 py-2 font-semibold">Size</th>
              <th className="px-3 py-2 font-semibold">Type</th>
              <th className="px-3 py-2 font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody>
            {isPageLoading ? (
              Array.from({ length: Math.min(pageSize, 8) }).map((_, index) => <DeletedHistorySkeleton key={index} />)
            ) : query.data?.items.length ? (
              query.data.items.map((item) => <DeletedHistoryRow key={item.id} item={item} />)
            ) : (
              <tr>
                <td colSpan={5} className="px-3 py-14 text-center text-sm text-muted-foreground">
                  No deleted files found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2">
        <FileBrowserPagination
          currentPage={page}
          totalPages={totalPages}
          itemsPerPage={pageSize}
          setItemsPerPage={setPageSize}
          setCurrentPage={setPage}
          total={total}
          hideItemsPerPageOnMobile
        />
      </div>
    </div>
  )
}
