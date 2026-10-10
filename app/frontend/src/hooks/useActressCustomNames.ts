import { useCallback, useEffect, useState } from 'react'
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
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned))
}

export function useActressCustomNames() {
  const [customNames, setCustomNamesState] = useState<ActressCustomNames>(() => readCustomNames())

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setCustomNamesState(readCustomNames())
      }
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setCustomName = useCallback((actressId: number, name: string) => {
    setCustomNamesState((prev) => {
      const next = { ...prev }
      const trimmed = name.trim()
      if (trimmed) {
        next[actressId] = trimmed
      } else {
        delete next[actressId]
      }
      writeCustomNames(next)
      return next
    })
  }, [])

  return { customNames, setCustomName }
}
