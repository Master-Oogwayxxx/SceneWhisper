import { truncateAtWordBoundary } from './truncate'

describe('truncateAtWordBoundary', () => {
  it('returns full text if <= 100 characters', () => {
    const text = 'Short error message'
    expect(truncateAtWordBoundary(text, 100)).toBe(text)
  })

  it('truncates at word boundary for text > 100 characters', () => {
    const text = 'This is a very long error message that exceeds one hundred characters and should be truncated at a word boundary without cutting off mid-word'
    const result = truncateAtWordBoundary(text, 100)
    expect(result.length).toBeLessThanOrEqual(105) // Allow small buffer for word boundary
    expect(result.endsWith('…')).toBe(true)
  })

  it('appends ellipsis to truncated text', () => {
    const text = 'This is a very long error message that definitely exceeds the limit we set for truncation purposes here'
    const result = truncateAtWordBoundary(text, 50)
    expect(result.endsWith('…')).toBe(true)
  })

  it('finds last space within range for word boundary', () => {
    const text = 'Word1 Word2 Word3 Word4 Word5 Word6 Word7 Word8 Word9 Word10 Word11 Word12'
    const result = truncateAtWordBoundary(text, 40)
    // Result should end with ellipsis
    expect(result.endsWith('…')).toBe(true)
    // Result should truncate at a complete word, not mid-word (pattern: words with spaces, trimmed, then ellipsis)
    expect(result).toMatch(/^(Word\d+ )*Word\d+…$/)
  })
})
