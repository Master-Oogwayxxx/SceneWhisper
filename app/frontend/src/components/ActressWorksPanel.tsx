import { CalendarClock, Check, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Download, Edit2, ExternalLink, ImageIcon, Loader2, ListOrdered, Magnet, Search, SortAsc, TextCursorInput, User, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { MoreHorizontal, Plus } from 'lucide-react'
import { strToU8, zipSync } from 'fflate'
import { r18Api } from '@/api/r18'
import { ActressDetail, ActressWork, DownloadQueueItem, NyaaResult } from '@/types/types'
import { toast } from 'sonner'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Skeleton } from './ui/skeleton'
import { Switch } from './ui/switch'
import { Input } from './ui/input'
import { ActressWorkCard } from './ActressWorkCard'
import { useDownloads } from '@/hooks/useDownloads'
import { r18Keys } from '@/hooks/useR18'
import { useSettings } from '@/hooks/useSettings'
import { ActressWorksFilterDialog } from './ActressWorksFilterDialog'
import { ActressWorksFilterState, filterActressWorksByOpenedState, isActressWorksFilterActive } from '@/lib/actress-works-filters'
import { buildExternalVideoTargetUrl, isValidExternalVideoTarget } from '@/lib/external-video-targets'
import { resolveSelectedWorkLinks } from '@/lib/selected-work-links'
import { useQueryClient } from '@tanstack/react-query'

const PAGE_SIZE_OPTIONS = [10, 15, 25, 50, 100, 250, 500, 1000]
const EXPANDED_ACTIONS_MIN_WIDTH = 1920

interface WorkLinkToOpen {
  contentId: string
  url: string
}

function WorkCardSkeleton({ showCover }: { showCover: boolean }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {showCover && <Skeleton className="aspect-[2/3] w-full" />}
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-5 w-20" />
      </div>
    </div>
  )
}

function rankNyaaResult(result: Pick<NyaaResult, 'title' | 'seeders'>): [number, number, number] {
  const titleLower = result.title.toLowerCase()
  return [
    Number(titleLower.includes('reducing mosaic')),
    Number(titleLower.includes('uncensored')),
    result.seeders,
  ]
}

