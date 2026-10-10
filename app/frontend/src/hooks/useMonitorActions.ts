import { useState } from 'react'
import { toast } from 'sonner'
import { directoryApi } from '@/api/directories'
import { DirectoryMonitor, Task, AppTab } from '@/types/types'

export const useMonitorActions = (
  setTab: React.Dispatch<React.SetStateAction<AppTab>>,
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>,
  fetchStats: () => void,
) => {
  const [monitors, setMonitors] = useState<DirectoryMonitor[]>([])
  const [isMonitorDialogOpen, setIsMonitorDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingMonitor, setEditingMonitor] = useState<DirectoryMonitor | null>(null)

  const fetchMonitors = async (): Promise<void> => {
    try {
      const data = await directoryApi.getDirectoryMonitors()
      setMonitors(data)
    } catch (err) {
      console.error('Failed to fetch directory monitors:', err)
      toast.error('Failed to load directory monitors')
    }
  }

  // Directory Monitor handlers
  const handleCreateMonitors = async (items: Omit<DirectoryMonitor, 'id' | 'createdAt' | 'lastRun' | 'nextRun'>[]) => {
    if (items.length === 0) return

    let ok = 0
    const failedNames: string[] = []

    for (const monitorData of items) {
      // Check if a monitor already exists for this directory
      const existingMonitorIndex = monitors.findIndex((m) => m.directoryId === monitorData.directoryId)

      // If an existing monitor exists, delete it before creating the new one
      if (existingMonitorIndex !== -1) {
        try {
          await directoryApi.deleteDirectoryMonitor(monitors[existingMonitorIndex].id)
          setMonitors((prev) => prev.filter((m) => m.id !== monitors[existingMonitorIndex].id))
        } catch (err) {
          // If deletion fails, we still proceed to create the new monitor
          console.error('Failed to delete existing monitor:', err)
        }
      }

      const newMonitor: DirectoryMonitor = {
        ...monitorData,
        id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        createdAt: new Date(),
      }

      try {
        const saved = await directoryApi.createDirectoryMonitor(newMonitor)
        setMonitors((prev) => [...prev, saved])
        ok += 1
      } catch {
        failedNames.push(monitorData.directoryName)
      }
    }

    if (ok === items.length) {
      toast.success(ok === 1 ? `Monitor created for "${items[0].directoryName}"` : `Created ${ok} directory monitors`)
      setTab('monitors')
    } else if (ok > 0) {
      toast.error(`Created ${ok} of ${items.length} monitors. Failed: ${failedNames.join(', ')}`)
    } else {
      toast.error('Failed to save directory monitors')
    }
  }

  const handleRunMonitorNow = async (path: string, options?: { silent?: boolean }): Promise<{ queued: number; skipped: number }> => {
    const monitor = monitors.find((m) => m.directoryPath === path)
    if (!monitor) {
      toast.error(`No monitor found for ${path}`)
      return { queued: 0, skipped: 0 }
    }

    try {
      const result = await directoryApi.runMonitorNow(monitor.id)
      fetchStats()
      await fetchMonitors()
      if (!options?.silent) {
        toast.success(`Monitor run complete: ${result.queued} queued, ${result.skipped} skipped`)
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Monitor run failed: ${message}`)
      return { queued: 0, skipped: 0 }
    }
  }

  const handleDeleteMonitor = async (id: string) => {
    try {
      await directoryApi.deleteDirectoryMonitor(id)
      setMonitors((prev) => prev.filter((m) => m.id !== id))
      toast.success('Monitor deleted')
    } catch {
      toast.error('Failed to delete directory monitor')
    }
  }

  const handleToggleMonitorActive = async (id: string) => {
    const monitor = monitors.find((m) => m.id === id)
    if (!monitor) return
    const updated = { ...monitor, isActive: !monitor.isActive }
    setMonitors((prev) => prev.map((m) => (m.id === id ? updated : m)))
    try {
      await directoryApi.updateDirectoryMonitor(updated)
    } catch {
      setMonitors((prev) => prev.map((m) => (m.id === id ? monitor : m)))
      toast.error('Failed to update monitor')
    }
  }

  const handleBulkToggleActive = async (ids: string[], active: boolean) => {
    const originals = monitors.filter((m) => ids.includes(m.id))
    setMonitors((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, isActive: active } : m)))
    const failed: string[] = []
    for (const monitor of originals) {
      try {
        await directoryApi.updateDirectoryMonitor({ ...monitor, isActive: active })
      } catch {
        failed.push(monitor.directoryName)
      }
    }
    if (failed.length > 0) {
      setMonitors((prev) =>
        prev.map((m) => {
          const original = originals.find((o) => o.id === m.id)
          return original && failed.includes(original.directoryName) ? original : m
        }),
      )
      toast.error(`Failed to update: ${failed.join(', ')}`)
    } else {
      toast.success(`${active ? 'Enabled' : 'Disabled'} ${ids.length} monitor${ids.length !== 1 ? 's' : ''}`)
    }
  }

  const handleBulkDelete = async (ids: string[], onProgress?: (done: number, total: number, failed: number) => void) => {
    const failed: string[] = []
    for (let i = 0; i < ids.length; i++) {
      try {
        await directoryApi.deleteDirectoryMonitor(ids[i])
      } catch {
        const m = monitors.find((m) => m.id === ids[i])
        if (m) failed.push(m.directoryName)
      }
      onProgress?.(i + 1, ids.length, failed.length)
    }
    const deletedIds = ids.filter((id) => {
      const m = monitors.find((m) => m.id === id)
      return !m || !failed.includes(m.directoryName)
    })
    setMonitors((prev) => prev.filter((m) => !deletedIds.includes(m.id)))
    if (failed.length > 0) {
      toast.error(`Failed to delete: ${failed.join(', ')}`)
    } else {
      toast.success(`Deleted ${ids.length} monitor${ids.length !== 1 ? 's' : ''}`)
    }
  }

  const handleBulkUpdate = async (ids: string[], patch: Partial<DirectoryMonitor>, onProgress?: (done: number, total: number, failed: number) => void) => {
    const originals = monitors.filter((m) => ids.includes(m.id))
    const updated = originals.map((m) => ({ ...m, ...patch }))
    setMonitors((prev) =>
      prev.map((m) => {
        const u = updated.find((u) => u.id === m.id)
        return u ?? m
      }),
    )
    const failed: string[] = []
    for (let i = 0; i < updated.length; i++) {
      try {
        await directoryApi.updateDirectoryMonitor(updated[i])
      } catch {
        failed.push(updated[i].directoryName)
      }
      onProgress?.(i + 1, updated.length, failed.length)
    }
    if (failed.length > 0) {
      setMonitors((prev) =>
        prev.map((m) => {
          const original = originals.find((o) => o.id === m.id)
          return original && failed.includes(original.directoryName) ? original : m
        }),
      )
      toast.error(`Failed to update: ${failed.join(', ')}`)
    } else {
      toast.success(`Updated ${ids.length} monitor${ids.length !== 1 ? 's' : ''}`)
    }
  }

  /**
   * Run all selected monitors sequentially with progress tracking.
   * @param ids Array of monitor IDs to run
   * @param onProgress Optional callback invoked after each monitor completes
   *   - done: number of monitors completed so far
   *   - total: total number of monitors to run
   *   - queued: cumulative number of files queued across all completed monitors
   *   - skipped: cumulative number of files skipped across all completed monitors
   */
  const handleBulkRunNow = async (
    ids: string[],
    onProgress?: (done: number, total: number, queued: number, skipped: number) => void,
    shouldCancel?: () => boolean,
  ): Promise<{ queued: number; skipped: number }> => {
    const monitorMap = new Map(monitors.map((m) => [m.id, m]))
    const targets = ids
      .map((id) => monitorMap.get(id))
      .filter((m): m is DirectoryMonitor => m !== undefined && m.isActive)
    let totalQueued = 0
    let totalSkipped = 0
    for (let i = 0; i < targets.length; i++) {
      if (shouldCancel?.()) break
      try {
        const result = await handleRunMonitorNow(targets[i].directoryPath, { silent: true })
        totalQueued += result.queued
        totalSkipped += result.skipped
      } catch (err) {
        console.error(`Failed to run monitor ${targets[i].directoryPath}:`, err)
      }
      onProgress?.(i + 1, targets.length, totalQueued, totalSkipped)
    }
    if (targets.length > 0 && (totalQueued > 0 || totalSkipped > 0)) {
      toast.success(`Scanning complete: ${totalQueued} queued, ${totalSkipped} skipped`)
    }
    return { queued: totalQueued, skipped: totalSkipped }
  }

  const handleEditMonitor = (monitor: DirectoryMonitor) => {
    setEditingMonitor(monitor)
    setIsEditDialogOpen(true)
  }

  const handleUpdateMonitor = async (updatedMonitor: DirectoryMonitor) => {
    setMonitors((prev) => prev.map((m) => (m.id === updatedMonitor.id ? updatedMonitor : m)))
    toast.success('Monitor updated successfully')
  }

  return {
    monitors,
    setMonitors,
    fetchMonitors,
    handleCreateMonitors,
    handleRunMonitorNow,
    handleDeleteMonitor,
    isMonitorDialogOpen,
    setIsMonitorDialogOpen,
    isEditDialogOpen,
    setIsEditDialogOpen,
    editingMonitor,
    setEditingMonitor,
    handleToggleMonitorActive,
    handleBulkToggleActive,
    handleBulkDelete,
    handleBulkUpdate,
    handleBulkRunNow,
    handleEditMonitor,
    handleUpdateMonitor,
  }
}
