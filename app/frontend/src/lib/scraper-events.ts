export const OPEN_SCRAPER_FOR_ACTRESS_EVENT = 'open-scraper-for-actress'

export interface OpenScraperForActressDetail {
  actressName: string
}

export function dispatchOpenScraperForActress(detail: OpenScraperForActressDetail) {
  window.dispatchEvent(new CustomEvent<OpenScraperForActressDetail>(OPEN_SCRAPER_FOR_ACTRESS_EVENT, { detail }))
}
