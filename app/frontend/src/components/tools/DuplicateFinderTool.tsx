import { useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, Layers3, Play, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { fileApi } from '@/api/files'
import type { File } from '@/types/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { SceneViewerModal } from '@/components/SceneViewerModal'
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
import { formatBytes, formatDate, resolutionLabel } from './toolUtils'

interface DuplicateFinderToolProps {
  onBack: () => void
}

interface DuplicateFileNameGroup {
  fileName: string
  files: File[]
  resolutions: string[]
  formats: string[]
  hasSubtitles: boolean
  hasSplits: boolean
  hasDeleted: boolean
}

function parentDirectoryName(path: string) {
  const parts = path.replace(/[\\/]+/g, '/').split('/').filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 2] : ''
}

function createdTimestamp(file: File) {
  const timestamp = file.created_at ? new Date(file.created_at).getTime() : Number.POSITIVE_INFINITY
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp
}

function buildDuplicateGroups(files: File[]): DuplicateFileNameGroup[] {
  const grouped = new Map<string, File[]>()

  for (const file of files) {
    grouped.set(file.name, [...(grouped.get(file.name) ?? []), file])
  }

  return Array.from(grouped.entries())
    .map(([fileName, groupFiles]) => ({
      fileName,
      files: groupFiles.sort((a, b) => createdTimestamp(a) - createdTimestamp(b) || a.path.localeCompare(b.path)),
      resolutions: Array.from(new Set(groupFiles.map(resolutionLabel))).sort(),
      formats: Array.from(new Set(groupFiles.map((file) => file.format || 'Unknown'))).sort(),
      hasSubtitles: groupFiles.some((file) => file.has_subtitle || file.file_type === 'subtitle'),
      hasSplits: groupFiles.some((file) => file.has_split || Boolean(file.parent_id)),
      hasDeleted: groupFiles.some((file) => file.is_deleted),
    }))
    .filter((group) => group.files.length > 1)
    .sort((a, b) => b.files.length - a.files.length || a.fileName.localeCompare(b.fileName))
}

