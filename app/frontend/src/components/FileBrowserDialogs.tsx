import { File, DirectoryRecord } from '@/types/types'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

interface FileBrowserDialogsProps {
  directoryRenameTargetId: string | null
  directoryRenameValue: string
  setDirectoryRenameTargetId: (value: string | null) => void
  setDirectoryRenameValue: (value: string) => void
  onRenameDirectory: () => void
  directoryMoveTargetId: string | null
  directoryMoveDestinationId: string
  setDirectoryMoveTargetId: (value: string | null) => void
  setDirectoryMoveDestinationId: (value: string) => void
  moveTargetDirectory: DirectoryRecord | null
  availableMoveDestinations: DirectoryRecord[]
  onMoveDirectory: () => void
  fileMoveTargetId: string | null
  fileMoveDestinationId: string
  setFileMoveTargetId: (value: string | null) => void
  setFileMoveDestinationId: (value: string) => void
  moveTargetFile: File | null
  availableFileMoveDestinations: DirectoryRecord[]
  onMoveFile: () => void
}

export function FileBrowserDialogs({
  directoryRenameTargetId, directoryRenameValue, setDirectoryRenameTargetId, setDirectoryRenameValue, onRenameDirectory,
  directoryMoveTargetId, directoryMoveDestinationId, setDirectoryMoveTargetId, setDirectoryMoveDestinationId,
  moveTargetDirectory, availableMoveDestinations, onMoveDirectory,
  fileMoveTargetId, fileMoveDestinationId, setFileMoveTargetId, setFileMoveDestinationId,
  moveTargetFile, availableFileMoveDestinations, onMoveFile,
}: FileBrowserDialogsProps) {
  return <>
    <Dialog open={directoryRenameTargetId !== null} onOpenChange={(open) => { if (!open) { setDirectoryRenameTargetId(null); setDirectoryRenameValue('') } }}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Rename directory</DialogTitle><DialogDescription>Update the selected folder name.</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="directory-rename-input">Directory name</Label><Input id="directory-rename-input" value={directoryRenameValue} onChange={(event) => setDirectoryRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onRenameDirectory() } }} placeholder="Enter directory name" /></div>
        <DialogFooter><Button variant="outline" onClick={() => { setDirectoryRenameTargetId(null); setDirectoryRenameValue('') }}>Cancel</Button><Button onClick={onRenameDirectory} disabled={!directoryRenameValue.trim()}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={directoryMoveTargetId !== null} onOpenChange={(open) => { if (!open) { setDirectoryMoveTargetId(null); setDirectoryMoveDestinationId('') } }}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Move directory</DialogTitle><DialogDescription>Choose where to move this folder.</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="directory-move-destination">Destination</Label><Select value={directoryMoveDestinationId} onValueChange={setDirectoryMoveDestinationId}><SelectTrigger id="directory-move-destination"><SelectValue placeholder="Select a destination" /></SelectTrigger><SelectContent>{availableMoveDestinations.map((directory) => <SelectItem key={directory.id} value={directory.id}>{directory.path}</SelectItem>)}</SelectContent></Select></div>
        <DialogFooter><Button variant="outline" onClick={() => { setDirectoryMoveTargetId(null); setDirectoryMoveDestinationId('') }}>Cancel</Button><Button onClick={onMoveDirectory} disabled={!moveTargetDirectory || !directoryMoveDestinationId || directoryMoveDestinationId === moveTargetDirectory.parent_id}>Move</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={fileMoveTargetId !== null} onOpenChange={(open) => { if (!open) { setFileMoveTargetId(null); setFileMoveDestinationId('') } }}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Move file</DialogTitle><DialogDescription>Choose where to move {moveTargetFile ? `"${moveTargetFile.name}"` : 'this file'}.</DialogDescription></DialogHeader>
        <div className="space-y-2"><Label htmlFor="file-move-destination">Destination</Label><Select value={fileMoveDestinationId} onValueChange={setFileMoveDestinationId}><SelectTrigger id="file-move-destination"><SelectValue placeholder="Select a destination" /></SelectTrigger><SelectContent>{availableFileMoveDestinations.map((directory) => <SelectItem key={directory.id} value={directory.id}>{directory.path}</SelectItem>)}</SelectContent></Select></div>
        <DialogFooter><Button variant="outline" onClick={() => { setFileMoveTargetId(null); setFileMoveDestinationId('') }}>Cancel</Button><Button onClick={onMoveFile} disabled={!moveTargetFile || !fileMoveDestinationId}>Move</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
