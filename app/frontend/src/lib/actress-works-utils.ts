import { NyaaResult } from '@/types/types'

export function pickBestNyaaResult(results: NyaaResult[]): NyaaResult | null {
  if (results.length === 0) return null
  return [...results].sort((a, b) => {
    const score = (result: NyaaResult) => [Number(result.title.toLowerCase().includes('reducing mosaic')), Number(result.title.toLowerCase().includes('uncensored')), result.seeders]
    const [aReducing, aUncensored, aSeeders] = score(a)
    const [bReducing, bUncensored, bSeeders] = score(b)
    return bReducing - aReducing || bUncensored - aUncensored || bSeeders - aSeeders
  })[0]
}

export function sanitizeActressWorksFileName(value: string): string { return value.trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/\s+/g, ' ').slice(0, 120) }
