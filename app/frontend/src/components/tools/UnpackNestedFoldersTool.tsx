import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FolderTree, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { fileApi } from '@/api/files'
import { toolsApi } from '@/api/tools'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { DirectoryRecord } from '@/types/types'

export function UnpackNestedFoldersTool({ onBack }: { onBack: () => void }) {
  const [directories, setDirectories] = useState<DirectoryRecord[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    void fileApi.getDirectories()
      .then((items) => setDirectories([...items].sort((a, b) => a.path.localeCompare(b.path))))
      .catch(() => toast.error('Failed to load directories'))
      .finally(() => setIsLoading(false))
  }, [])

  const allSelected = directories.length > 0 && selected.size === directories.length
  const selectedIds = useMemo(() => [...selected], [selected])
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const run = async () => {
    if (!selectedIds.length) {
      toast.error('Select at least one directory')
      return
    }
    setIsRunning(true)
    try {
      const result = await toolsApi.unpackNestedFolders(selectedIds)
      toast.success(`Moved ${result.moved} file${result.moved === 1 ? '' : 's'}; skipped ${result.skipped}`)
    } catch {
      toast.error('Failed to unpack nested folders')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background shadow sm:rounded-lg">
      <div className="flex items-center gap-3 border-b border-border px-3 py-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back"><ArrowLeft /></Button>
        <FolderTree className="h-5 w-5 text-primary" aria-hidden />
        <div><h2 className="text-base font-semibold">Unpack Nested Folders</h2><p className="text-xs text-muted-foreground">Move indexed nested videos into their selected directory roots.</p></div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set(directories.map((directory) => directory.id)))} disabled={isLoading || !directories.length}>Select all</Button>
          <Button variant="outline" size="sm" onClick={() => setSelected(new Set())} disabled={isLoading || !selected.size}>Clear all</Button>
        </div>
        {isLoading ? <div className="py-8 text-center text-sm text-muted-foreground">Loading directories…</div> : (
          <div className="space-y-1">
            {directories.map((directory) => <label key={directory.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 hover:bg-secondary/40"><Checkbox checked={selected.has(directory.id)} onCheckedChange={() => toggle(directory.id)} /><span className="truncate text-sm">{directory.path}</span></label>)}
            {!directories.length && <p className="py-8 text-center text-sm text-muted-foreground">No directories found.</p>}
          </div>
        )}
      </div>
      <div className="flex justify-end border-t border-border px-3 py-3"><Button onClick={() => void run()} disabled={isRunning || !selected.size}>{isRunning && <Loader2 className="animate-spin" />}Unpack nested folders</Button></div>
    </div>
  )
}
