import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function legacyCopyText(text: string): void {
  const el = document.createElement('textarea')

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null

  const selection = document.getSelection()
  const previousSelection = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null

  el.value = text
  el.setAttribute('readonly', '')

  el.style.position = 'fixed'
  el.style.top = '0'
  el.style.left = '0'
  el.style.width = '1px'
  el.style.height = '1px'
  el.style.padding = '0'
  el.style.border = '0'
  el.style.opacity = '0'
  el.style.pointerEvents = 'none'

  // Keep the temporary element inside the active modal's focus scope.
  const activeDialog = document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]')

  const container = activeDialog ?? document.body
  container.appendChild(el)

  let copied = false

  try {
    el.focus({ preventScroll: true })
    el.select()
    el.setSelectionRange(0, el.value.length)

    copied = document.execCommand('copy')
  } finally {
    el.remove()

    const currentSelection = document.getSelection()
    if (currentSelection) {
      currentSelection.removeAllRanges()

      if (previousSelection) {
        currentSelection.addRange(previousSelection)
      }
    }

    previousFocus?.focus({ preventScroll: true })
  }

  if (!copied) {
    throw new Error('Copy command failed')
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    await navigator.clipboard.writeText(text)
    return
  }

  legacyCopyText(text)
}

export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let unitIndex = 0
  let size = bytes

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`
}

/** Convert a "HH:MM" UTC string to a local "HH:MM" string for display/input */
export function utcTimeToLocal(utcTime: string): string {
  const [h, m] = utcTime.split(':').map(Number)
  const offsetMinutes = new Date().getTimezoneOffset()
  const localTotal = h * 60 + m - offsetMinutes
  const lh = (((localTotal / 60) % 24) + 24) % 24
  const lm = ((localTotal % 60) + 60) % 60
  return `${String(Math.floor(lh)).padStart(2, '0')}:${String(Math.floor(lm)).padStart(2, '0')}`
}

/** Convert a local "HH:MM" string to a UTC "HH:MM" string for storage */
export function localTimeToUtc(localTime: string): string {
  const [h, m] = localTime.split(':').map(Number)
  const offsetMinutes = new Date().getTimezoneOffset()
  const utcTotal = h * 60 + m + offsetMinutes
  const uh = (((utcTotal / 60) % 24) + 24) % 24
  const um = ((utcTotal % 60) + 60) % 60
  return `${String(Math.floor(uh)).padStart(2, '0')}:${String(Math.floor(um)).padStart(2, '0')}`
}

/** Convert a UTC "HH:MM" string to a formatted local 12h time string (e.g. "2:00 AM") */
export function utcTimeToLocal12h(utcTime: string): string {
  const local = utcTimeToLocal(utcTime)
  const [h, m] = local.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function formatUtcTimestampToLocal(value: string): string {
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  const normalizedValue = hasTimezone ? value : `${value}Z`
  const date = new Date(normalizedValue)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}
