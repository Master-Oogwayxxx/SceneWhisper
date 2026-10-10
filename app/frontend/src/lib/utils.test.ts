import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { copyTextToClipboard } from './utils'

describe('copyTextToClipboard', () => {
  const originalClipboard = navigator.clipboard
  const originalExecCommand = document.execCommand
  const originalIsSecureContext = window.isSecureContext

  beforeEach(() => {
    document.execCommand = vi.fn().mockReturnValue(true)
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    })
    document.execCommand = originalExecCommand
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: originalIsSecureContext,
    })
    vi.restoreAllMocks()
  })

  it('falls back to execCommand when clipboard.writeText rejects', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    })

    await copyTextToClipboard('hello world')

    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('uses the legacy copy path immediately on insecure origins', async () => {
    const writeText = vi.fn()

    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText,
      },
    })

    await copyTextToClipboard('hello lan')

    expect(writeText).not.toHaveBeenCalled()
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })
})
