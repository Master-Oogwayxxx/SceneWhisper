import type { ReactElement, ReactNode } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from 'lucide-react'
import type { BookmarkVideoCheckItem, File } from '@/types/types'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'

export type StatusFilter = 'all' | 'exists' | 'missing'

export interface ParsedGoogleBookmarks {
  items: BookmarkVideoCheckItem[]
  directories: string[]
}

const VIDEO_CODE_RE = /\b([A-Z]{2,10})[-_\s]?(\d{2,6})(?:[-_\s]?(?:U|UC|UNCENSORED|RM|R18))?\b/gi

function normalizeVideoCode(value: string) {
  const match = /^([A-Z]{2,10})[-_\s]?(\d{2,6})/i.exec(value.trim())
  return match ? `${match[1].toUpperCase()}-${match[2]}` : value.toUpperCase()
}

function extractVideoCode(...values: string[]) {
  for (const value of values) {
    VIDEO_CODE_RE.lastIndex = 0
    const match = VIDEO_CODE_RE.exec(value)
    if (match) {
      return normalizeVideoCode(`${match[1]}-${match[2]}`)
    }
  }
  return null
}

export function parseGoogleBookmarks(html: string): ParsedGoogleBookmarks {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const seen = new Set<string>()
  const directorySet = new Set<string>()
  const items: BookmarkVideoCheckItem[] = []

  const addLink = (link: HTMLAnchorElement, path: string[]) => {
    const url = link.href
    const title = link.textContent?.trim() || url
    const videoCode = extractVideoCode(title, url)
    if (!videoCode) return

    const bookmarkPath = path.join(' / ')
    const key = `${videoCode}|${url}`
    if (seen.has(key)) return
    seen.add(key)
    if (bookmarkPath) directorySet.add(bookmarkPath)

    items.push({ title, url, videoCode, bookmarkPath, fileExists: false, matchedFiles: [] })
  }

  const walkDl = (dl: HTMLDListElement, path: string[]) => {
    const children = Array.from(dl.children)
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if (child.tagName === 'DL') {
        walkDl(child as HTMLDListElement, path)
        continue
      }
      if (child.tagName !== 'DT') continue

      const directChildren = Array.from(child.children)
      const folder = directChildren.find((element): element is HTMLHeadingElement => element.tagName === 'H3')
      const link = directChildren.find((element): element is HTMLAnchorElement => element.tagName === 'A' && element.hasAttribute('href'))
      const childDl = directChildren.find((element): element is HTMLDListElement => element.tagName === 'DL')
      const siblingDl = children[index + 1]?.tagName === 'DL' ? children[index + 1] as HTMLDListElement : null
      const nestedDl = childDl ?? siblingDl

      if (folder) {
        const folderPath = [...path, folder.textContent?.trim() || 'Untitled']
        directorySet.add(folderPath.join(' / '))
        if (nestedDl) walkDl(nestedDl, folderPath)
        if (siblingDl) index += 1
        continue
      }

      if (link) addLink(link, path)
      if (nestedDl) walkDl(nestedDl, path)
    }
  }

  const rootDl = doc.querySelector<HTMLDListElement>('dl')
  if (rootDl) {
    walkDl(rootDl, [])
  } else {
    Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')).forEach((link) => addLink(link, []))
  }

  return { items, directories: Array.from(directorySet).sort((a, b) => a.localeCompare(b)) }
}

export function parseHtmlPageVideoLinks(html: string): BookmarkVideoCheckItem[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const seen = new Set<string>()
  const items: BookmarkVideoCheckItem[] = []

  Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')).forEach((link) => {
    const url = link.getAttribute('href')?.trim() || link.href
    const title = link.textContent?.trim() ||
      link.getAttribute('title')?.trim() ||
      link.getAttribute('aria-label')?.trim() ||
      link.querySelector('img')?.getAttribute('alt')?.trim() ||
      url
    const videoCode = extractVideoCode(title)
    if (!videoCode) return

    const key = `${videoCode}|${url}`
    if (seen.has(key)) return
    seen.add(key)

    items.push({ title, url, videoCode, fileExists: false, matchedFiles: [] })
  })

  return items
}

export function parseVideoCodeList(value: string): BookmarkVideoCheckItem[] {
  const seen = new Set<string>()
  const items: BookmarkVideoCheckItem[] = []

  for (const rawValue of value.split(/[\s,;]+/)) {
    const videoCode = extractVideoCode(rawValue)
    if (!videoCode || seen.has(videoCode)) continue
    seen.add(videoCode)
    items.push({
      title: videoCode,
      url: videoCode,
      videoCode,
      fileExists: false,
      matchedFiles: [],
    })
  }

  return items
}

export function resolutionLabel(file: File) {
  if (!file.height) return 'Unknown'
  if (file.height <= 480) return 'SD'
  if (file.height <= 720) return '720p'
  if (file.height <= 1080) return '1080p'
  if (file.height <= 1440) return '1440p'
  return '4K'
}

