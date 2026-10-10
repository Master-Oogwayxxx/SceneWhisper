import { useState } from 'react'
import { Bookmark, Trash2, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog'
import { DirectoryRecord } from '@/types/types'
import { FileFilterState } from '@/lib/file-filters'
import { useSavedFileFilters } from '@/hooks/useSavedFileFilters'

interface SavedFileFiltersSectionProps {
  /** Current draft filter state to save or compare against. */
  currentFilters: FileFilterState
  /** Apply a loaded preset into the filter dialog draft. */
  onLoadPreset: (filters: FileFilterState) => void
  /** Persist which preset should load by default. */
  onSetDefaultPreset: (presetId: string | null) => Promise<void>
  directories: DirectoryRecord[]
}

/**
 * Saved filter presets UI: load into draft, save current draft, delete presets.
 * @param props - Current draft filters and load callback
 */
export const SavedFileFiltersSection = ({
  currentFilters,
  onLoadPreset,
  onSetDefaultPreset,
  directories,
}: SavedFileFiltersSectionProps) => {
  const { presets, isLoading, createPreset, isCreating, isUpdating, deletePreset, isDeleting } = useSavedFileFilters()
  const [saveName, setSaveName] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState<string>('')

  /**
   * Load a preset into the draft, skipping missing directory with a warning.
   * @param presetId - Saved preset id to load
   */
  const handleLoad = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId)
    if (!preset) return

    setSelectedPresetId(presetId)
    const filters = {
      ...preset.filters,
      selectedDirectoryIds: preset.filters.selectedDirectoryIds ?? (preset.filters.selectedDirectoryId ? [preset.filters.selectedDirectoryId] : []),
    }
    const existingDirectoryIds = new Set(directories.map((d) => d.id))
    const validDirectoryIds = filters.selectedDirectoryIds.filter((id) => existingDirectoryIds.has(id))
    if (validDirectoryIds.length !== filters.selectedDirectoryIds.length) {
      filters.selectedDirectoryIds = validDirectoryIds
      filters.selectedDirectoryId = null
      toast.warning('Saved directory no longer exists; other filters were loaded')
    }
    onLoadPreset(filters)
    toast.success(`Loaded "${preset.name}"`)
  }

  /** Persist the current draft under the entered name. */
  const handleSave = async () => {
    const trimmed = saveName.trim()
    if (!trimmed) {
      toast.error('Enter a name for this filter')
      return
    }
    try {
      const existingPreset = presets.find((preset) => preset.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase())
      const created = await createPreset({ name: trimmed, filters: currentFilters })
      setSaveName('')
      setSelectedPresetId(created.id)
      toast.success(existingPreset ? `Updated "${created.name}"` : `Saved "${created.name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save filter')
    }
  }

  /** Delete the currently selected preset. */
  const handleDelete = async () => {
    if (!selectedPresetId) return
    const preset = presets.find((p) => p.id === selectedPresetId)
    try {
      await deletePreset(selectedPresetId)
      setSelectedPresetId('')
      toast.success(preset ? `Deleted "${preset.name}"` : 'Filter deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete filter')
    }
  }

  const selectedPreset = presets.find((p) => p.id === selectedPresetId)

  return (
    <div className="col-span-2 flex flex-col gap-3 pb-4 border-b">
      <Label className="text-sm font-medium flex items-center gap-2">
        <Bookmark className="w-3.5 h-3.5" />
        Saved Filters
      </Label>

      <div className="flex flex-col sm:flex-row gap-2 px-1">
        <Select
          value={selectedPresetId || undefined}
          onValueChange={handleLoad}
          disabled={isLoading || presets.length === 0}
        >
          <SelectTrigger className="h-9 flex-1" aria-label="Load saved filter">
            <SelectValue placeholder={isLoading ? 'Loading…' : presets.length === 0 ? 'No saved filters' : 'Load saved filter…'} />
          </SelectTrigger>
          <SelectContent>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedPreset && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant={selectedPreset.isDefault ? 'default' : 'outline'}
              size="sm"
              className="h-9 shrink-0 gap-1.5"
              disabled={isCreating || isDeleting || isUpdating}
              aria-label={selectedPreset.isDefault ? `Unset default for ${selectedPreset.name}` : `Set ${selectedPreset.name} as default`}
              onClick={() => void onSetDefaultPreset(selectedPreset.isDefault ? null : selectedPreset.id)}
            >
              <Star className="w-3.5 h-3.5" />
              {selectedPreset.isDefault ? 'Default' : 'Set Default'}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 gap-1.5"
                  disabled={isDeleting}
                  aria-label={`Delete saved filter ${selectedPreset.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &quot;{selectedPreset.name}&quot;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the saved filter preset. Your current draft is unchanged.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleDelete}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 px-1">
        <Input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Name this filter set…"
          className="h-9 flex-1"
          aria-label="Saved filter name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleSave()
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-9 shrink-0"
          onClick={() => void handleSave()}
          disabled={isCreating || !saveName.trim()}
        >
          Save current filters
        </Button>
      </div>
    </div>
  )
}
