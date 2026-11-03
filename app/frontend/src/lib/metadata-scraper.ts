import { scraperApi } from '@/api/scraper'
import { MetadataScraperConfig, ScraperSource } from '@/types/types'

export const EMPTY_METADATA_SCRAPER_CONFIG: MetadataScraperConfig = {
  site_name: '', base_url: '', movie_url: '', actress_url: '', listing_url: '', pagination: '',
  requires_access: false, available_fields: [], selectors: '',
}

export const SCRAPER_METADATA_FIELDS = ['Video code', 'Title', 'Actresses', 'Release date', 'Manufacturer', 'Cover image', 'Genres', 'Content type', 'Source URL']

export interface MetadataScraperProgress {
  progress: number
  pagesScraped: number
  totalPages: number
  currentUrl: string
}

interface RunMetadataScraperOptions {
  actressId: number
  actressName: string
  actressUrl: string
  isActive: boolean
  onProgress: (progress: MetadataScraperProgress) => void
  onComplete: (videoCount: number) => void
  schedule: ScraperSource['schedule']
}

export async function runMetadataScraper({ actressId, actressName, actressUrl, isActive, schedule, onProgress, onComplete }: RunMetadataScraperOptions) {
  const sourceId = `metadata-${actressId}`
  const existing = (await scraperApi.getSources()).find((item) => item.id === sourceId)
  const sourcePayload: ScraperSource = {
    ...(existing ?? {}),
    id: sourceId,
    name: `Metadata: ${actressName}`,
    url: actressUrl,
    urls: [actressUrl],
    urlActressNameReversed: [false],
    schedule,
    isActive,
    lastFound: 0,
    lastNew: 0,
    lastPagesScraped: 0,
    createdAt: existing?.createdAt ?? new Date(),
  }
  const source = existing ? await scraperApi.updateSource(sourcePayload) : await scraperApi.createSource(sourcePayload)

  onProgress({ progress: 0, pagesScraped: 0, totalPages: 0, currentUrl: source.url })
  const runPromise = scraperApi.runSource({ sourceId: source.id })
  while (true) {
    const progress = (await scraperApi.getSourceProgress()).find((item) => item.sourceId === source.id)
    if (progress) {
      onProgress({ progress: progress.progress, pagesScraped: progress.pagesScraped, totalPages: progress.totalPages, currentUrl: progress.currentUrl })
    }
    const settled = await Promise.race([runPromise.then(() => true), new Promise<false>((resolve) => window.setTimeout(() => resolve(false), 1000))])
    if (settled) break
  }
  await runPromise
  const results = await scraperApi.getVideos(source.id, undefined, 1, 500)
  await scraperApi.assignVideosToActresses(results.items.map((video) => video.id), [actressId])
  onComplete(results.items.length)
}
