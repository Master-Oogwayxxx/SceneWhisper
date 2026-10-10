import { useCallback, useEffect, useRef, useState } from 'react'

import { r18Api } from '@/api/r18'
import type { DownloadQueueItem } from '@/types/types'

const ACTIVE_POLL_MS = 5_000
const IDLE_POLL_MS = 30_000

function hasActiveItems(items: DownloadQueueItem[]): boolean {
  return items.some((i) => i.status === 'pending' || i.status === 'processing')
}

export function useQueue(): {
  items: DownloadQueueItem[]
  pendingCount: number
  clearDone: (includeFailed?: boolean) => Promise<void>
  clearFailed: () => Promise<void>
  refresh: () => void
} {
  const [items, setItems] = useState<DownloadQueueItem[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetch = useCallback(() => {
    r18Api.getQueue().then(setItems).catch(() => {})
  }, [])

  const isActive = items.some((i) => i.status === 'pending' || i.status === 'processing')

  useEffect(() => {
    fetch()
    intervalRef.current = setInterval(fetch, isActive ? ACTIVE_POLL_MS : IDLE_POLL_MS)
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current)
    }
  }, [isActive, fetch])

  const clearDone = useCallback(async (includeFailed = false) => {
    await r18Api.clearDoneQueue(includeFailed)
    fetch()
  }, [fetch])

  const clearFailed = useCallback(async () => {
    await r18Api.clearFailedQueue()
    fetch()
  }, [fetch])

  const pendingCount = items.filter((i) => i.status === 'pending' || i.status === 'processing').length

  return { items, pendingCount, clearDone, clearFailed, refresh: fetch }
}
