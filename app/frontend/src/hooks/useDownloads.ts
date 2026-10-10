import { useEffect, useRef, useState } from 'react'

import { r18Api } from '@/api/r18'
import type { TorrentStatus } from '@/types/types'

export function useDownloads(active: boolean): Map<string, TorrentStatus> {
  const [statusMap, setStatusMap] = useState<Map<string, TorrentStatus>>(new Map())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!active) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setStatusMap(new Map())
      return
    }

    const fetchAndUpdate = () => {
      r18Api.getDownloads().then((list) => {
        setStatusMap(new Map(list.map((s) => [s.content_id, s])))
      }).catch(() => {
        // Silently ignore poll failures — stale data is fine
      })
    }

    fetchAndUpdate()
    intervalRef.current = setInterval(fetchAndUpdate, 10_000)

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [active])

  return statusMap
}
