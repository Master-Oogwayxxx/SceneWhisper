import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type React from 'react'
import { useFileSelection } from '../useFileSelection'
import type { File } from '@/types/types'

const makeFile = (id: string): File => ({
  id,
  name: `file-${id}.mp4`,
  path: `/path/file-${id}.mp4`,
  created_at: new Date(),
  modified_at: new Date(),
  size: 1000,
  format: 'mp4',
  file_type: 'video',
  duration: '00:01:00',
})

const mockEvent = (overrides: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) =>
  ({ shiftKey: false, ctrlKey: false, metaKey: false, ...overrides } as React.MouseEvent)

const files = [makeFile('a'), makeFile('b'), makeFile('c'), makeFile('d')]

describe('useFileSelection', () => {
  let setSelectedFiles: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setSelectedFiles = vi.fn()
  })

  it('plain click toggles the clicked file', () => {
    const { result } = renderHook(() => useFileSelection(files, [], setSelectedFiles))

    act(() => {
      result.current.handleFileClick(files[1], 1, mockEvent())
    })

    expect(setSelectedFiles).toHaveBeenCalledWith(expect.any(Function))
    const updater = setSelectedFiles.mock.calls[0][0] as (prev: File[]) => File[]
    expect(updater([])).toEqual([files[1]])
    expect(updater([files[1]])).toEqual([])
  })

  it('ctrl+click adds a file via functional update', () => {
    const { result } = renderHook(() => useFileSelection(files, [], setSelectedFiles))

    act(() => {
      result.current.handleFileClick(files[1], 1, mockEvent({ ctrlKey: true }))
    })

    expect(setSelectedFiles).toHaveBeenCalledWith(expect.any(Function))
    const updater = setSelectedFiles.mock.calls[0][0] as (prev: File[]) => File[]
    expect(updater([])).toEqual([files[1]])
    expect(updater([files[1]])).toEqual([])
  })

  it('meta+click (Mac) also toggles via functional update', () => {
    const { result } = renderHook(() => useFileSelection(files, [], setSelectedFiles))

    act(() => {
      result.current.handleFileClick(files[2], 2, mockEvent({ metaKey: true }))
    })

    expect(setSelectedFiles).toHaveBeenCalledWith(expect.any(Function))
    const updater = setSelectedFiles.mock.calls[0][0] as (prev: File[]) => File[]
    expect(updater([])).toEqual([files[2]])
  })

  it('shift+click selects range from anchor to clicked index (forward)', () => {
    const { result } = renderHook(() => useFileSelection(files, [], setSelectedFiles))

    act(() => {
      result.current.handleFileClick(files[0], 0, mockEvent()) // sets anchor=0
    })
    setSelectedFiles.mockClear()
    act(() => {
      result.current.handleFileClick(files[2], 2, mockEvent({ shiftKey: true }))
    })

    expect(setSelectedFiles).toHaveBeenCalledWith([files[0], files[1], files[2]])
  })

  it('shift+click selects range in reverse (anchor above clicked)', () => {
    const { result } = renderHook(() => useFileSelection(files, [], setSelectedFiles))

    act(() => {
      result.current.handleFileClick(files[3], 3, mockEvent()) // sets anchor=3
    })
    setSelectedFiles.mockClear()
    act(() => {
      result.current.handleFileClick(files[1], 1, mockEvent({ shiftKey: true }))
    })

    expect(setSelectedFiles).toHaveBeenCalledWith([files[1], files[2], files[3]])
  })

  it('anchor does not move on shift+click (repeated shift extends from same origin)', () => {
    const { result } = renderHook(() => useFileSelection(files, [], setSelectedFiles))

    act(() => {
      result.current.handleFileClick(files[0], 0, mockEvent()) // anchor=0
    })
    act(() => {
      result.current.handleFileClick(files[1], 1, mockEvent({ shiftKey: true })) // range 0-1
    })
    setSelectedFiles.mockClear()
    act(() => {
      result.current.handleFileClick(files[3], 3, mockEvent({ shiftKey: true })) // range 0-3, anchor still 0
    })

    expect(setSelectedFiles).toHaveBeenCalledWith([files[0], files[1], files[2], files[3]])
  })

  it('shift+click with no prior anchor behaves like plain click', () => {
    const { result } = renderHook(() => useFileSelection(files, [], setSelectedFiles))

    act(() => {
      result.current.handleFileClick(files[2], 2, mockEvent({ shiftKey: true }))
    })

    expect(setSelectedFiles).toHaveBeenCalledWith([files[2]])
  })

  it('anchor resets when files array changes (page navigation)', () => {
    const newFiles = [makeFile('x'), makeFile('y'), makeFile('z')]
    const { result, rerender } = renderHook(
      ({ fs }) => useFileSelection(fs, [], setSelectedFiles),
      { initialProps: { fs: files } },
    )

    act(() => {
      result.current.handleFileClick(files[0], 0, mockEvent()) // sets anchor=0
    })
    setSelectedFiles.mockClear()

    rerender({ fs: newFiles }) // simulates page change — should reset anchor

    act(() => {
      result.current.handleFileClick(newFiles[2], 2, mockEvent({ shiftKey: true }))
    })

    // With no anchor, shift+click is plain click
    expect(setSelectedFiles).toHaveBeenCalledWith([newFiles[2]])
  })
})
