import { Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface ActressQueueAllDialogProps {
  open: boolean
  savePath: string
  loading: boolean
  onOpenChange: (open: boolean) => void
  onSavePathChange: (value: string) => void
  onSubmit: () => void
}

export function ActressQueueAllDialog({
  open,
  savePath,
  loading,
  onOpenChange,
  onSavePathChange,
  onSubmit,
}: ActressQueueAllDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Queue all works</DialogTitle>
          <DialogDescription>
            Enter the qBittorrent save path to use for every work in the current actress search and filter context.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="queue-all-save-path">Save path</Label>
          <Input
            id="queue-all-save-path"
            value={savePath}
            onChange={(event) => onSavePathChange(event.target.value)}
            placeholder="D:/Media/Downloads/Actress Name"
            disabled={loading}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={loading || !savePath.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Queue All
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
