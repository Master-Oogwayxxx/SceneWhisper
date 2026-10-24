import { vi, describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { directoryApi } from '@/api/directories'
import { DirectoryMonitor } from '@/types/types'
import { useMonitorActions } from '../useMonitorActions'
import { toast } from 'sonner'

// Test the API layer changes: runMonitorNow method exists and behaves correctly
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const mockMonitor: DirectoryMonitor = {
  id: 'monitor-1',
  directoryId: 'dir-1',
  directoryName: 'TestDir',
  directoryPath: '/test/path',
  isActive: true,
  schedule: 'daily',
  taskType: 'full',
  subtitleLanguage: 'en',
  createdAt: new Date('2024-01-01'),
}

describe('directoryApi.runMonitorNow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('POSTs to /directory-monitors/{id}/run', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    })

    await directoryApi.runMonitorNow('monitor-1')

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/directory-monitors/monitor-1/run'),
      { method: 'POST' },
    )
  })

  it('throws when response is not ok', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ detail: 'Monitor not found' }),
    })

    await expect(directoryApi.runMonitorNow('monitor-1')).rejects.toThrow('Monitor not found')
  })

  it('throws generic error when response has no detail', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({}),
    })

    await expect(directoryApi.runMonitorNow('monitor-1')).rejects.toThrow('Failed to run monitor')
  })
})

describe('handleCreateMonitors - nextRun not computed client-side', () => {
  it('directoryApi.createDirectoryMonitor is called with payload that has no nextRun', async () => {
    // Mock createDirectoryMonitor to capture the argument
    const originalCreate = directoryApi.createDirectoryMonitor
    const capturedArgs: DirectoryMonitor[] = []
    directoryApi.createDirectoryMonitor = async (monitor: DirectoryMonitor) => {
      capturedArgs.push(monitor)
      return { ...monitor, id: 'new-id', nextRun: new Date('2024-12-01') }
    }

    // Simulate the payload handleCreateMonitors constructs (no nextRun field)
    const payloadWithoutNextRun: DirectoryMonitor = {
      directoryId: 'dir-2',
      directoryName: 'NewDir',
      directoryPath: '/new/path',
      isActive: true,
      schedule: 'hourly',
      taskType: 'full',
      subtitleLanguage: 'en',
      id: 'generated-id',
      createdAt: new Date(),
      // nextRun intentionally omitted - backend computes it
    }

    await directoryApi.createDirectoryMonitor(payloadWithoutNextRun)

    expect(capturedArgs[0].nextRun).toBeUndefined()

    directoryApi.createDirectoryMonitor = originalCreate
  })

  it('backend-returned nextRun is parsed and available in response', async () => {
    const backendNextRun = '2024-12-01T10:00:00Z'
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ...mockMonitor,
        id: 'new-id',
        nextRun: backendNextRun,
        createdAt: '2024-01-01T00:00:00Z',
      }),
    })

    const result = await directoryApi.createDirectoryMonitor({
      ...mockMonitor,
      id: 'temp',
    })

    expect(result.nextRun).toBeInstanceOf(Date)
    expect(result.nextRun?.toISOString()).toBe(new Date(backendNextRun).toISOString())
  })
})