export function formatBytes(size?: number | null) {
  if (size == null) return 'Unknown'
  if (size === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  return `${(size / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatDate(value?: Date | string | null) {
  if (!value) return 'Unknown'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function parentDirectoryName(path: string) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : path
}

export function BookmarkStatusBadge({ exists }: { exists: boolean }) {
  return exists ? (
    <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10">
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      Exists
    </Badge>
  ) : (
    <Badge variant="secondary" className="gap-1">
      <XCircle className="h-3 w-3" aria-hidden />
      Missing
    </Badge>
  )
}

export function MatchedFilesSummary({ files }: { files: File[] }) {
  if (!files.length) {
    return <div className="text-xs text-muted-foreground">No matching local file</div>
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <div key={file.id} className="min-w-0">
          <div className="truncate font-medium" title={file.name}>{file.name}</div>
          <div className="mt-1 break-all text-xs text-muted-foreground">{file.path}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatBytes(file.size)}</span>
            <span>{file.duration || 'Unknown duration'}</span>
            <span>{resolutionLabel(file)}</span>
            <span>{file.format?.replace('.', '').toUpperCase() || 'Unknown format'}</span>
            <span>{file.codec || 'Unknown codec'}</span>
            <span>{file.fps ? `${file.fps.toFixed(2)} fps` : 'Unknown fps'}</span>
            <span>Created {formatDate(file.created_at)}</span>
            <span>Modified {formatDate(file.modified_at)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function MatchedFilesTable({
  items,
  emptyMessage,
  renderRowActions,
  renderRowContextMenuContent,
  selectedRowIds,
  onToggleRow,
  onToggleAllRows,
  groupByCode = false,
  collapsedCodeGroups,
  onToggleCodeGroup,
  showFps = true,
  showCodec = true,
  openedCodeGroups,
  showParentDirectoryOnly = false,
}: {
  items: BookmarkVideoCheckItem[]
  emptyMessage: string
  renderRowActions?: (row: { item: BookmarkVideoCheckItem; file: File }) => ReactNode
  renderRowContextMenuContent?: (row: { item: BookmarkVideoCheckItem; file: File }) => ReactNode
  selectedRowIds?: Set<string>
  onToggleRow?: (rowId: string, checked: boolean) => void
  onToggleAllRows?: (rowIds: string[], checked: boolean) => void
  groupByCode?: boolean
  collapsedCodeGroups?: Set<string>
  onToggleCodeGroup?: (videoCode: string) => void
  showFps?: boolean
  showCodec?: boolean
  openedCodeGroups?: Set<string>
  showParentDirectoryOnly?: boolean
}) {
  const rows = items.flatMap((item) => item.matchedFiles.map((file) => ({
    item,
    file,
    rowId: `${item.videoCode}:${file.id}`,
  })))
  const selectableRowIds = items.flatMap((item) => (
    item.matchedFiles.length
      ? item.matchedFiles.map((file) => `${item.videoCode}:${file.id}`)
      : groupByCode
        ? [`${item.videoCode}:missing`]
        : []
  ))
  const hasActions = Boolean(renderRowActions)
  const hasSelection = Boolean(selectedRowIds && onToggleRow)
  const selectedCount = selectedRowIds ? selectableRowIds.filter((rowId) => selectedRowIds.has(rowId)).length : 0
  const allSelected = selectableRowIds.length > 0 && selectedCount === selectableRowIds.length
  const someSelected = selectedCount > 0 && !allSelected
  const columnCount = 9
    - (showFps ? 0 : 1)
    - (showCodec ? 0 : 1)
    + (hasSelection ? 1 : 0)
    + (hasActions ? 1 : 0)
    + (groupByCode ? 0 : 1)

  if (!rows.length && (!groupByCode || !items.length)) {
    return <div className="px-3 py-14 text-center text-sm text-muted-foreground">{emptyMessage}</div>
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar">
      <table className={`w-full ${showFps && showCodec ? 'min-w-[1280px]' : 'min-w-[1080px]'} border-collapse text-left text-sm`}>
        <thead className="sticky top-0 z-10 border-b border-border bg-background/95 text-xs uppercase text-muted-foreground backdrop-blur">
          <tr>
            {hasSelection && (
              <th className="w-12 px-3 py-2 font-semibold">
                <Checkbox
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(checked) => onToggleAllRows?.(selectableRowIds, checked === true)}
                  aria-label={allSelected ? 'Deselect all matched files' : 'Select all matched files'}
                />
              </th>
            )}
            {!groupByCode && <th className="w-36 px-3 py-2 font-semibold">Code</th>}
            <th className="px-3 py-2 font-semibold">Matched Local File</th>
            <th className="w-28 px-3 py-2 font-semibold">Size</th>
            <th className="w-28 px-3 py-2 font-semibold">Duration</th>
            <th className="w-24 px-3 py-2 font-semibold">Resolution</th>
            {showFps && <th className="w-20 px-3 py-2 font-semibold">FPS</th>}
            <th className="w-24 px-3 py-2 font-semibold">Format</th>
            {showCodec && <th className="w-28 px-3 py-2 font-semibold">Codec</th>}
            <th className="w-40 px-3 py-2 font-semibold">Created</th>
            <th className="w-40 px-3 py-2 font-semibold">Modified</th>
            {hasActions && <th className="w-16 px-3 py-2 text-right font-semibold">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {items.flatMap((item) => {
            const itemRows = item.matchedFiles.map((file) => ({
              item,
              file,
              rowId: `${item.videoCode}:${file.id}`,
            }))
            if (!itemRows.length) {
              if (!groupByCode) return []
              const missingRowId = `${item.videoCode}:missing`
              return [
                <tr key={`${item.videoCode}:group`} className="border-b border-border bg-secondary/50">
                  <td colSpan={columnCount}>
                    <div className="flex items-center gap-2 py-0.5">
                      {hasSelection && (
                        <Checkbox
                          checked={selectedRowIds?.has(missingRowId) ?? false}
                          onCheckedChange={(checked) => onToggleRow?.(missingRowId, checked === true)}
                          aria-label={`Select ${item.videoCode}`}
                        />
                      )}
                      <span className="w-4 shrink-0" aria-hidden />
                      <span className="font-mono font-semibold text-foreground">{item.videoCode}</span>
                      <BookmarkStatusBadge exists={false} />
                    </div>
                  </td>
                </tr>,
              ]
            }

            const isCollapsed = collapsedCodeGroups?.has(item.videoCode) ?? false
            const renderedRows: ReactElement[] = []
            if (groupByCode) {
              renderedRows.push(
                <tr key={`${item.videoCode}:group`} className="border-b border-border bg-secondary/50">
                  <td colSpan={columnCount} className="p-0">
                    <button
                      type="button"
                      onClick={() => onToggleCodeGroup?.(item.videoCode)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                      <span className="font-mono font-semibold text-foreground">{item.videoCode}</span>
                      <Badge variant="secondary">{itemRows.length} {itemRows.length === 1 ? 'match' : 'matches'}</Badge>
                      {openedCodeGroups?.has(item.videoCode) && (
                        <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-600 hover:bg-blue-500/10">Opened</Badge>
                      )}
                    </button>
                  </td>
                </tr>
              )
            }

            if (isCollapsed) return renderedRows

            renderedRows.push(...itemRows.map(({ item, file, rowId }) => {
            const actions = renderRowActions?.({ item, file })
            const contextMenuContent = renderRowContextMenuContent?.({ item, file })
            const row = (
              <tr key={rowId} className="border-b border-border/70 last:border-0 hover:bg-secondary/40">
                {hasSelection && (
                  <td className="px-3 py-2 align-middle">
                    <Checkbox
                      checked={selectedRowIds?.has(rowId) ?? false}
                      onCheckedChange={(checked) => onToggleRow?.(rowId, checked === true)}
                      aria-label={`Select ${item.videoCode}`}
                    />
                  </td>
                )}
                {!groupByCode && <td className="px-3 py-2 align-top font-mono font-semibold">{item.videoCode}</td>}
                <td className="min-w-0 px-3 py-2 align-top">
                  <div className="truncate font-medium" title={file.name}>{file.name}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground" title={file.path}>
                    {showParentDirectoryOnly ? parentDirectoryName(file.path) : file.path}
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-muted-foreground">{formatBytes(file.size)}</td>
                <td className="px-3 py-2 align-top text-muted-foreground">{file.duration || 'Unknown'}</td>
                <td className="px-3 py-2 align-top text-muted-foreground">{resolutionLabel(file)}</td>
                {showFps && <td className="px-3 py-2 align-top text-muted-foreground">{file.fps ? file.fps.toFixed(2) : 'Unknown'}</td>}
                <td className="px-3 py-2 align-top uppercase text-muted-foreground">{file.format?.replace('.', '') || 'Unknown'}</td>
                {showCodec && <td className="px-3 py-2 align-top text-muted-foreground">{file.codec || 'Unknown'}</td>}
                <td className="px-3 py-2 align-top text-muted-foreground">{formatDate(file.created_at)}</td>
                <td className="px-3 py-2 align-top text-muted-foreground">{formatDate(file.modified_at)}</td>
                {hasActions && <td className="px-3 py-2 text-right align-top">{actions}</td>}
              </tr>
            )
            if (!contextMenuContent) {
              return row
            }
            return (
              <ContextMenu key={rowId}>
                <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                <ContextMenuContent>{contextMenuContent}</ContextMenuContent>
              </ContextMenu>
            )
            }))
            return renderedRows
          })}
        </tbody>
      </table>
    </div>
  )
}
