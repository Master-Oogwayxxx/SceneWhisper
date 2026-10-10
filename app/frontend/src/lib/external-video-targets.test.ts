import { describe, expect, it } from 'vitest'

import { buildExternalVideoTargetUrl, getExternalVideoCodeFromFileName, isValidExternalVideoTarget } from './external-video-targets'

describe('external video targets', () => {
  it('builds a URL by substituting and encoding the video code', () => {
    const url = buildExternalVideoTargetUrl(
      { label: 'Google', url_template: 'https://www.google.com/search?q={videoCode}' },
      'ABP-123 uncensored'
    )

    expect(url).toBe('https://www.google.com/search?q=ABP-123%20uncensored')
  })

  it('builds a URL by substituting and encoding the actress name', () => {
    const url = buildExternalVideoTargetUrl(
      { label: 'Google', url_template: 'https://www.google.com/search?q={videoCode}+{actress}' },
      'ABP-123',
      'Yui Hatano'
    )

    expect(url).toBe('https://www.google.com/search?q=ABP-123+Yui%20Hatano')
  })

  it('treats targets without the placeholder as invalid', () => {
    expect(isValidExternalVideoTarget({ label: 'Google', url_template: 'https://www.google.com/search?q=' })).toBe(false)
  })

  it.each([
    ['DASS-787.mp4', 'DASS-787'],
    ['DASS-787-RM.mp4', 'DASS-787'],
    ['DASS-787-SUB.mkv', 'DASS-787'],
    ['DASS-787-RM-SUB.mp4', 'DASS-787'],
    ['DASS-787-RM-001.mp4', 'DASS-787'],
  ])('normalizes external video code %s', (fileName, expected) => {
    expect(getExternalVideoCodeFromFileName(fileName)).toBe(expected)
  })
})
