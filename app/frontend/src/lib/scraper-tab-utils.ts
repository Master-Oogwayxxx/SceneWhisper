import { ScraperSource, ScraperTemplate } from '@/types/types'
import { normalizeScraperUrl } from '@/components/ScraperCard'
import { urlsForScraperSource } from '@/components/ScraperRunDialog'

export function formatScraperDate(value?: Date | null): string { return value ? value.toLocaleString() : 'Never' }
export function scraperValueTime(value?: Date | string | null): number { return value ? new Date(value).getTime() : 0 }
export function hostnameFromUrl(url: string): string { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
export function websiteBadgesForSource(source: ScraperSource, templates: ScraperTemplate[]): string[] {
  return urlsForScraperSource(source).map((url) => {
    const matchingTemplate = templates.find((template) => { const [prefix, suffix = ''] = template.url_template.split('{actress_name}'); return url.startsWith(prefix) && (!suffix || url.endsWith(suffix)) })
    try { return matchingTemplate?.label.trim() || new URL(url).hostname.replace(/^www\./, '') } catch { return matchingTemplate?.label.trim() || url }
  }).filter((label): label is string => Boolean(label))
}
export function scraperRunKey(sourceId: string, urls?: string[]): string {
  const normalizedUrls = urls?.map((url) => normalizeScraperUrl(url)).filter((url): url is string => Boolean(url))
  return `${sourceId}:${normalizedUrls?.length ? normalizedUrls.join('|') : '*'}`
}
export function isFailedWebsiteStat(source: ScraperSource, stat: NonNullable<ScraperSource['lastWebsiteStats']>[number]): boolean {
  if (stat.blocked) return true
  return Boolean(source.lastError && stat.pagesScraped === 0 && stat.found === 0 && stat.created === 0 && stat.updated === 0)
}
export function upsertScraperSource(sources: ScraperSource[] | undefined, updatedSource: ScraperSource): ScraperSource[] {
  const currentSources = sources ?? []
  const existingIndex = currentSources.findIndex((source) => source.id === updatedSource.id)
  return existingIndex === -1 ? [...currentSources, updatedSource] : currentSources.map((source, index) => index === existingIndex ? updatedSource : source)
}