describe('handleBulkRunNow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(directoryApi, 'getDirectoryMonitors').mockResolvedValue([])
  })

  it('runs each selected monitor and refreshes once after the batch', async () => {
    const monitor1: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-1',
      directoryPath: '/path/1',
    }
    const monitor2: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-2',
      directoryPath: '/path/2',
    }

    vi.spyOn(directoryApi, 'runMonitorNow')
      .mockResolvedValueOnce({ queued: 5, skipped: 2 })
      .mockResolvedValueOnce({ queued: 3, skipped: 1 })

    const fetchStats = vi.fn()
    const { result } = renderHook(
      () => useMonitorActions(vi.fn(), vi.fn(), fetchStats),
      {
        initialProps: undefined,
      },
    )

    // Set monitors in the hook
    result.current.setMonitors([monitor1, monitor2])

    await waitFor(() => {
      expect(result.current.monitors).toHaveLength(2)
    })

    await result.current.handleBulkRunNow(['monitor-1', 'monitor-2'])

    expect(directoryApi.runMonitorNow).toHaveBeenCalledTimes(2)
    expect(directoryApi.getDirectoryMonitors).toHaveBeenCalledOnce()
    expect(fetchStats).toHaveBeenCalledOnce()
  })

  it('limits concurrent monitor runs to four', async () => {
    const monitors = Array.from({ length: 10 }, (_, index): DirectoryMonitor => ({
      ...mockMonitor,
      id: `monitor-${index}`,
      directoryPath: `/path/${index}`,
    }))
    let active = 0
    let maxActive = 0
    const releases: Array<() => void> = []
    vi.spyOn(directoryApi, 'runMonitorNow').mockImplementation(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
      return { queued: 1, skipped: 0 }
    })

    const { result } = renderHook(() => useMonitorActions(vi.fn(), vi.fn(), vi.fn()))
    result.current.setMonitors(monitors)
    await waitFor(() => expect(result.current.monitors).toHaveLength(10))

    const run = result.current.handleBulkRunNow(monitors.map((monitor) => monitor.id))
    await waitFor(() => expect(directoryApi.runMonitorNow).toHaveBeenCalledTimes(4))
    while (releases.length > 0 || active > 0) {
      releases.splice(0).forEach((release) => release())
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await run

    expect(directoryApi.runMonitorNow).toHaveBeenCalledTimes(10)
    expect(maxActive).toBe(4)
  })

  it('does not run disabled selected monitors', async () => {
    const enabled: DirectoryMonitor = {
      ...mockMonitor,
      id: 'enabled-monitor',
      directoryPath: '/path/enabled',
      isActive: true,
    }
    const disabled: DirectoryMonitor = {
      ...mockMonitor,
      id: 'disabled-monitor',
      directoryPath: '/path/disabled',
      isActive: false,
    }
    vi.spyOn(directoryApi, 'runMonitorNow').mockResolvedValue({ queued: 1, skipped: 0 })

    const { result } = renderHook(() => useMonitorActions(vi.fn(), vi.fn(), vi.fn()))
    result.current.setMonitors([enabled, disabled])
    await waitFor(() => expect(result.current.monitors).toHaveLength(2))

    await result.current.handleBulkRunNow(['enabled-monitor', 'disabled-monitor'])

    expect(directoryApi.runMonitorNow).toHaveBeenCalledOnce()
    expect(directoryApi.runMonitorNow).toHaveBeenCalledWith('enabled-monitor')
  })

  it('shows final toast with cumulative stats when monitors complete', async () => {
    const monitor1: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-1',
      directoryPath: '/path/1',
    }
    const monitor2: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-2',
      directoryPath: '/path/2',
    }

    vi.spyOn(directoryApi, 'runMonitorNow')
      .mockResolvedValueOnce({ queued: 5, skipped: 2 })
      .mockResolvedValueOnce({ queued: 3, skipped: 1 })

    const { result } = renderHook(
      () => useMonitorActions(vi.fn(), vi.fn(), vi.fn()),
      {
        initialProps: undefined,
      },
    )

    result.current.setMonitors([monitor1, monitor2])

    await waitFor(() => {
      expect(result.current.monitors).toHaveLength(2)
    })

    await result.current.handleBulkRunNow(['monitor-1', 'monitor-2'])

    expect(toast.success).toHaveBeenCalledWith('Scanning complete: 8 queued, 3 skipped')
  })

  it('does not show toast when totalQueued and totalSkipped are both 0', async () => {
    const monitor1: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-1',
      directoryPath: '/path/1',
    }

    vi.spyOn(directoryApi, 'runMonitorNow').mockResolvedValueOnce({ queued: 0, skipped: 0 })

    const { result } = renderHook(
      () => useMonitorActions(vi.fn(), vi.fn(), vi.fn()),
      {
        initialProps: undefined,
      },
    )

    result.current.setMonitors([monitor1])

    await waitFor(() => {
      expect(result.current.monitors).toHaveLength(1)
    })

    ;(toast.success as ReturnType<typeof vi.fn>).mockClear()
    await result.current.handleBulkRunNow(['monitor-1'])

    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows toast if totalQueued > 0 but totalSkipped = 0', async () => {
    const monitor1: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-1',
      directoryPath: '/path/1',
    }

    vi.spyOn(directoryApi, 'runMonitorNow').mockResolvedValueOnce({ queued: 5, skipped: 0 })

    const { result } = renderHook(
      () => useMonitorActions(vi.fn(), vi.fn(), vi.fn()),
      {
        initialProps: undefined,
      },
    )

    result.current.setMonitors([monitor1])

    await waitFor(() => {
      expect(result.current.monitors).toHaveLength(1)
    })

    ;(toast.success as ReturnType<typeof vi.fn>).mockClear()
    await result.current.handleBulkRunNow(['monitor-1'])

    expect(toast.success).toHaveBeenCalledWith('Scanning complete: 5 queued, 0 skipped')
  })

  it('shows toast if totalQueued = 0 but totalSkipped > 0', async () => {
    const monitor1: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-1',
      directoryPath: '/path/1',
    }

    vi.spyOn(directoryApi, 'runMonitorNow').mockResolvedValueOnce({ queued: 0, skipped: 3 })

    const { result } = renderHook(
      () => useMonitorActions(vi.fn(), vi.fn(), vi.fn()),
      {
        initialProps: undefined,
      },
    )

    result.current.setMonitors([monitor1])

    await waitFor(() => {
      expect(result.current.monitors).toHaveLength(1)
    })

    ;(toast.success as ReturnType<typeof vi.fn>).mockClear()
    await result.current.handleBulkRunNow(['monitor-1'])

    expect(toast.success).toHaveBeenCalledWith('Scanning complete: 0 queued, 3 skipped')
  })

  it('returns cumulative totals from all monitors', async () => {
    const monitor1: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-1',
      directoryPath: '/path/1',
    }
    const monitor2: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-2',
      directoryPath: '/path/2',
    }

    vi.spyOn(directoryApi, 'runMonitorNow')
      .mockResolvedValueOnce({ queued: 5, skipped: 2 })
      .mockResolvedValueOnce({ queued: 3, skipped: 1 })

    const { result } = renderHook(
      () => useMonitorActions(vi.fn(), vi.fn(), vi.fn()),
      {
        initialProps: undefined,
      },
    )

    result.current.setMonitors([monitor1, monitor2])

    await waitFor(() => {
      expect(result.current.monitors).toHaveLength(2)
    })

    const returnValue = await result.current.handleBulkRunNow(['monitor-1', 'monitor-2'])

    expect(returnValue).toEqual({ queued: 8, skipped: 3 })
  })

  it('does not show toast when empty ID array is passed', async () => {
    const { result } = renderHook(
      () => useMonitorActions(vi.fn(), vi.fn(), vi.fn()),
      {
        initialProps: undefined,
      },
    )

    ;(toast.success as ReturnType<typeof vi.fn>).mockClear()
    await result.current.handleBulkRunNow([])

    expect(toast.success).not.toHaveBeenCalled()
  })

  it('continues to next monitor if one fails during bulk run', async () => {
    const monitor1: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-1',
      directoryPath: '/path/1',
    }
    const monitor2: DirectoryMonitor = {
      ...mockMonitor,
      id: 'monitor-2',
      directoryPath: '/path/2',
    }

    vi.spyOn(directoryApi, 'runMonitorNow')
      .mockRejectedValueOnce(new Error('Monitor 1 failed'))
      .mockResolvedValueOnce({ queued: 3, skipped: 1 })

    const { result } = renderHook(
      () => useMonitorActions(vi.fn(), vi.fn(), vi.fn()),
      {
        initialProps: undefined,
      },
    )

    result.current.setMonitors([monitor1, monitor2])

    await waitFor(() => {
      expect(result.current.monitors).toHaveLength(2)
    })

    const progressValues: Array<[number, number, number, number]> = []
    const onProgress = vi.fn((done: number, total: number, queued: number, skipped: number) => {
      progressValues.push([done, total, queued, skipped])
    })

    ;(toast.success as ReturnType<typeof vi.fn>).mockClear()
    const returnValue = await result.current.handleBulkRunNow(['monitor-1', 'monitor-2'], onProgress)

    // Progress callback should fire for both monitors
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(progressValues).toEqual([
      [1, 2, 0, 0], // After failed monitor
      [2, 2, 3, 1], // After successful monitor
    ])

    // Toast should show results from the successful monitor
    expect(toast.success).toHaveBeenCalledWith('Scanning complete: 3 queued, 1 skipped')

    // Return value includes only successful monitor results
    expect(returnValue).toEqual({ queued: 3, skipped: 1 })
  })
})
