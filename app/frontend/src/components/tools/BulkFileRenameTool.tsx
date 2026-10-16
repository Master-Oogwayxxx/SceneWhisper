import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FilePenLine, Loader2 } from 'lucide-react'
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
  ['remove_release_tags', 'Remove release tags'],
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
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([])
  const [lastSelectedFileId, setLastSelectedFileId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [directoryDialogOpen, setDirectoryDialogOpen] = useState(true)
  const [allDirectories, setAllDirectories] = useState(true)
  const [renameItem, setRenameItem] = useState<BulkRenameItem | null>(null)
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
    hide_split_videos: true,
  })

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
      const item = items[row.rowIndex - 1]
      if (item) selectFile(item.fileId, event.shiftKey)
    }
    document.addEventListener('click', handle)
    return () => document.removeEventListener('click', handle)
  }, [items, lastSelectedFileId])
  const updateOption = (key: keyof BulkRenameOptions, value: boolean) => setOptions((current) => ({ ...current, [key]: value }))
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
  const preview = async (optionsOverride?: BulkRenameOptions) => {
    const previousSelection = new Set(selectedFileIds)
    setBusy(true)
    setMessage('')
    try {
      const next = { ...(optionsOverride ?? options), directory_ids: allDirectories ? [] : directoryIds }
      if (optionsOverride) setOptions(next)
      const nextItems = await toolsApi.previewBulkRename(next)
      setItems(nextItems.map((item) => (previousSelection.has(item.fileId) ? item : { ...item, newName: item.originalName })))
      setSelectedFileIds(nextItems.filter((item) => previousSelection.has(item.fileId)).map((item) => item.fileId))
      setLastSelectedFileId(null)
    } catch {
      setMessage('Preview failed')
    } finally {
      setBusy(false)
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
  }, [options, allDirectories, directoryIds, directoryDialogOpen])
  const apply = async () => {
    const selected = items.filter((item) => selectedFileIds.includes(item.fileId))
    if (!selected.length || !confirm(`Rename ${selected.filter((item) => item.originalName !== item.newName).length} files?`)) return
    setBusy(true)
    try {
      const result = await toolsApi.applyBulkRename({ ...options, directory_ids: allDirectories ? [] : directoryIds, file_ids: selectedFileIds })
      const byId = new Map(result.map((item) => [item.fileId, item]))
      setItems((current) => current.map((item) => byId.get(item.fileId) ?? item))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files'] }),
        queryClient.invalidateQueries({ queryKey: ['files-grouped'] }),
        queryClient.invalidateQueries({ queryKey: ['files-tree-folder'] }),
        queryClient.invalidateQueries({ queryKey: ['directories'] }),
        queryClient.invalidateQueries({ queryKey: ['tree-directory-file-counts'] }),
      ])
      setMessage('Rename complete')
    } catch {
      setMessage('Rename failed')
    } finally {
      setBusy(false)
    }
  }
  const confirmDirectories = async () => {
    setDirectoryDialogOpen(false)
  }

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
      <div className='min-h-0 flex-1 overflow-hidden grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start'>
        <div className='lg:col-start-2 lg:row-start-1 rounded-md border border-border p-3'>
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
          <div className='mt-3 flex flex-wrap gap-2'>
            <button type='button' onClick={() => void preview()} disabled={busy || directoryDialogOpen} className='rounded bg-primary px-3 py-2 text-sm text-primary-foreground'>
              {busy ? <Loader2 className='h-4 w-4 animate-spin' /> : 'Refresh preview'}
            </button>
            <button
              type='button'
              onClick={apply}
              disabled={busy || !selectedFileIds.some((id) => items.some((item) => item.fileId === id && item.originalName !== item.newName))}
              className='rounded border border-border px-3 py-2 text-sm'
            >
              Apply rename
            </button>
          </div>
        </div>
        <div className='min-h-0 overflow-auto lg:col-start-1 lg:row-start-1 rounded-md border border-border'>
          <table className='w-full table-fixed text-left text-sm'>
            <thead className='sticky top-0 z-10 border-b border-border bg-muted/40'>
              <tr>
                <th className='w-10 p-3'>
                  <input
                    type='checkbox'
                    aria-label='Select all files'
                    checked={items.length > 0 && selectedFileIds.length === items.length}
                    onChange={(event) => {
                      setSelectedFileIds(event.target.checked ? items.map((item) => item.fileId) : [])
                      setLastSelectedFileId(null)
                    }}
                  />
                </th>
                <th className='w-2/5 p-3 font-semibold'>Original file name</th>
                <th className='w-2/5 p-3 font-semibold'>Preview name</th>
                <th className='w-32 p-3 font-semibold'>Created</th>
                <th className='w-24 p-3 font-semibold'>Size</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.fileId} onContextMenu={(event) => { event.preventDefault(); setRenameItem(item); setRenameValue(item.originalName.replace(/\.[^.]+$/, '')) }} className='border-b border-border last:border-0'>
                  <td className='p-3 align-top'>
                    <input
                      type='checkbox'
                      aria-label={`Select ${item.originalName}`}
                      checked={selectedFileIds.includes(item.fileId)}
                      onChange={(event) => selectFile(item.fileId, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey)}
                    />
                  </td>
                  <td className='break-all p-3 align-top'>{item.originalName}</td>
                  <td className={item.originalName === item.newName ? 'break-all p-3 align-top text-muted-foreground' : 'break-all p-3 align-top font-medium text-primary'}>
                    {item.newName}
                  </td>
                  <td className='whitespace-nowrap p-3 align-top text-muted-foreground'>{formatDate(item.createdAt)}</td>
                  <td className='whitespace-nowrap p-3 align-top text-muted-foreground'>{formatBytes(item.size)}</td>
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
      <Dialog open={directoryDialogOpen} onOpenChange={setDirectoryDialogOpen}>
        <DialogContent className='max-w-xl'>
          <DialogHeader>
            <DialogTitle>Select directories to rename</DialogTitle>
            <DialogDescription>Choose the directories whose indexed files should be included in the rename preview.</DialogDescription>
          </DialogHeader>
          <div className='max-h-80 space-y-2 overflow-y-auto rounded-md border border-border p-3 scrollbar'>
            <label className='flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-secondary/40'>
              <input
                type='checkbox'
                checked={allDirectories}
                onChange={(event) => {
                  setAllDirectories(event.target.checked)
                  if (event.target.checked) setDirectoryIds([])
                }}
              />
              All directories
            </label>
            {directories.map((directory) => (
              <label key={directory.id} className='flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-secondary/40'>
                <input
                  type='checkbox'
                  checked={!allDirectories && directoryIds.includes(directory.id)}
                  onChange={() => toggleDirectory(directory.id)}
                />
                {directory.name}
              </label>
            ))}
          </div>
          <DialogFooter>
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
