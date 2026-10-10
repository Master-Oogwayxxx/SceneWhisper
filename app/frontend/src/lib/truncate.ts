/**
 * Truncates text at a word boundary near the max length.
 * If text is <= maxLength, returns it unchanged.
 * Otherwise, truncates at the last space before maxLength and appends "…".
 * If no space is found within [0, maxLength), truncates at maxLength (may cut mid-word).
 */
export function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  // Find the last space at or before maxLength
  let truncateAt = maxLength
  for (let i = Math.min(maxLength - 1, text.length - 1); i >= 0; i--) {
    if (text[i] === ' ') {
      truncateAt = i
      break
    }
  }

  return text.slice(0, truncateAt) + '…'
}
