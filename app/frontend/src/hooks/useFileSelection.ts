import { useRef, useEffect, useCallback } from 'react'
import type React from 'react'
import type { File } from '@/types/types'

export function useFileSelection(
  files: File[],
  // Reserved for future use (e.g. controlled selection); not read by hook logic
  _selectedFiles: File[],
  setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>,
) {
  const anchorIndexRef = useRef<number | null>(null)

  // Anchor resets when the files page changes; caller must stabilize the files reference
  useEffect(() => {
    anchorIndexRef.current = null
  }, [files])

  const handleFileClick = useCallback(
    (file: File, index: number, e: React.MouseEvent) => {
      if (e.shiftKey && anchorIndexRef.current !== null) {
        e.preventDefault()
        const start = Math.min(anchorIndexRef.current, index)
        const end = Math.max(anchorIndexRef.current, index)
        setSelectedFiles(files.slice(start, end + 1))
      } else if (e.shiftKey) {
        // Shift+click with no anchor: select only this file
        e.preventDefault()
        setSelectedFiles([file])
        anchorIndexRef.current = index
      } else {
        // Plain click or ctrl/cmd+click: toggle selection
        setSelectedFiles(prev =>
          prev.some(f => f.id === file.id)
            ? prev.filter(f => f.id !== file.id)
            : [...prev, file],
        )
        anchorIndexRef.current = index
      }
    },
    [files, setSelectedFiles],
  )

  return { handleFileClick }
}
