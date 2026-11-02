import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { r18Api } from '@/api/r18'
import { ActressSummary } from '@/types/types'

const STORAGE_KEY = 'scenewhisper.actressCustomNames'

export type ActressCustomNames = Record<number, string>

export function formatActressName(
  actress: ActressSummary,
  customNames: ActressCustomNames = {},
): string {
  const customName = customNames[actress.id]?.trim()
  return customName || (actress.display_name ?? actress.name_romaji ?? actress.name_kanji ?? actress.name_kana ?? `Actress #${actress.id}`)
}

function readCustomNames(): ActressCustomNames {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([id, value]) => [Number(id), String(value).trim()])
        .filter(([id]) => Number.isFinite(id)),
    )
  } catch {
    return {}
  }
}

function writeCustomNames(customNames: ActressCustomNames) {
  if (typeof window === 'undefined') return

  const cleaned = Object.fromEntries(
    Object.entries(customNames)
      .filter(([, value]) => value.trim())
      .map(([id, value]) => [id, value.trim()]),
  )
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned))
  } catch {
    // The UI alias should still be usable when storage is unavailable or full.
  }
}

export function useActressCustomNames() {
  const queryClient = useQueryClient()
  const [localNames, setLocalNames] = useState<ActressCustomNames>(() => readCustomNames())
  const aliasesQuery = useQuery({ queryKey: ['r18', 'actress-aliases'], queryFn: r18Api.getActressAliases })
  // Keep pre-existing browser aliases visible while the server-backed store is
  // being populated or when an older installation has no aliases yet.
  const customNames = { ...localNames, ...(aliasesQuery.data ?? {}) }

  useEffect(() => {
    writeCustomNames(customNames)
  }, [customNames])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setLocalNames(readCustomNames())
      }
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setCustomName = useCallback((actressId: number, name: string) => {
    const next = { ...customNames }
      const trimmed = name.trim()
      if (trimmed) {
        next[actressId] = trimmed
      } else {
        delete next[actressId]
      }
    setLocalNames(next)
    void r18Api.setActressAlias(actressId, trimmed).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['r18', 'actress-aliases'] })
    })
  }, [customNames, queryClient])

  return { customNames, setCustomName }
}