function pickBestNyaaResult(results: NyaaResult[]): NyaaResult | null {
  if (results.length === 0) return null
  return [...results].sort((a, b) => {
    const [aReducing, aUncensored, aSeeders] = rankNyaaResult(a)
    const [bReducing, bUncensored, bSeeders] = rankNyaaResult(b)
    if (aReducing !== bReducing) return bReducing - aReducing
    if (aUncensored !== bUncensored) return bUncensored - aUncensored
    if (aSeeders !== bSeeders) return bSeeders - aSeeders
    return 0
  })[0]
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildSheetXml(rows: Array<Record<string, string | number | null | undefined>>): string {
  const headers = ['Video Code', 'Matched Torrent Title', 'Torrent URL', 'Magnet Link', 'Seeders']
  const xmlRows = [
    `<row r="1">${headers.map((header, index) => {
      const col = String.fromCharCode(65 + index)
      return `<c r="${col}1" t="inlineStr"><is><t>${escapeXml(header)}</t></is></c>`
    }).join('')}</row>`,
    ...rows.map((row) => (
      `<row>${headers.map((header, index) => {
        const value = row[header]
        if (typeof value === 'number' && Number.isFinite(value)) {
          const col = String.fromCharCode(65 + index)
          return `<c r="${col}" t="n"><v>${value}</v></c>`
        }
        const col = String.fromCharCode(65 + index)
        return `<c r="${col}" t="inlineStr"><is><t>${escapeXml(String(value ?? ''))}</t></is></c>`
      }).join('')}</row>`
    )),
  ]

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${xmlRows.join('\n    ')}
  </sheetData>
</worksheet>`
}

function downloadExcelFile(filename: string, rows: Array<Record<string, string | number | null | undefined>>) {
  const sheetXml = buildSheetXml(rows)
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Magnets" sheetId="1" r:id="rId1" />
  </sheets>
</workbook>`
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml" />
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml" />
</Relationships>`
  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml" />
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml" />
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml" />
</Relationships>`
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="xml" ContentType="application/xml" />
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" />
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml" />
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml" />
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml" />
</Types>`
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1">
    <font><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="1">
    <fill><patternFill patternType="none"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  </cellXfs>
</styleSheet>`
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Actress magnets export</dc:title>
  <dc:creator>SceneWhisper</dc:creator>
  <cp:lastModifiedBy>SceneWhisper</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`
  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>SceneWhisper</Application>
</Properties>`

  const zipped = zipSync({
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels': strToU8(rootRelsXml),
    'docProps/core.xml': strToU8(coreXml),
    'docProps/app.xml': strToU8(appXml),
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(relsXml),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
    'xl/styles.xml': strToU8(stylesXml),
  })

  const blob = new Blob([zipped], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function downloadTextFile(filename: string, value: string) {
  const blob = new Blob([value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
}

export interface ActressWorksPanelProps {
  detail?: ActressDetail
  detailLoading: boolean
  works?: ActressDetail['recent_works']
  worksTotal: number
  worksLoading: boolean
  worksPage: number
  worksTotalPages: number
  worksPageSize: number
  showCovers: boolean
  showTitles: boolean
  sortBy: string
  sortDir: string
  search: string
  selectedCodes: Set<string>
  selectedWorks?: ActressWork[]
  onToggleSelect: (work: ActressWork, shiftKey?: boolean) => void
  onSelectAll?: () => void
  onToggleCovers: (checked: boolean) => void
  onToggleTitles: (checked: boolean) => void
  onWorksPageChange: (page: number) => void
  onWorksPageSizeChange: (size: number) => void
  onSortChange: (sortBy: string, sortDir: string) => void
  onSearchChange: (search: string) => void
  worksFilter: ActressWorksFilterState
  worksFilterDraft: ActressWorksFilterState
  onWorksFilterDraftChange: (patch: Partial<ActressWorksFilterState>) => void
  onWorksFilterApply: () => void
  onWorksFilterReset: () => void
  queueItems?: DownloadQueueItem[]
  onDeselectAll?: () => void
  onQueue?: () => void
  onQueuePage?: () => void
  onDownloadAgain?: (contentId: string, videoCode: string, queueItemId: number) => void
  onQueueAll?: () => void
  queueAllLoading?: boolean
  onCancelDownload?: (contentId: string) => void
  onScheduleActress?: (detail: ActressDetail) => void
  onAddScraper?: (actressName: string) => void
  actressName?: string
  customActressName?: string
  onCustomActressNameChange?: (actressId: number, name: string) => void
  defaultSavePath?: string | null
}

export function ActressWorksPanel({
  detail,
  detailLoading,
  works,
  worksTotal,
  worksLoading,
  worksPage,
  worksTotalPages,
  worksPageSize,
  showCovers,
  showTitles,
  sortBy,
  sortDir,
  search,
  selectedCodes,
  selectedWorks,
  onToggleSelect,
  onSelectAll,
  onToggleCovers,
  onToggleTitles,
  onWorksPageChange,
  onWorksPageSizeChange,
  onSortChange,
  onSearchChange,
  worksFilter,
  worksFilterDraft,
  onWorksFilterDraftChange,
  onWorksFilterApply,
  onWorksFilterReset,
  queueItems,
  onDeselectAll,
  onQueue,
  onQueuePage,
  onDownloadAgain,
  onQueueAll,
  queueAllLoading,
  onCancelDownload,
  onScheduleActress,
  onAddScraper,
  actressName,
  customActressName,
  onCustomActressNameChange,
  defaultSavePath,
}: ActressWorksPanelProps) {
  const downloadsMap = useDownloads(true)
  const { settings } = useSettings()
  const queryClient = useQueryClient()
  const queueMap = new Map((queueItems ?? []).map((q) => [q.content_id, q]))
  const filteredWorks = useMemo(
    () => filterActressWorksByOpenedState(works ?? [], worksFilter.opened),
    [works, worksFilter.opened]
  )
  const externalVideoTargets = useMemo(
    () => settings.external_video_targets.filter(isValidExternalVideoTarget),
    [settings.external_video_targets]
  )
  const selectedWorkLinks = resolveSelectedWorkLinks(selectedCodes, selectedWorks, filteredWorks)
  const [sortOpen, setSortOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedLinksOpen, setSelectedLinksOpen] = useState(false)
  const [selectedExternalTargetKeys, setSelectedExternalTargetKeys] = useState<Set<string>>(() => new Set())
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [desktopMoreOpen, setDesktopMoreOpen] = useState(false)
  const [showExpandedActions, setShowExpandedActions] = useState(() => window.innerWidth > EXPANDED_ACTIONS_MIN_WIDTH)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingAliasMagnets, setExportingAliasMagnets] = useState(false)
  const [editingActressName, setEditingActressName] = useState(false)
  const [actressNameDraft, setActressNameDraft] = useState('')
  const [inputValue, setInputValue] = useState(search)
  const focuslessOutlineButtonClass = 'focus-visible:ring-0 focus-visible:ring-offset-0'
  const selectedExternalTargets = useMemo(
    () => externalVideoTargets.filter((target) => selectedExternalTargetKeys.has(target.label + target.url_template)),
    [externalVideoTargets, selectedExternalTargetKeys]
  )

  useEffect(() => { setInputValue(search) }, [search])

  useEffect(() => {
    const timer = setTimeout(() => { onSearchChange(inputValue) }, 700)
    return () => clearTimeout(timer)
  }, [inputValue])

  useEffect(() => {
    const syncExpandedActions = () => setShowExpandedActions(window.innerWidth > EXPANDED_ACTIONS_MIN_WIDTH)
    syncExpandedActions()
    window.addEventListener('resize', syncExpandedActions)
    return () => window.removeEventListener('resize', syncExpandedActions)
  }, [])

  const openUrlsInNewTabs = (urls: string[]) => {
    let blockedCount = 0
    const openedTabs: Window[] = []

    for (const url of urls) {
      const tab = window.open('about:blank', '_blank')
      if (!tab) {
        blockedCount += 1
        continue
      }

      try {
        tab.opener = null
      } catch {
        // Ignore browsers that prevent reassigning opener.
      }
      openedTabs.push(tab)
      tab.location.href = url
    }

    return { openedCount: openedTabs.length, blockedCount }
  }

  const persistOpenedStates = async (contentIds: string[]) => {
    const uniqueContentIds = Array.from(new Set(contentIds)).filter(Boolean)
    if (uniqueContentIds.length === 0) return

    try {
      await r18Api.markActressWorksOpened(uniqueContentIds)
      void queryClient.invalidateQueries({ queryKey: r18Keys.all() })
    } catch {
      toast.warning('Opened links, but failed to save opened state.')
    }
  }

  const openWorkLinksInNewTabs = (links: WorkLinkToOpen[]) => {
    let blockedCount = 0
    const openedLinks: WorkLinkToOpen[] = []

    for (const link of links) {
      const tab = window.open(link.url, '_blank')
      if (!tab) {
        blockedCount += 1
        continue
      }

      try {
        tab.opener = null
      } catch {
        // Ignore browsers that prevent reassigning opener.
      }
      openedLinks.push(link)
    }

    void persistOpenedStates(openedLinks.map((link) => link.contentId))

    if (openedLinks.length > 0) {
      toast.info(
        openedLinks.length === 1
          ? 'Opened 1 work link.'
          : `Opened ${openedLinks.length} work links.`
      )
    }

    return { openedCount: openedLinks.length, blockedCount }
  }

  const openSelectedWorksInSelectedTargets = async () => {
    const links = selectedWorkLinks.flatMap((work) =>
      selectedExternalTargets.map((target) => ({
        contentId: work.contentId,
        url: buildExternalVideoTargetUrl(target, work.formattedId, actressName ?? ''),
      }))
    )
    const { openedCount, blockedCount } = openWorkLinksInNewTabs(links)
    if (blockedCount > 0) {
      toast.warning(
        openedCount > 0
          ? `Opened ${openedCount} tabs. Your browser blocked ${blockedCount} more.`
          : `Your browser blocked all selected tabs.`
      )
    }
  }

  const toggleExternalTarget = (targetKey: string, checked: boolean) => {
    setSelectedExternalTargetKeys((previous) => {
      const next = new Set(previous)
      if (checked) {
        next.add(targetKey)
      } else {
        next.delete(targetKey)
      }
      return next
    })
  }

  const exportMagnetWorkbook = async () => {
    if (!detail || filteredWorks.length === 0 || exportingExcel) {
      return
    }

    setExportingExcel(true)
    try {
      const exportedRows: Array<Record<string, string | number | null | undefined>> = []
      let missingMagnets = 0
      const worksToExport = selectedCodes.size > 0
        ? filteredWorks.filter((work) => selectedCodes.has(work.content_id))
        : filteredWorks

      for (const work of worksToExport) {
        const videoCode = work.video_code ?? work.dvd_id ?? work.content_id
        if (!videoCode) {
          continue
        }

        const results = await r18Api.getNyaaResults(videoCode, work.content_id)
        const selectedTorrent = pickBestNyaaResult(results)
        let magnetLink = ''
        let matchedTorrentTitle = ''
        let torrentUrl = ''

        if (selectedTorrent) {
          matchedTorrentTitle = selectedTorrent.title
          torrentUrl = selectedTorrent.torrent_url
          magnetLink = selectedTorrent.magnet_url?.trim() || ''
          if (!magnetLink) {
            try {
              const resolved = await r18Api.getNyaaMagnet(selectedTorrent.torrent_url, selectedTorrent.title)
              magnetLink = resolved.magnet_url?.trim() || ''
            } catch {
              magnetLink = ''
            }
          }
        }

        if (!magnetLink) {
          missingMagnets += 1
        }

        exportedRows.push({
          'Video Code': videoCode,
          'Matched Torrent Title': matchedTorrentTitle,
          'Torrent URL': torrentUrl,
          'Magnet Link': magnetLink,
          Seeders: selectedTorrent?.seeders ?? '',
        })
      }

      const actressFileName = sanitizeFileName(actressName ?? `actress-${detail.id}`)
      downloadExcelFile(`${actressFileName}-magnets.xlsx`, exportedRows)
      toast.success(
        missingMagnets > 0
          ? `Exported ${exportedRows.length} rows, ${missingMagnets} magnet links were unavailable`
          : `Exported ${exportedRows.length} magnet links`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export magnet workbook')
    } finally {
      setExportingExcel(false)
    }
  }

  const exportActressAliasMagnets = async () => {
    if (!detail || exportingAliasMagnets) {
      return
    }

    setExportingAliasMagnets(true)
    try {
      const response = await r18Api.exportActressMagnets(detail.id)
      const actressFileName = sanitizeFileName(response.actress_name || actressName || `actress-${detail.id}`)
      const contents = response.magnets.length > 0 ? `${response.magnets.join('\n')}\n` : ''
      downloadTextFile(`${actressFileName}-all-magnets.txt`, contents)
      toast.success(
        response.magnets.length > 0
          ? `Exported ${response.magnets.length} magnet links from ${response.queries.length} aliases`
          : `No magnet links found from ${response.queries.length} aliases`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export actress magnet links')
    } finally {
      setExportingAliasMagnets(false)
    }
  }

  const worksGridClass = showCovers
    ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-2 sm:gap-3 items-start content-start'
    : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 sm:gap-3 items-start content-start'
  const resolvedActressName = actressName ?? (detail ? detail.display_name ?? detail.name_romaji ?? detail.name_kanji ?? detail.name_kana ?? `Actress #${detail.id}` : undefined)

  useEffect(() => {
    if (!editingActressName) {
      setActressNameDraft(customActressName ?? '')
    }
  }, [customActressName, editingActressName])

  const saveCustomActressName = () => {
    if (!detail || !onCustomActressNameChange) return
    onCustomActressNameChange(detail.id, actressNameDraft)
    setEditingActressName(false)
  }

  return (
    <>
      <div className="border-b border-border shrink-0">
        <div className="flex flex-wrap items-center gap-2 px-2 py-2 sm:flex-nowrap sm:gap-3 sm:px-3 sm:py-3">
          {detailLoading && !detail ? (
            <>
              <Skeleton className="h-10 w-10 rounded-full shrink-0" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            </>
          ) : detail ? (
            <>
              {detail.image_url ? (
                <img
                  src={detail.image_url}
                  alt=""
                  className="h-10 w-10 rounded-full object-cover shrink-0 bg-muted"
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-[9rem] flex-1 sm:min-w-0">
                {editingActressName ? (
                  <div className="flex min-w-0 items-center gap-1">
                    <Input
                      value={actressNameDraft}
                      onChange={(event) => setActressNameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          saveCustomActressName()
                        } else if (event.key === 'Escape') {
                          setActressNameDraft(customActressName ?? '')
                          setEditingActressName(false)
                        }
                      }}
                      placeholder={resolvedActressName}
                      className="h-8 min-w-0"
                      autoFocus
                    />
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={saveCustomActressName} aria-label="Save custom actress name">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={() => {
                        setActressNameDraft(customActressName ?? '')
                        setEditingActressName(false)
                      }}
                      aria-label="Cancel custom actress name"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-1">
                    <p className="font-medium truncate">{resolvedActressName}</p>
                    {onCustomActressNameChange && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-muted-foreground"
                        onClick={() => {
                          setActressNameDraft(customActressName ?? '')
                          setEditingActressName(true)
                        }}
                        aria-label="Edit custom actress name"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {worksTotal.toLocaleString()} {worksTotal === 1 ? 'work' : 'works'}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground flex-1">Actress not found.</p>
          )}
          <div className="flex w-full items-center justify-start gap-3 sm:contents">
            <div className="flex items-center gap-1.5 shrink-0 sm:gap-2">
              <ImageIcon className="h-4 w-4 text-muted-foreground hidden sm:block" aria-hidden />
              <Label htmlFor="show-work-covers" className="text-xs text-muted-foreground sm:not-sr-only">
                Covers
              </Label>
              <Switch
                id="show-work-covers"
                checked={showCovers}
                onCheckedChange={onToggleCovers}
                aria-label="Show work cover images"
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0 sm:gap-2">
              <TextCursorInput className="h-4 w-4 text-muted-foreground hidden sm:block" aria-hidden />
              <Label htmlFor="show-work-titles" className="text-xs text-muted-foreground sm:not-sr-only">
                Titles
              </Label>
              <Switch
                id="show-work-titles"
                checked={showTitles}
                onCheckedChange={onToggleTitles}
                aria-label="Show work titles"
              />
            </div>
          </div>
          <div className="flex w-full items-center gap-2 sm:contents">
            <div className="inline-flex rounded-md shadow-sm shrink-0">
              <DropdownMenu open={sortOpen} onOpenChange={setSortOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className={`h-9 rounded-r-none border-r-0 px-2 text-sm sm:h-10 sm:px-3 ${focuslessOutlineButtonClass}`}>
                    <SortAsc className="h-4 w-4" />
                    <span className="inline ml-1">
                      {sortBy === 'id' ? 'ID' : sortBy === 'title' ? 'Title' : 'Date'}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-32">
                  <DropdownMenuItem className="cursor-pointer" onClick={() => { onSortChange('date', sortDir); onWorksPageChange(0); setSortOpen(false) }}>Date</DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer" onClick={() => { onSortChange('id', sortDir); onWorksPageChange(0); setSortOpen(false) }}>ID</DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer" onClick={() => { onSortChange('title', sortDir); onWorksPageChange(0); setSortOpen(false) }}>Title</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="outline"
                className={`h-9 w-full rounded-l-none border-l-0 px-2 text-sm sm:h-10 sm:w-auto sm:px-3 ${focuslessOutlineButtonClass}`}
                onClick={() => { onSortChange(sortBy, sortDir === 'asc' ? 'desc' : 'asc'); onWorksPageChange(0) }}
              >
                {sortDir === 'asc' ? '↑' : '↓'}
                <span className="inline ml-0.5">{sortDir === 'asc' ? 'Asc' : 'Desc'}</span>
              </Button>
            </div>
            <ActressWorksFilterDialog
              isFilterActive={isActressWorksFilterActive(worksFilter)}
              open={filterOpen}
              onOpenChange={setFilterOpen}
              draft={worksFilterDraft}
              onDraftChange={onWorksFilterDraftChange}
              onApply={onWorksFilterApply}
              onReset={onWorksFilterReset}
            />
            {!showExpandedActions && (
              <DropdownMenu open={mobileMoreOpen} onOpenChange={setMobileMoreOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`ml-auto h-9 shrink-0 gap-1.5 text-sm sm:hidden ${focuslessOutlineButtonClass}`}
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                    More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onQueueAll && (
                    <DropdownMenuItem
                      className="cursor-pointer"
                      disabled={queueAllLoading}
                      onClick={() => {
                        onQueueAll()
                        setMobileMoreOpen(false)
                      }}
                    >
                      {queueAllLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ListOrdered className="mr-2 h-4 w-4" />
                      )}
                      {queueAllLoading ? 'Queueing...' : 'Queue All'}
                    </DropdownMenuItem>
                  )}
                  {detail && onScheduleActress && (
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => {
                        onScheduleActress(detail)
                        setMobileMoreOpen(false)
                      }}
                    >
                      <CalendarClock className="mr-2 h-4 w-4" />
                      Schedule
                    </DropdownMenuItem>
                  )}
                  {detail && actressName && onAddScraper && (
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => {
                        onAddScraper(actressName)
                        setMobileMoreOpen(false)
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Scraper
                    </DropdownMenuItem>
                  )}
                  {detail && (
                    <DropdownMenuItem
                      className="cursor-pointer"
                      disabled={exportingAliasMagnets}
                      onClick={() => {
                        void exportActressAliasMagnets()
                        setMobileMoreOpen(false)
                      }}
                    >
                      {exportingAliasMagnets ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Magnet className="mr-2 h-4 w-4" />
                      )}
                      {exportingAliasMagnets ? 'Exporting...' : 'Export Magnets'}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {onQueueAll && (
            <Button
              variant="outline"
              size="sm"
              className={`hidden shrink-0 h-9 gap-1.5 text-sm sm:flex sm:h-10 ${focuslessOutlineButtonClass}`}
              disabled={queueAllLoading}
              onClick={onQueueAll}
            >
              {queueAllLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ListOrdered className="h-4 w-4" />
              )}
              {queueAllLoading ? 'Queueing...' : 'Queue All'}
            </Button>
          )}
          {showExpandedActions && detail && onScheduleActress && (
            <Button
              variant="outline"
              size="sm"
              className={`shrink-0 h-9 gap-1.5 text-sm sm:h-10 ${focuslessOutlineButtonClass}`}
              onClick={() => onScheduleActress(detail)}
            >
              <CalendarClock className="h-4 w-4" />
              Schedule
            </Button>
          )}
          {showExpandedActions && detail && actressName && onAddScraper && (
            <Button
              variant="outline"
              size="sm"
              className={`shrink-0 h-9 gap-1.5 text-sm sm:h-10 ${focuslessOutlineButtonClass}`}
              onClick={() => onAddScraper(actressName)}
            >
              <Plus className="h-4 w-4" />
              Add Scraper
            </Button>
          )}
          {showExpandedActions && detail && (
            <Button
              variant="outline"
              size="sm"
              className={`shrink-0 h-9 gap-1.5 text-sm sm:h-10 ${focuslessOutlineButtonClass}`}
              disabled={exportingAliasMagnets}
              onClick={() => void exportActressAliasMagnets()}
            >
              {exportingAliasMagnets ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Magnet className="h-4 w-4" />
              )}
              {exportingAliasMagnets ? 'Exporting...' : 'Export Magnets'}
            </Button>
          )}
          {!showExpandedActions && (
            <DropdownMenu open={desktopMoreOpen} onOpenChange={setDesktopMoreOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={`hidden shrink-0 h-9 gap-1.5 text-sm sm:flex sm:h-10 ${focuslessOutlineButtonClass}`}
                  aria-label="More actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onQueueAll && (
                  <DropdownMenuItem
                    className="cursor-pointer sm:hidden"
                    disabled={queueAllLoading}
                    onClick={() => {
                      onQueueAll()
                      setDesktopMoreOpen(false)
                    }}
                  >
                    {queueAllLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ListOrdered className="mr-2 h-4 w-4" />
                    )}
                    {queueAllLoading ? 'Queueing...' : 'Queue All'}
                  </DropdownMenuItem>
                )}
                {detail && onScheduleActress && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => {
                      onScheduleActress(detail)
                      setDesktopMoreOpen(false)
                    }}
                  >
                    <CalendarClock className="mr-2 h-4 w-4" />
                    Schedule
                  </DropdownMenuItem>
                )}
                {detail && actressName && onAddScraper && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => {
                      onAddScraper(actressName)
                      setDesktopMoreOpen(false)
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Scraper
                  </DropdownMenuItem>
                )}
                {detail && (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    disabled={exportingAliasMagnets}
                    onClick={() => {
                      void exportActressAliasMagnets()
                      setDesktopMoreOpen(false)
                    }}
                  >
                    {exportingAliasMagnets ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Magnet className="mr-2 h-4 w-4" />
                    )}
                    {exportingAliasMagnets ? 'Exporting...' : 'Export Magnets'}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <div className="relative w-full shrink-0 sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder="Video Code"
              className="h-9 w-full pl-9 pr-2 text-sm sm:h-10 sm:w-44"
              aria-label="Search by ID"
            />
          </div>
        </div>
        {selectedCodes.size > 0 && (
          <div className="flex flex-col gap-2 px-2 py-2 border-t border-border bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:px-3">
            <div className="flex items-center gap-2">
              {onDeselectAll && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${focuslessOutlineButtonClass}`}
                  onClick={onDeselectAll}
                  aria-label="Clear selected works"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {selectedCodes.size} selected
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {onSelectAll && (
                <Button
                  variant="outline"
                  size="sm"
                  className={`h-9 text-sm ${focuslessOutlineButtonClass}`}
                  onClick={onSelectAll}
                >
                  Select All
                </Button>
              )}
            {externalVideoTargets.length > 0 && selectedWorkLinks.length > 0 && (
              <DropdownMenu open={selectedLinksOpen} onOpenChange={setSelectedLinksOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-9 gap-1.5 text-sm ${focuslessOutlineButtonClass}`}
                    aria-label="Open selected links"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open All In...
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuLabel>Select sites</DropdownMenuLabel>
                  {externalVideoTargets.map((target) => (
                    <DropdownMenuCheckboxItem
                      key={target.label + target.url_template}
                      checked={selectedExternalTargetKeys.has(target.label + target.url_template)}
                      onCheckedChange={(checked) => toggleExternalTarget(target.label + target.url_template, checked === true)}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {target.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                  <DropdownMenuSeparator />
                  <div className="flex gap-1 px-1 pb-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8 flex-1 text-xs"
                      onClick={() => setSelectedExternalTargetKeys(new Set(externalVideoTargets.map((target) => target.label + target.url_template)))}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-8 flex-1 text-xs"
                      onClick={() => setSelectedExternalTargetKeys(new Set())}
                    >
                      Clear
                    </Button>
                  </div>
                  <div className="px-1 pb-1">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 w-full text-xs"
                      disabled={selectedExternalTargets.length === 0}
                      onClick={() => {
                        void openSelectedWorksInSelectedTargets()
                        setSelectedLinksOpen(false)
                      }}
                    >
                      Open in {selectedExternalTargets.length} selected {selectedExternalTargets.length === 1 ? 'site' : 'sites'}
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {detail && worksTotal > 0 && (
              <Button
                variant="outline"
                size="sm"
                className={`h-9 gap-1.5 text-sm ${focuslessOutlineButtonClass}`}
                disabled={exportingExcel}
                onClick={() => void exportMagnetWorkbook()}
              >
                {exportingExcel ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {exportingExcel ? 'Exporting...' : 'Export Excel'}
              </Button>
            )}
            {onQueue && (
              <Button
                variant="outline"
                size="sm"
                className={`h-9 gap-1.5 text-sm ${focuslessOutlineButtonClass}`}
                onClick={onQueue}
              >
                <Download className="h-4 w-4" />
                Queue
              </Button>
            )}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar p-2 min-h-0 sm:p-3">
        {worksLoading && !works ? (
          <div className={worksGridClass}>
            {Array.from({ length: worksPageSize }).map((_, i) => (
              <WorkCardSkeleton key={i} showCover={showCovers} />
            ))}
          </div>
        ) : filteredWorks.length > 0 ? (
          <div className={worksGridClass}>
            {filteredWorks.map((work) => (
              <ActressWorkCard
                key={work.content_id}
                work={work}
                actressName={actressName}
                defaultSavePath={defaultSavePath}
                showCover={showCovers}
                showTitle={showTitles}
                downloadStatus={downloadsMap.get(work.content_id) ?? undefined}
                queueItem={queueMap.get(work.content_id)}
                selected={selectedCodes.has(work.content_id)}
                onToggleSelect={(_, shiftKey) => onToggleSelect(work, shiftKey)}
                onDownloadAgain={onDownloadAgain && ['done', 'failed', 'skipped'].includes(queueMap.get(work.content_id)?.status ?? '')
                  ? () => onDownloadAgain(work.content_id, work.video_code ?? work.dvd_id ?? work.content_id, queueMap.get(work.content_id)!.id)
                  : undefined}
                onCancelDownload={onCancelDownload ? () => onCancelDownload(work.content_id) : undefined}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-12">
            {search.trim() ? `No works match "${search.trim()}".` : 'No works found for this actress.'}
          </p>
        )}
      </div>

      {worksTotalPages >= 1 && (
        <div className="flex-none flex flex-col gap-1.5 px-2 py-2 border-t border-border shrink-0 sm:px-3">
          <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div className="hidden items-center justify-center gap-2 sm:flex">
              <span className="text-xs text-muted-foreground whitespace-nowrap sm:text-sm">Per page:</span>
              <Select
                value={String(worksPageSize)}
                onValueChange={(val) => {
                  onWorksPageSizeChange(Number(val))
                  onWorksPageChange(0)
                }}
              >
                <SelectTrigger className={`h-8 w-[72px] text-sm ${focuslessOutlineButtonClass}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="min-w-0 w-[72px]">
                  {PAGE_SIZE_OPTIONS.map(n => (
                    <SelectItem key={n} value={String(n)} className="pl-2 [&>span:first-child]:hidden">{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 items-center justify-center gap-1 sm:gap-2">
              <button
                onClick={() => onWorksPageChange(0)}
                className={`p-2 rounded-md border text-sm font-medium ${focuslessOutlineButtonClass} ${worksPage === 0 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                disabled={worksPage === 0 || worksLoading}
                aria-label="First page"
              >
                <ChevronFirst className="w-4 h-4" />
              </button>
              <button
                onClick={() => onWorksPageChange(Math.max(0, worksPage - 1))}
                className={`p-2 rounded-md border text-sm font-medium ${focuslessOutlineButtonClass} ${worksPage === 0 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                disabled={worksPage === 0 || worksLoading}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                className={`min-w-9 rounded-md border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground sm:hidden ${focuslessOutlineButtonClass}`}
                disabled
                aria-label={`Page ${worksPage + 1} of ${worksTotalPages}`}
              >
                {worksPage + 1}
              </button>
              {(() => {
                const maxVisible = 5
                let start = Math.max(0, worksPage - Math.floor(maxVisible / 2))
                let end = start + maxVisible - 1
                if (end >= worksTotalPages) {
                  start = Math.max(0, worksTotalPages - maxVisible)
                  end = worksTotalPages - 1
                }
                const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i)
                return (
                  <>
                    {start > 0 && (
                      <>
                        <button onClick={() => onWorksPageChange(0)} className={`hidden px-3 py-1.5 rounded-md border text-sm font-medium sm:inline-flex ${focuslessOutlineButtonClass} bg-transparent hover:bg-muted`}>1</button>
                        {start > 1 && <span className="hidden px-3 py-1.5 text-sm sm:inline">...</span>}
                      </>
                    )}
                    {pages.map(p => (
                      <button
                        key={p}
                        onClick={() => onWorksPageChange(p)}
                        className={`hidden px-3 py-1.5 rounded-md border text-sm font-medium sm:inline-flex ${focuslessOutlineButtonClass} ${worksPage === p ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`}
                      >
                        {p + 1}
                      </button>
                    ))}
                    {end < worksTotalPages - 1 && (
                      <>
                        {end < worksTotalPages - 2 && <span className="hidden px-3 py-1.5 text-sm sm:inline">...</span>}
                        <button onClick={() => onWorksPageChange(worksTotalPages - 1)} className={`hidden px-3 py-1.5 rounded-md border text-sm font-medium sm:inline-flex ${focuslessOutlineButtonClass} bg-transparent hover:bg-muted`}>{worksTotalPages}</button>
                      </>
                    )}
                  </>
                )
              })()}
              <button
                onClick={() => onWorksPageChange(Math.min(worksTotalPages - 1, worksPage + 1))}
                className={`p-2 rounded-md border text-sm font-medium ${focuslessOutlineButtonClass} ${worksPage >= worksTotalPages - 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                disabled={worksPage >= worksTotalPages - 1 || worksLoading}
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => onWorksPageChange(worksTotalPages - 1)}
                className={`p-2 rounded-md border text-sm font-medium ${focuslessOutlineButtonClass} ${worksPage >= worksTotalPages - 1 ? 'bg-muted cursor-not-allowed' : 'bg-transparent hover:bg-muted'}`}
                disabled={worksPage >= worksTotalPages - 1 || worksLoading}
                aria-label="Last page"
              >
                <ChevronLast className="w-4 h-4" />
              </button>
            </div>
            <div className="text-center text-xs text-muted-foreground whitespace-nowrap sm:text-right">
              Showing {worksTotal === 0 ? 0 : worksPage * worksPageSize + 1}–{Math.min((worksPage + 1) * worksPageSize, worksTotal)} of {worksTotal.toLocaleString()} works
            </div>
          </div>
        </div>
      )}
    </>
  )
}