export function DuplicateFinderTool({ onBack }: DuplicateFinderToolProps) {
  const [duplicateFiles, setDuplicateFiles] = useState<File[]>([])
  const [duplicateSearch, setDuplicateSearch] = useState('')
  const [collapsedDuplicateGroups, setCollapsedDuplicateGroups] = useState<Set<string>>(() => new Set())
  const [isLoadingDuplicates, setIsLoadingDuplicates] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<File | null>(null)
  const [fileToPlay, setFileToPlay] = useState<File | null>(null)
  const [deleteFromDisk, setDeleteFromDisk] = useState(true)
  const [deleteFromDatabase, setDeleteFromDatabase] = useState(true)

  const duplicateGroups = useMemo(() => buildDuplicateGroups(duplicateFiles), [duplicateFiles])
  const filteredDuplicateGroups = useMemo(() => {
    const query = duplicateSearch.trim().toLowerCase()
    return duplicateGroups.filter((group) => {
      if (!query) return true
      return group.fileName.toLowerCase().includes(query) || group.files.some((file) =>
        file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query)
      )
    })
  }, [duplicateGroups, duplicateSearch])

  const loadDuplicateFiles = async () => {
    setIsLoadingDuplicates(true)
    try {
      const pageSize = 10000
      const firstPage = await fileApi.getFiles({
        page: 1,
        limit: pageSize,
        search: '',
        type: 'video',
        sortBy: 'name',
        sortDir: 'asc',
      })

      const allFiles = [...firstPage.files]
      for (let page = 2; page <= firstPage.totalPages; page += 1) {
        const result = await fileApi.getFiles({
          page,
          limit: pageSize,
          search: '',
          type: 'video',
          sortBy: 'name',
          sortDir: 'asc',
        })
        allFiles.push(...result.files)
      }

      setDuplicateFiles(allFiles)
      setCollapsedDuplicateGroups(new Set())
      toast.success(`Analyzed ${allFiles.length} indexed video file${allFiles.length === 1 ? '' : 's'}`)
    } catch {
      toast.error('Failed to load indexed videos')
    } finally {
      setIsLoadingDuplicates(false)
    }
  }

  const toggleDuplicateGroup = (groupName: string) => {
    setCollapsedDuplicateGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) {
        next.delete(groupName)
      } else {
        next.add(groupName)
      }
      return next
    })
  }

  const handleDeleteDuplicateFile = async () => {
    if (!fileToDelete || (!deleteFromDisk && !deleteFromDatabase)) return

    try {
      await fileApi.deleteFile(fileToDelete.id, { deleteFromDisk, deleteFromDatabase })
      if (deleteFromDatabase) {
        setDuplicateFiles((prev) => prev.filter((file) => file.id !== fileToDelete.id))
      }
      toast.success('File deleted')
      setFileToDelete(null)
    } catch {
      toast.error('Failed to delete file')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background shadow sm:rounded-lg">
      <div className="flex flex-col gap-3 border-b border-border px-3 py-3 lg:flex-row lg:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={onBack} title="Back to tools" aria-label="Back to tools" className="h-8 w-8 shrink-0 sm:h-9 sm:w-9">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary sm:h-9 sm:w-9">
            <Layers3 className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">Duplicate Finder</h2>
            <p className="truncate text-xs text-muted-foreground">
              {duplicateFiles.length ? `${filteredDuplicateGroups.length} duplicate groups from ${duplicateFiles.length} indexed videos` : 'Find duplicate local videos by exact filename'}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:justify-end">
          <div className="scrollbar -mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:gap-2 sm:px-0 sm:pb-0">
            <Button type="button" size="sm" onClick={() => void loadDuplicateFiles()} disabled={isLoadingDuplicates} className="h-8 shrink-0 gap-2 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
              <RefreshCw className={`h-4 w-4 ${isLoadingDuplicates ? 'animate-spin' : ''}`} aria-hidden />
              Analyze
            </Button>
            {filteredDuplicateGroups.length > 0 && (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => setCollapsedDuplicateGroups(new Set())} className="h-8 shrink-0 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
                  Expand all
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setCollapsedDuplicateGroups(new Set(filteredDuplicateGroups.map((group) => group.fileName)))} className="h-8 shrink-0 px-2.5 text-xs sm:h-9 sm:px-3 sm:text-sm">
                  Collapse all
                </Button>
              </>
            )}
          </div>
          <div className="relative min-w-0 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={duplicateSearch} onChange={(event) => setDuplicateSearch(event.target.value)} placeholder="Search filenames or paths" className="h-9 pl-9 text-sm sm:h-10" />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar p-2 sm:p-3">
        {filteredDuplicateGroups.length ? (
          <div className="space-y-3">
            {filteredDuplicateGroups.map((group) => {
              const isCollapsed = collapsedDuplicateGroups.has(group.fileName)
              return (
              <article key={group.fileName} className="rounded-md border border-border bg-background p-3 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <button
                    type="button"
                    onClick={() => toggleDuplicateGroup(group.fileName)}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-expanded={!isCollapsed}
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                      {isCollapsed ? <ChevronRight className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                    </span>
                    <span className="min-w-0">
                      <span className="block break-all font-mono text-sm font-semibold">{group.fileName}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {group.files.length} files
                      </span>
                    </span>
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[1240px] border-collapse text-left text-sm">
                      <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                        <tr>
                          <th className="w-12 px-2 py-1.5 font-semibold">#</th>
                          <th className="px-2 py-1.5 font-semibold">File</th>
                          <th className="w-28 px-2 py-1.5 font-semibold">Size</th>
                          <th className="w-28 px-2 py-1.5 font-semibold">Duration</th>
                          <th className="w-24 px-2 py-1.5 font-semibold">Resolution</th>
                          <th className="w-20 px-2 py-1.5 font-semibold">FPS</th>
                          <th className="w-24 px-2 py-1.5 font-semibold">Format</th>
                          <th className="w-28 px-2 py-1.5 font-semibold">Codec</th>
                          <th className="w-40 px-2 py-1.5 font-semibold">Created</th>
                          <th className="w-40 px-2 py-1.5 font-semibold">Modified</th>
                          <th className="w-24 px-2 py-1.5 text-right font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.files.map((file, fileIndex) => (
                          <tr
                            key={file.id}
                            className="border-b border-border/60 transition-colors last:border-b-0 hover:bg-primary/10"
                          >
                            <td className="px-2 py-2 align-top">
                              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-secondary px-1.5 text-xs font-semibold text-secondary-foreground">
                                {fileIndex + 1}
                              </span>
                            </td>
                            <td className="min-w-0 px-2 py-2">
                              <div className="truncate font-medium" title={file.name}>{file.name}</div>
                              <div className="mt-1 truncate text-xs text-muted-foreground" title={file.path}>{parentDirectoryName(file.path)}</div>
                            </td>
                            <td className="px-2 py-2 align-top text-muted-foreground">{formatBytes(file.size)}</td>
                            <td className="px-2 py-2 align-top text-muted-foreground">{file.duration || 'Unknown'}</td>
                            <td className="px-2 py-2 align-top text-muted-foreground">{resolutionLabel(file)}</td>
                            <td className="px-2 py-2 align-top text-muted-foreground">{file.fps ? file.fps.toFixed(2) : 'Unknown'}</td>
                            <td className="px-2 py-2 align-top uppercase text-muted-foreground">{file.format?.replace('.', '') || 'Unknown'}</td>
                            <td className="px-2 py-2 align-top text-muted-foreground">{file.codec || 'Unknown'}</td>
                            <td className="px-2 py-2 align-top text-muted-foreground">{formatDate(file.created_at)}</td>
                            <td className="px-2 py-2 align-top text-muted-foreground">{formatDate(file.modified_at)}</td>
                            <td className="px-2 py-2 align-top">
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setFileToPlay(file)}
                                  title="Play video"
                                  aria-label={`Play ${file.name}`}
                                >
                                  <Play className="h-4 w-4" aria-hidden />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    setDeleteFromDisk(true)
                                    setDeleteFromDatabase(true)
                                    setFileToDelete(file)
                                  }}
                                  title="Delete file"
                                  aria-label={`Delete ${file.name}`}
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
              )
            })}
          </div>
        ) : (
          <div className="px-3 py-14 text-center text-sm text-muted-foreground">
            {duplicateFiles.length ? 'No duplicate groups found' : 'Run Analyze to scan indexed videos'}
          </div>
        )}
      </div>

      <AlertDialog
        open={Boolean(fileToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setFileToDelete(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose where to delete "{fileToDelete?.name}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={deleteFromDisk}
                onCheckedChange={(checked) => setDeleteFromDisk(checked === true)}
              />
              <span className="leading-5">Delete file on disk</span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={deleteFromDatabase}
                onCheckedChange={(checked) => setDeleteFromDatabase(checked === true)}
              />
              <span className="leading-5">Delete record in database</span>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!deleteFromDisk && !deleteFromDatabase}
              onClick={() => void handleDeleteDuplicateFile()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SceneViewerModal
        file={fileToPlay}
        isOpen={Boolean(fileToPlay)}
        onClose={() => setFileToPlay(null)}
      />
    </div>
  )
}
