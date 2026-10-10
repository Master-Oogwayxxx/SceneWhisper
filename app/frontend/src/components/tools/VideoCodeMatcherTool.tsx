import { useMemo, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Info, ListChecks, MoreVertical, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { fileApi } from '@/api/files'
import { toolsApi } from '@/api/tools'
import type { BookmarkVideoCheckItem, File } from '@/types/types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSettings } from '@/hooks/useSettings'
import { buildExternalVideoTargetUrl, isValidExternalVideoTarget } from '@/lib/external-video-targets'
import { MatchedFilesTable, parseVideoCodeList, type StatusFilter } from './toolUtils'

interface VideoCodeMatcherToolProps {
  onBack: () => void
}

const waitForRandomExternalLinkDelay = () => new Promise((resolve) => {
  window.setTimeout(resolve, Math.random() * 1000)
})

export function VideoCodeMatcherTool({ onBack }: VideoCodeMatcherToolProps) {
  const { settings } = useSettings()
  const [codeInput, setCodeInput] = useState('')
  const [codeItems, setCodeItems] = useState<BookmarkVideoCheckItem[]>([])
  const [codeSearch, setCodeSearch] = useState('')
  const [codeStatus, setCodeStatus] = useState<StatusFilter>('exists')
  const [isCheckingCodes, setIsCheckingCodes] = useState(false)
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(() => new Set())
  const [isCodePanelCollapsed, setIsCodePanelCollapsed] = useState(false)
  const [collapsedCodeGroups, setCollapsedCodeGroups] = useState<Set<string>>(() => new Set())
  const [selectedExternalTargetKeys, setSelectedExternalTargetKeys] = useState<Set<string>>(() => new Set())
  const [filesToDelete, setFilesToDelete] = useState<File[]>([])
  const [deleteFromDisk, setDeleteFromDisk] = useState(true)
  const [deleteFromDatabase, setDeleteFromDatabase] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [openedVideoCodes, setOpenedVideoCodes] = useState<Set<string>>(() => new Set())

  const filteredCodeItems = useMemo(() => {
    const query = codeSearch.trim().toLowerCase()
    return codeItems.filter((item) => {
      if (codeStatus === 'exists' && !item.fileExists) return false
      if (codeStatus === 'missing' && item.fileExists) return false
      if (!query) return true
      return (
        item.videoCode.toLowerCase().includes(query) ||
        item.matchedFiles.some((file) => file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query))
      )
    })
  }, [codeItems, codeSearch, codeStatus])

  const codeExistingCount = codeItems.filter((item) => item.fileExists).length
  const matchedCodeFileCount = codeItems.reduce((count, item) => count + item.matchedFiles.length, 0)
  const parsedCodeCount = useMemo(() => parseVideoCodeList(codeInput).length, [codeInput])
  const externalVideoTargets = useMemo(
    () => settings.external_video_targets.filter(isValidExternalVideoTarget),
    [settings.external_video_targets]
  )
  const selectedExternalTargets = useMemo(
    () => externalVideoTargets.filter((target) => selectedExternalTargetKeys.has(target.label + target.url_template)),
    [externalVideoTargets, selectedExternalTargetKeys]
  )
  const matchedRows = useMemo(() => (
    filteredCodeItems.flatMap((item) => item.matchedFiles.map((file) => ({
      item,
      file,
      rowId: `${item.videoCode}:${file.id}`,
    })))
  ), [filteredCodeItems])
  const selectedMatchedRows = useMemo(
    () => matchedRows.filter((row) => selectedMatchIds.has(row.rowId)),
    [matchedRows, selectedMatchIds]
  )
  const selectedVideoCodes = useMemo(
    () => Array.from(new Set(
      filteredCodeItems
        .filter((item) => {
          if (!item.matchedFiles.length) {
            return selectedMatchIds.has(`${item.videoCode}:missing`)
          }
          return item.matchedFiles.some((file) => selectedMatchIds.has(`${item.videoCode}:${file.id}`))
        })
        .map((item) => item.videoCode)
    )),
    [filteredCodeItems, selectedMatchIds]
  )

  const checkVideoCodes = async () => {
    const parsed = parseVideoCodeList(codeInput)
    if (!parsed.length) {
      setCodeItems([])
      toast.error('No video codes found')
      return
    }

    setIsCheckingCodes(true)
    try {
      const result = await toolsApi.checkBookmarkVideos(parsed)
      setCodeItems(result.items)
      setSelectedMatchIds(new Set())
      setCollapsedCodeGroups(new Set())
      setOpenedVideoCodes(new Set())
      toast.success(`Matched ${result.existing} of ${result.total} video code${result.total === 1 ? '' : 's'}`)
    } catch {
      toast.error('Failed to check video codes')
    } finally {
      setIsCheckingCodes(false)
    }
  }

  const handleOpenExternalVideoTarget = (urlTemplate: string, videoCode: string) => {
    setOpenedVideoCodes((prev) => new Set(prev).add(videoCode))
    window.open(buildExternalVideoTargetUrl({ label: '', url_template: urlTemplate }, videoCode), '_blank', 'noopener,noreferrer')
  }

  const openExternalVideoTargetsConsecutively = async (videoCode: string) => {
    setOpenedVideoCodes((prev) => new Set(prev).add(videoCode))
    const openedTabs: Window[] = []

    for (const target of externalVideoTargets) {
      const tab = window.open('about:blank', '_blank')
      if (!tab) {
        continue
      }

      try {
        tab.opener = null
      } catch {
        // Some browsers block reassignment; opening still works without it.
      }

      openedTabs.push(tab)
    }

    for (let index = 0; index < openedTabs.length; index += 1) {
      const tab = openedTabs[index]
      const target = externalVideoTargets[index]
      tab.location.href = buildExternalVideoTargetUrl(target, videoCode)
      if (index < openedTabs.length - 1) {
        await waitForRandomExternalLinkDelay()
      }
    }
  }

  const openVideoCodesInSelectedExternalTargets = async (videoCodes: string[]) => {
    setOpenedVideoCodes((prev) => new Set([...prev, ...videoCodes]))
    for (let codeIndex = 0; codeIndex < videoCodes.length; codeIndex += 1) {
      const videoCode = videoCodes[codeIndex]
      for (let targetIndex = 0; targetIndex < selectedExternalTargets.length; targetIndex += 1) {
        const target = selectedExternalTargets[targetIndex]
        window.open(buildExternalVideoTargetUrl(target, videoCode), '_blank', 'noopener,noreferrer')
        const isLast = codeIndex === videoCodes.length - 1 && targetIndex === selectedExternalTargets.length - 1
        if (!isLast) {
          await waitForRandomExternalLinkDelay()
        }
      }
    }
  }

  const toggleExternalTarget = (targetKey: string, checked: boolean) => {
    setSelectedExternalTargetKeys((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(targetKey)
      } else {
        next.delete(targetKey)
      }
      return next
    })
  }

  const openDeleteDialog = (files: File[]) => {
    const uniqueFiles = Array.from(new Map(files.map((file) => [file.id, file])).values())
    setFilesToDelete(uniqueFiles)
    setDeleteFromDisk(true)
    setDeleteFromDatabase(true)
  }

  const handleDeleteFiles = async () => {
    if (!filesToDelete.length || (!deleteFromDisk && !deleteFromDatabase)) return

    setIsDeleting(true)
    const results = await Promise.allSettled(
      filesToDelete.map((file) => fileApi.deleteFile(file.id, { deleteFromDisk, deleteFromDatabase }))
    )
    const deletedIds = new Set(
      filesToDelete.filter((_, index) => results[index].status === 'fulfilled').map((file) => file.id)
    )
    const failedCount = results.length - deletedIds.size

    if (deletedIds.size && deleteFromDatabase) {
      setCodeItems((prev) => prev.map((item) => {
        const matchedFiles = item.matchedFiles.filter((file) => !deletedIds.has(file.id))
        return { ...item, matchedFiles, fileExists: matchedFiles.length > 0 }
      }))
      setSelectedMatchIds((prev) => new Set(Array.from(prev).filter((rowId) => {
        const fileId = rowId.slice(rowId.indexOf(':') + 1)
        return !deletedIds.has(fileId)
      })))
    }

    if (failedCount === 0) {
      toast.success(`${deletedIds.size} ${deletedIds.size === 1 ? 'file' : 'files'} deleted`)
      setFilesToDelete([])
    } else if (deletedIds.size) {
      toast.error(`Deleted ${deletedIds.size} ${deletedIds.size === 1 ? 'file' : 'files'}; ${failedCount} failed`)
      setFilesToDelete(filesToDelete.filter((file) => !deletedIds.has(file.id)))
    } else {
      toast.error(`Failed to delete ${failedCount} ${failedCount === 1 ? 'file' : 'files'}`)
    }
    setIsDeleting(false)
  }

  const handleToggleMatchRow = (rowId: string, checked: boolean) => {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(rowId)
      } else {
        next.delete(rowId)
      }
      return next
    })
  }

  const handleToggleAllMatchRows = (rowIds: string[], checked: boolean) => {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev)
      for (const rowId of rowIds) {
        if (checked) {
          next.add(rowId)
        } else {
          next.delete(rowId)
        }
      }
      return next
    })
  }

  const toggleCodeGroup = (videoCode: string) => {
    setCollapsedCodeGroups((prev) => {
      const next = new Set(prev)
      if (next.has(videoCode)) {
        next.delete(videoCode)
      } else {
        next.add(videoCode)
      }
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background shadow sm:rounded-lg">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={onBack} title="Back to tools" aria-label="Back to tools" className="h-8 w-8 shrink-0 sm:h-9 sm:w-9">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary sm:h-9 sm:w-9">
            <ListChecks className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Video Code Matcher</h2>
            <p className="truncate text-xs text-muted-foreground">
              {codeItems.length ? `${codeExistingCount} of ${codeItems.length} codes exist, ${matchedCodeFileCount} matched files` : 'Paste video codes and scan indexed videos'}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
          <div className="scrollbar -mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:gap-2 sm:px-0 sm:pb-0">
            <div className="flex h-8 shrink-0 items-center px-1 text-xs font-medium text-muted-foreground sm:h-9 sm:text-sm">
              {selectedVideoCodes.length} selected
            </div>
            {selectedVideoCodes.length > 0 && externalVideoTargets.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 gap-2 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
                    <ExternalLink className="h-4 w-4" aria-hidden />
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
                      onClick={() => void openVideoCodesInSelectedExternalTargets(selectedVideoCodes)}
                    >
                      Open in {selectedExternalTargets.length} selected {selectedExternalTargets.length === 1 ? 'site' : 'sites'}
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {selectedMatchedRows.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => openDeleteDialog(selectedMatchedRows.map((row) => row.file))}
                className="h-8 shrink-0 gap-2 border-destructive/50 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive sm:h-9 sm:px-3 sm:text-sm"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete selected
              </Button>
            )}
            {(['all', 'exists', 'missing'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={codeStatus === value ? 'default' : 'outline'}
                onClick={() => setCodeStatus(value)}
                className="h-8 shrink-0 px-2.5 text-xs capitalize sm:h-9 sm:px-3 sm:text-sm"
              >
                {value}
              </Button>
            ))}
            {codeStatus !== 'missing' && matchedRows.length > 0 && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => setCollapsedCodeGroups(new Set())} className="h-8 shrink-0 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
                  Expand all
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setCollapsedCodeGroups(new Set(filteredCodeItems.filter((item) => item.matchedFiles.length > 0).map((item) => item.videoCode)))} className="h-8 shrink-0 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
                  Collapse all
                </Button>
              </>
            )}
          </div>
          <div className="relative min-w-0 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={codeSearch} onChange={(event) => setCodeSearch(event.target.value)} placeholder="Search matches" className="h-9 pl-9 text-sm sm:h-10" />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className={`shrink-0 border-b border-border p-3 lg:border-b-0 lg:border-r ${isCodePanelCollapsed ? 'lg:w-14' : 'lg:w-80 xl:w-96'}`}>
          {isCodePanelCollapsed ? (
            <div className="flex h-full min-h-0 items-center justify-between gap-3 lg:flex-col lg:justify-start">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setIsCodePanelCollapsed(false)}
                title="Expand video codes"
                aria-label="Expand video codes"
                className="h-8 w-8 shrink-0"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
              <div className="min-w-0 flex-1 text-xs font-medium text-muted-foreground lg:[writing-mode:vertical-rl]">
                Video codes
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <label htmlFor="video-code-matcher-input" className="text-sm font-medium">Video codes</label>
                  <p className="text-xs text-muted-foreground">
                    {parsedCodeCount ? `${parsedCodeCount} code${parsedCodeCount === 1 ? '' : 's'} ready to check` : 'Paste one code per line'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsCodePanelCollapsed(true)}
                  title="Collapse video codes"
                  aria-label="Collapse video codes"
                  className="h-8 w-8 shrink-0"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <Textarea
                id="video-code-matcher-input"
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value)}
                placeholder={`ABP-123
XYZ-456
SSIS789`}
                className="min-h-40 flex-1 resize-none font-mono text-sm lg:min-h-0"
              />
              <Button type="button" onClick={() => void checkVideoCodes()} disabled={isCheckingCodes} className="h-9 w-full gap-2">
                <RefreshCw className={`h-4 w-4 ${isCheckingCodes ? 'animate-spin' : ''}`} aria-hidden />
                Check Codes
              </Button>
            </div>
          )}
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          <MatchedFilesTable
              items={filteredCodeItems}
              emptyMessage={codeItems.length ? (codeStatus === 'missing' ? 'No missing codes found' : 'No matched files found') : 'Paste video codes and run Check'}
              selectedRowIds={selectedMatchIds}
              onToggleRow={handleToggleMatchRow}
              onToggleAllRows={handleToggleAllMatchRows}
              groupByCode
              collapsedCodeGroups={collapsedCodeGroups}
              onToggleCodeGroup={toggleCodeGroup}
              showFps={false}
              showCodec={false}
              openedCodeGroups={openedVideoCodes}
              showParentDirectoryOnly
              renderRowActions={({ item, file }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Open actions for ${item.videoCode}`}>
                      <MoreVertical className="h-4 w-4" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {externalVideoTargets.length > 0 && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger className="cursor-pointer">
                          <div className="flex items-center gap-2">
                            <Info className="h-4 w-4" aria-hidden />
                            Open in
                          </div>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {externalVideoTargets.length > 1 && (
                            <DropdownMenuItem className="cursor-pointer" onClick={() => void openExternalVideoTargetsConsecutively(item.videoCode)}>
                              All sites
                            </DropdownMenuItem>
                          )}
                          {externalVideoTargets.map((target) => (
                            <DropdownMenuItem key={target.label + target.url_template} className="cursor-pointer" onClick={() => handleOpenExternalVideoTarget(target.url_template, item.videoCode)}>
                              {target.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => openDeleteDialog([file])}>
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              renderRowContextMenuContent={({ item, file }) => (
                <>
                  {externalVideoTargets.length > 0 && (
                    <ContextMenuSub>
                      <ContextMenuSubTrigger className="cursor-pointer">
                        <div className="flex items-center gap-2">
                          <Info className="h-4 w-4" aria-hidden />
                          Open in
                        </div>
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        {externalVideoTargets.length > 1 && (
                          <ContextMenuItem className="cursor-pointer" onClick={() => void openExternalVideoTargetsConsecutively(item.videoCode)}>
                            All sites
                          </ContextMenuItem>
                        )}
                        {externalVideoTargets.map((target) => (
                          <ContextMenuItem key={target.label + target.url_template} className="cursor-pointer" onClick={() => handleOpenExternalVideoTarget(target.url_template, item.videoCode)}>
                            {target.label}
                          </ContextMenuItem>
                        ))}
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                  )}
                  <ContextMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={() => openDeleteDialog([file])}>
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                    Delete
                  </ContextMenuItem>
                </>
              )}
          />
        </div>
      </div>

      <AlertDialog
        open={filesToDelete.length > 0}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setFilesToDelete([])
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{filesToDelete.length === 1 ? 'Delete file?' : `Delete ${filesToDelete.length} files?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {filesToDelete.length === 1
                ? <>Choose where to delete &ldquo;{filesToDelete[0]?.name}&rdquo;. This action cannot be undone.</>
                : <>Choose where to delete the selected files. This action cannot be undone.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={deleteFromDisk} onCheckedChange={(checked) => setDeleteFromDisk(checked === true)} />
              <span className="leading-5">Delete {filesToDelete.length === 1 ? 'file' : 'files'} on disk</span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox checked={deleteFromDatabase} onCheckedChange={(checked) => setDeleteFromDatabase(checked === true)} />
              <span className="leading-5">Delete {filesToDelete.length === 1 ? 'record' : 'records'} in database</span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting || (!deleteFromDisk && !deleteFromDatabase)}
              onClick={(event) => {
                event.preventDefault()
                void handleDeleteFiles()
              }}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
