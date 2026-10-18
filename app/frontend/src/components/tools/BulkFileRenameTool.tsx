import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, FilePenLine, Loader2 } from 'lucide-react'
import { fileApi } from '@/api/files'
import { toolsApi, type BulkRenameItem, type BulkRenameOptions } from '@/api/tools'
import { formatBytes, formatDate } from './toolUtils'
import type { DirectoryRecord } from '@/types/types'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const renameChecks = [
  ['extract_video_code', 'Extract video code'],
  ['remove_resolution', 'Remove resolution text'],
  ['remove_miscellaneous', 'Remove miscellaneous characters'],
  ['remove_non_english', 'Remove non-English characters'],
  ['normalize_separators', 'Normalize separators'],
  ['remove_website', 'Remove website from file name'],
  ['remove_dates', 'Remove dates from file name'],
  ['hide_split_videos', 'Hide split videos'],
] as const

export function BulkFileRenameTool({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient()
  const [directories, setDirectories] = useState<DirectoryRecord[]>([])
  const [directoryIds, setDirectoryIds] = useState<string[]>([])
  const [items, setItems] = useState<BulkRenameItem[]>([])
  const [lastAppliedItems, setLastAppliedItems] = useState<BulkRenameItem[] | null>(null)
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([])
  const [lastSelectedFileId, setLastSelectedFileId] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: 'originalName' | 'createdAt' | 'size'; direction: 'asc' | 'desc' }>({ key: 'originalName', direction: 'asc' })
  const [busy, setBusy] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewingFileIds, setPreviewingFileIds] = useState<string[]>([])
  const previewRequestIdRef = useRef(0)
  const [message, setMessage] = useState('')
  const [directoryDialogOpen, setDirectoryDialogOpen] = useState(true)
  const [allDirectories, setAllDirectories] = useState(true)
  const [renameItem, setRenameItem] = useState<BulkRenameItem | null>(null)
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [options, setOptions] = useState<BulkRenameOptions>({
    directory_ids: [],
    remove_miscellaneous: false,
    remove_non_english: false,
    remove_resolution: false,
    extract_video_code: false,
    normalize_separators: false,
    remove_release_tags: false,
    remove_website: false,
    remove_dates: false,
    find_text: '',
    replace_text: '',
    remove_first_n: 0,
    remove_last_n: 0,
    translate_to_english: false,
    hide_split_videos: true,
  })
  const sortedItems = useMemo(() => [...items].sort((a, b) => {
    const aValue = a[sort.key] ?? ''
    const bValue = b[sort.key] ?? ''
    const comparison = typeof aValue === 'number' && typeof bValue === 'number'
      ? aValue - bValue
      : String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: 'base' })
    return sort.direction === 'asc' ? comparison : -comparison
  }), [items, sort])
  const toggleSort = (key: typeof sort.key) => setSort((current) => current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' })
  const sortIcon = (key: typeof sort.key) => sort.key === key
    ? (sort.direction === 'asc' ? <ArrowUp className='h-3.5 w-3.5' /> : <ArrowDown className='h-3.5 w-3.5' />)
    : <ArrowUpDown className='h-3.5 w-3.5 opacity-50' />

  useEffect(() => {
    fileApi
      .getDirectories()
      .then(setDirectories)
      .catch(() => setMessage('Unable to load directories'))
  }, [])
  useEffect(() => {
    const handle = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target instanceof HTMLInputElement) return
      const row = target.closest('tr')
      const table = row?.closest('table')
      if (!row || !table || row.rowIndex < 1) return
      const item = sortedItems[row.rowIndex - 1]
      if (item) selectFile(item.fileId, event.shiftKey)
    }
    document.addEventListener('click', handle)
    return () => document.removeEventListener('click', handle)
  }, [items, lastSelectedFileId, sortedItems])
  const updateOption = (key: keyof BulkRenameOptions, value: boolean) => setOptions((current) => ({
    ...current,
    [key]: value,
    // Code-only extraction would discard the translated title from the preview.
    ...(key === 'translate_to_english' && value ? { extract_video_code: false } : {}),
  }))
  const toggleDirectory = (id: string) => {
    setAllDirectories(false)
    setDirectoryIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  }
  const selectFile = (fileId: string, shiftKey: boolean) => {
    const currentIndex = items.findIndex((item) => item.fileId === fileId)
    const lastIndex = lastSelectedFileId ? items.findIndex((item) => item.fileId === lastSelectedFileId) : -1
    if (shiftKey && currentIndex >= 0 && lastIndex >= 0) {
      const range = items.slice(Math.min(currentIndex, lastIndex), Math.max(currentIndex, lastIndex) + 1).map((item) => item.fileId)
      setSelectedFileIds((current) => Array.from(new Set([...current, ...range])))
    } else setSelectedFileIds((current) => (current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]))
    setLastSelectedFileId(fileId)
  }
  const preview = async (optionsOverride?: BulkRenameOptions, selectionOverride?: string[]) => {
    const requestId = ++previewRequestIdRef.current
    const previousSelection = new Set(selectionOverride ?? selectedFileIds)
    if (!previousSelection.size && items.length) {
      setItems((current) => current.map((item) => ({ ...item, newName: item.originalName })))
      setBusy(false)
      setPreviewing(false)
      setPreviewingFileIds([])
      return
    }
    setBusy(true)
    setPreviewing(true)
    setPreviewingFileIds(Array.from(previousSelection))
    setMessage('')
    try {
      const next = { ...(optionsOverride ?? options), directory_ids: allDirectories ? [] : directoryIds, file_ids: previousSelection.size ? Array.from(previousSelection) : undefined }
      if (optionsOverride) setOptions(next)
      const nextItems = await toolsApi.previewBulkRename(next)
      if (requestId !== previewRequestIdRef.current) return
      setItems((current) => {
        if (!previousSelection.size) return nextItems
        const byId = new Map(nextItems.map((item) => [item.fileId, item]))
        return current.map((item) => byId.get(item.fileId) ?? item)
      })
      setSelectedFileIds(nextItems.filter((item) => previousSelection.has(item.fileId)).map((item) => item.fileId))
      setLastSelectedFileId(null)
    } catch (error) {
      if (requestId !== previewRequestIdRef.current) return
      const detail = (error as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setMessage(detail ? `Preview failed: ${detail}` : 'Preview failed')
    } finally {
      if (requestId !== previewRequestIdRef.current) return
      setBusy(false)
      setPreviewing(false)
      setPreviewingFileIds([])
    }
  }
  const updateHideSplitVideos = async (value: boolean) => {
    const next = { ...options, hide_split_videos: value }
    setOptions(next)
  }
  const renameFile = async () => {
    if (!renameItem || !renameValue.trim() || renameValue === renameItem.originalName) return
    const extension = renameItem.originalName.match(/(\.[^.]*)$/)?.[1] ?? ''
    const newName = renameValue.trim().endsWith(extension) ? renameValue.trim() : `${renameValue.trim()}${extension}`
    const originalStem = extension ? renameItem.originalName.slice(0, -extension.length) : renameItem.originalName
    const newStem = extension ? newName.slice(0, -extension.length) : newName
    setBusy(true)
    try {
      const [result] = await Promise.all([toolsApi.applyBulkRename({ ...options, directory_ids: [], file_ids: [renameItem.fileId], find_text: originalStem, replace_text: newStem, extract_video_code: false, remove_resolution: false, remove_miscellaneous: false, normalize_separators: false, remove_release_tags: false, remove_website: false, remove_dates: false, hide_split_videos: false }), queryClient.invalidateQueries({ queryKey: ['files'] }), queryClient.invalidateQueries({ queryKey: ['files-grouped'] }), queryClient.invalidateQueries({ queryKey: ['files-tree-folder'] })])
      const updated = result[0]
      if (updated) setItems((current) => current.map((item) => item.fileId === updated.fileId ? updated : item))
      setRenameItem(null)
      setMessage('File renamed')
    } catch {
      setMessage('Rename failed')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (directoryDialogOpen) return
    const handle = window.setTimeout(() => {
      void preview()
    }, 300)
    return () => window.clearTimeout(handle)
  }, [options, allDirectories, directoryIds, selectedFileIds, directoryDialogOpen])
  const apply = async () => {
    const selected = items.filter((item) => selectedFileIds.includes(item.fileId))
    if (!selected.length) return
    const appliedFileIds = [...selectedFileIds]
    setBusy(true)
    try {
      const result = await toolsApi.applyBulkRename({ ...options, directory_ids: allDirectories ? [] : directoryIds, file_ids: appliedFileIds })
      const byId = new Map(result.map((item) => [item.fileId, item]))
      setItems((current) => current.map((item) => byId.get(item.fileId) ?? item))
      setLastAppliedItems(result.filter((item) => item.status === 'renamed'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files'] }),
        queryClient.invalidateQueries({ queryKey: ['files-grouped'] }),
        queryClient.invalidateQueries({ queryKey: ['files-tree-folder'] }),
        queryClient.invalidateQueries({ queryKey: ['directories'] }),
        queryClient.invalidateQueries({ queryKey: ['tree-directory-file-counts'] }),
      ])
      await preview(undefined, appliedFileIds)
      setMessage('Rename complete')
    } catch {
      setMessage('Rename failed')
    } finally {
      setBusy(false)
    }
  }
  const selectedRenameCount = items.filter((item) => selectedFileIds.includes(item.fileId) && item.originalName !== item.newName).length
  const undo = async () => {
    if (!lastAppliedItems?.length) return
    setBusy(true)
    try {
      const result = await toolsApi.undoBulkRename(lastAppliedItems)
      const byId = new Map(result.map((item) => [item.fileId, item]))
      setItems((current) => current.map((item) => byId.get(item.fileId) ?? item))
      setLastAppliedItems(null)
      setMessage('Undo complete')
    } catch {
      setMessage('Undo failed')
    } finally {
      setBusy(false)
    }
  }
  const confirmDirectories = async () => {
    setDirectoryDialogOpen(false)
  }
  const resetOptions = () => setOptions({
    directory_ids: [],
    remove_miscellaneous: false,
    remove_non_english: false,
    remove_resolution: false,
    extract_video_code: false,
    normalize_separators: false,
    remove_release_tags: false,
    remove_website: false,
    remove_dates: false,
    find_text: '',
    replace_text: '',
    remove_first_n: 0,
    remove_last_n: 0,
    translate_to_english: false,
    hide_split_videos: true,
  })

  return (
    <div className='accent-primary flex h-full min-h-0 flex-col overflow-hidden bg-background shadow sm:rounded-lg'>
      <div className='flex items-center gap-3 border-b border-border px-3 py-3'>
        <button type='button' onClick={onBack} className='rounded p-1 hover:bg-secondary' aria-label='Back'>
          <ArrowLeft className='h-4 w-4' />
        </button>
        <FilePenLine className='h-5 w-5 text-primary' />
        <div>
          <h2 className='text-base font-semibold'>Bulk File Rename</h2>
          <p className='text-xs text-muted-foreground'>Preview safe filename cleanup before applying it.</p>
        </div>
      </div>
      <div className='grid h-full min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)] lg:items-start'>
        <div className='flex h-full min-h-0 flex-col overflow-y-auto rounded-md border border-border p-3 scrollbar lg:col-start-2 lg:row-start-1'>
          <div className='flex items-center justify-between'>
            <div>
              <p className='text-sm font-medium'>Rename options</p>
              <p className='text-xs text-muted-foreground'>{allDirectories ? 'All directories' : `${directoryIds.length} directories selected`}</p>
            </div>
            <button type='button' onClick={() => setDirectoryDialogOpen(true)} className='rounded border border-border px-3 py-2 text-sm'>
              Change directories
            </button>
          </div>
          <div className='mt-3 grid gap-2'>
            <label className='text-sm'>
              <span className='mb-1 block font-medium'>Find text</span>
              <input
                value={options.find_text}
                onChange={(event) => setOptions((current) => ({ ...current, find_text: event.target.value }))}
                placeholder='Text to find'
                className='w-full rounded border border-input bg-background px-2 py-1.5'
              />
            </label>
            <label className='text-sm'>
              <span className='mb-1 block font-medium'>Replace with</span>
              <input
                value={options.replace_text}
                onChange={(event) => setOptions((current) => ({ ...current, replace_text: event.target.value }))}
                placeholder='Replacement text'
                className='w-full rounded border border-input bg-background px-2 py-1.5'
              />
            </label>
            <div className='border-t-2 border-border' />
            <label className='text-sm'>
              <span className='mb-1 block font-medium'>Remove first N characters</span>
              <input type='number' min='0' value={options.remove_first_n} onChange={(event) => setOptions((current) => ({ ...current, remove_first_n: Math.max(0, Number(event.target.value) || 0) }))} className='w-full rounded border border-input bg-background px-2 py-1.5' />
            </label>
            <label className='text-sm'>
              <span className='mb-1 block font-medium'>Remove last N characters</span>
              <input type='number' min='0' value={options.remove_last_n} onChange={(event) => setOptions((current) => ({ ...current, remove_last_n: Math.max(0, Number(event.target.value) || 0) }))} className='w-full rounded border border-input bg-background px-2 py-1.5' />
            </label>
            <div className='border-t-2 border-border' />
            <label className='flex items-center gap-2 text-sm'>
              <input type='checkbox' checked={options.translate_to_english} onChange={(event) => updateOption('translate_to_english', event.target.checked)} />
              Translate Japanese to English
            </label>
            {renameChecks.map(([key, label]) => (
              <label key={key} className='flex items-center gap-2 text-sm'>
                <input
                  type='checkbox'
                  checked={options[key]}
                  onChange={(event) => key === 'hide_split_videos' ? void updateHideSplitVideos(event.target.checked) : updateOption(key, event.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          <div className='mt-auto flex flex-col gap-2 pt-3'>
            <button type='button' onClick={resetOptions} disabled={busy} className='rounded border border-border px-3 py-2 text-sm'>
              Reset
            </button>
            <button type='button' onClick={() => void undo()} disabled={busy || !lastAppliedItems?.length} className='rounded border border-border bg-secondary px-3 py-2 text-sm hover:bg-secondary/80 disabled:opacity-50'>
              Undo
            </button>
            <button
              type='button'
              onClick={() => setApplyConfirmOpen(true)}
              disabled={busy || !selectedFileIds.some((id) => items.some((item) => item.fileId === id && item.originalName !== item.newName))}
              className='rounded bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
            >
              Apply
            </button>
          </div>
        </div>
        <div className='min-h-0 min-w-0 self-stretch overflow-x-auto overflow-y-auto rounded-md border border-border scrollbar lg:col-start-1 lg:row-start-1'>
          <table className='w-full min-w-[64rem] table-fixed text-left text-sm'>
            <thead className='[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:overflow-hidden [&_th]:bg-background [&_th]:shadow-[inset_0_-2px_0_hsl(var(--border))]'>
              <tr>
                <th className='w-[5%] p-3'>
                  <input
                    type='checkbox'
                    aria-label='Select all files'
                    checked={items.length > 0 && selectedFileIds.length === items.length}
                    onChange={(event) => {
                      const nextSelection = event.target.checked ? items.map((item) => item.fileId) : []
                      setSelectedFileIds(nextSelection)
                      setLastSelectedFileId(null)
                      if (event.target.checked) void preview(undefined, nextSelection)
                      else setItems((current) => current.map((item) => ({ ...item, newName: item.originalName })))
                    }}
                  />
                </th>
                <th className='w-[35%] p-3 font-semibold'><button type='button' onClick={() => toggleSort('originalName')} className='inline-flex items-center gap-1'>Original file name {sortIcon('originalName')}</button></th>
                <th className='w-[35%] p-3 font-semibold'>
                  <span className='inline-flex items-center gap-2'>
                    Preview name
                    {previewing && <Loader2 className='h-3.5 w-3.5 animate-spin text-muted-foreground' aria-label='Updating preview' />}
                  </span>
                </th>
                <th className='w-[15%] p-3 font-semibold'><button type='button' onClick={() => toggleSort('createdAt')} className='inline-flex items-center gap-1'>Created {sortIcon('createdAt')}</button></th>
                <th className='w-[10%] p-3 font-semibold'><button type='button' onClick={() => toggleSort('size')} className='inline-flex items-center gap-1'>Size {sortIcon('size')}</button></th>
              </tr>
            </thead>
            <tbody className='[&_td]:overflow-hidden'>
              {sortedItems.map((item) => (
                <tr key={item.fileId} onContextMenu={(event) => { event.preventDefault(); setRenameItem(item); setRenameValue(item.originalName.replace(/\.[^.]+$/, '')) }} className='border-b border-border last:border-0'>
                  <td className='p-3 align-top'>
                    <input
                      type='checkbox'
                      aria-label={`Select ${item.originalName}`}
                      checked={selectedFileIds.includes(item.fileId)}
                      onChange={(event) => {
                        const shiftKey = event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey
                        selectFile(item.fileId, shiftKey)
                        if (options.translate_to_english) {
                          const nextSelection = event.target.checked
                            ? Array.from(new Set([...selectedFileIds, item.fileId]))
                            : selectedFileIds.filter((id) => id !== item.fileId)
                          void preview(undefined, nextSelection)
                        }
                        if (!event.target.checked) {
                          setItems((current) => current.map((currentItem) => currentItem.fileId === item.fileId ? { ...currentItem, newName: currentItem.originalName } : currentItem))
                        }
                      }}
                    />
                  </td>
                  <td className='break-all p-3 align-top'>{item.originalName}</td>
                  <td className='break-all p-3 align-top'>
                    {previewing && previewingFileIds.includes(item.fileId) ? (
                      <div className='h-5 w-4/5 animate-pulse rounded bg-secondary' aria-label='Updating preview' />
                    ) : (
                      <span className={item.originalName === item.newName ? 'text-muted-foreground' : 'font-medium text-primary'}>
                        {item.newName}
                      </span>
                    )}
                  </td>
                  <td className='break-words p-3 align-top text-muted-foreground'>{formatDate(item.createdAt)}</td>
                  <td className='break-words p-3 align-top text-muted-foreground'>{formatBytes(item.size)}</td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={5} className='p-6 text-center text-muted-foreground'>
                    Select directories to generate a preview.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {message && <p className='lg:col-start-1 lg:row-start-2 text-sm text-muted-foreground'>{message}</p>}
      </div>
      <Dialog open={renameItem !== null} onOpenChange={(open) => { if (!open) setRenameItem(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>Enter a new filename. The original extension is preserved.</DialogDescription>
          </DialogHeader>
          <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} className='w-full rounded border border-input bg-background px-3 py-2' autoFocus />
          <DialogFooter>
            <button type='button' onClick={() => setRenameItem(null)} className='rounded border border-border px-3 py-2 text-sm'>Cancel</button>
            <button type='button' onClick={() => void renameFile()} disabled={busy || !renameValue.trim()} className='rounded bg-primary px-3 py-2 text-sm text-primary-foreground'>Rename</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={applyConfirmOpen} onOpenChange={setApplyConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply rename?</DialogTitle>
            <DialogDescription>Rename {selectedRenameCount} selected {selectedRenameCount === 1 ? 'file' : 'files'} using the current preview?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type='button' onClick={() => setApplyConfirmOpen(false)} className='rounded border border-border px-3 py-2 text-sm'>Cancel</button>
            <button type='button' onClick={() => { setApplyConfirmOpen(false); void apply() }} className='rounded bg-primary px-3 py-2 text-sm text-primary-foreground'>Apply</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={directoryDialogOpen} onOpenChange={setDirectoryDialogOpen}>
        <DialogContent className='h-[95vh] max-h-[95vh] max-w-xl grid-rows-[auto_minmax(0,1fr)_auto]'>
          <DialogHeader>
            <DialogTitle>Select directories to rename</DialogTitle>
            <DialogDescription>Choose the directories whose indexed files should be included in the rename preview.</DialogDescription>
          </DialogHeader>
          <div className='min-h-0 space-y-1 overflow-y-auto rounded-md border border-border p-2 scrollbar'>
            {directories.map((directory) => (
              <label key={directory.id} className='flex cursor-pointer items-center gap-2 rounded p-1.5 hover:bg-secondary/40'>
                <input
                  type='checkbox'
                  checked={allDirectories || directoryIds.includes(directory.id)}
                  onChange={() => toggleDirectory(directory.id)}
                />
                {directory.name}
              </label>
            ))}
          </div>
          <DialogFooter>
            <div className='mr-auto flex gap-2'>
              <button
                type='button'
                onClick={() => {
                  setAllDirectories(true)
                  setDirectoryIds([])
                }}
                className='rounded border border-border px-3 py-2 text-sm'
              >
                Select all
              </button>
              <button
                type='button'
                onClick={() => {
                  setAllDirectories(false)
                  setDirectoryIds([])
                setItems((current) => current.map((item) => ({ ...item, newName: item.originalName })))
                }}
                className='rounded border border-border px-3 py-2 text-sm'
              >
                Deselect all
              </button>
            </div>
            <button type='button' onClick={onBack} className='rounded border border-border px-3 py-2 text-sm'>
              Cancel
            </button>
            <button
              type='button'
              onClick={confirmDirectories}
              disabled={!allDirectories && !directoryIds.length}
              className='rounded bg-primary px-3 py-2 text-sm text-primary-foreground'
            >
              Continue
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
