import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TopLevelDirectory } from '@/api/directories'

interface SelectiveSrtCleanupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  topLevelDirs: TopLevelDirectory[]
  topLevelError: string | null
  selectedDirs: string[]
  setSelectedDirs: React.Dispatch<React.SetStateAction<string[]>>
  onSaveSelection: () => Promise<void>
  onStartSrtCleanup: () => Promise<void>
}

export function SelectiveSrtCleanupDialog({
  open,
  onOpenChange,
  topLevelDirs,
  topLevelError,
  selectedDirs,
  setSelectedDirs,
  onSaveSelection,
  onStartSrtCleanup,
}: SelectiveSrtCleanupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md flex flex-col" style={{ height: '95vh' }}>
        <DialogHeader>
          <DialogTitle>Selective Delete SRTs</DialogTitle>
        </DialogHeader>

        {topLevelError ? (
          <p className="text-sm text-destructive">{topLevelError}</p>
        ) : topLevelDirs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subdirectories found.</p>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex gap-2 mb-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedDirs(topLevelDirs.map((d) => d.name))}
              >
                Select All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedDirs([])}
              >
                Deselect All
              </Button>
            </div>
            <ScrollArea className="flex-1 rounded-md bg-black/20 p-3">
              <div className="space-y-2 pr-4">
                {topLevelDirs.map((dir) => (
                  <div key={dir.name} className="flex items-center gap-2">
                    <Checkbox
                      id={`srt-dir-${dir.name}`}
                      checked={selectedDirs.includes(dir.name)}
                      onCheckedChange={(checked) => {
                        setSelectedDirs((prev) =>
                          checked
                            ? [...prev, dir.name]
                            : prev.filter((n) => n !== dir.name)
                        )
                      }}
                    />
                    <Label htmlFor={`srt-dir-${dir.name}`} className="cursor-pointer font-normal">
                      {dir.name}
                    </Label>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await onSaveSelection()
              onOpenChange(false)
            }}
          >
            Save Selection
          </Button>
          <Button
            onClick={onStartSrtCleanup}
            disabled={selectedDirs.length === 0 || topLevelDirs.length === 0}
          >
            Delete SRTs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
