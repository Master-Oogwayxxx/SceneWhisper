import { directoryApi } from '@/api/directories'
import { File, Directory } from '@/types/types'
import { normalizePathForCompare, getParentDirectoryPathFromFilePath, collectSearchHits, findDirectoryChain } from '@/lib/dashboard-utils'
import { useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'

export const useDirectoryManager = (setSelectedFiles: React.Dispatch<React.SetStateAction<File[]>>) => {
  const [directoryTree, setDirectoryTree] = useState<Directory | null>(null)
  const [directories, setDirectories] = useState<Directory[]>([])
  const [directoryFiles, setDirectoryFiles] = useState<File[]>([])
  const [currentPath, setCurrentPath] = useState<string>('/videos')
  const [breadcrumb, setBreadcrumb] = useState<{ name: string; path: string }[]>([{ name: 'videos', path: '/videos' }])
  const [fileSearchQuery, setFileSearchQuery] = useState('')

  const loadInitialTree = useCallback(async () => {
    try {
      const result = await directoryApi.getDirectoryTree('/videos')
      setDirectoryTree(result)
      setDirectories(result.subdirectories)
      setDirectoryFiles(result.files)
    } catch (err) {
      console.error('Failed to load directory tree:', err)
    }
  }, [])

  const handleNavigateJump = async (path: string): Promise<void> => {
    if (path === currentPath) return

    try {
      setCurrentPath(path)

      // Find the index of the target path in breadcrumb
      const targetIndex = breadcrumb.findIndex((crumb) => crumb.path === path)
      if (targetIndex !== -1) {
        // Update breadcrumb to the target level
        setBreadcrumb((prev) => prev.slice(0, targetIndex + 1))
      }

      // Find the directory in our existing tree structure
      let targetDirectory: Directory | null = null

      // If we're going back to root level
      if (path === '/videos') {
        targetDirectory = directoryTree
      } else {
        // Search through the directory tree to find the target path
        const searchDirectory = (dir: Directory, targetPath: string): Directory | null => {
          if (dir.path === targetPath) return dir
          for (const subDir of dir.subdirectories || []) {
            const found = searchDirectory(subDir, targetPath)
            if (found) return found
          }
          return null
        }

        if (directoryTree) {
          targetDirectory = searchDirectory(directoryTree, path)
        }
      }

      // Update the UI with the contents of the target directory
      if (targetDirectory) {
        setDirectories(targetDirectory.subdirectories || [])
        setDirectoryFiles(targetDirectory.files || [])
      } else {
        // If we can't find the directory in our tree, reset to empty state
        setDirectories([])
        setDirectoryFiles([])
      }
    } catch (err) {
      console.error('Failed to navigate to path:', err)
      toast.error('Failed to navigate to directory')
    }
  }

  const handleNavigateBack = async () => {
    if (breadcrumb.length > 1) {
      const newPath = breadcrumb[breadcrumb.length - 2].path
      setCurrentPath(newPath)

      // Update breadcrumb to remove last entry
      setBreadcrumb((prev) => prev.slice(0, -1))

      // Try to find the parent directory from existing state
      try {
        // If we're going back to the root level (/videos), use initial data
        if (newPath === '/videos') {
          setDirectories(directoryTree?.subdirectories || [])
          setDirectoryFiles(directoryTree?.files || [])
        } else {
          // Find the directory in our current tree structure
          let parentDirectory = null

          // If we have a directoryTree, search for the parent directory
          if (directoryTree) {
            const findDirectory = (dir: Directory, path: string): Directory | null => {
              if (dir.path === path) return dir
              for (const subDir of dir.subdirectories || []) {
                const found = findDirectory(subDir, path)
                if (found) return found
              }
              return null
            }

            parentDirectory = findDirectory(directoryTree, newPath)
          }

          // If we found the directory in our tree, use its contents
          if (parentDirectory) {
            setDirectories(parentDirectory.subdirectories || [])
            setDirectoryFiles(parentDirectory.files || [])
          } else {
            // If parent directory not found in current state, reset to root
            // But only if we have a directoryTree
            if (directoryTree) {
              setDirectories(directoryTree.subdirectories || [])
              setDirectoryFiles(directoryTree.files || [])
            } else {
              setDirectories([])
              setDirectoryFiles([])
            }
          }
        }
      } catch (err) {
        console.error('Failed to load parent directory contents:', err)
        toast.error('Failed to load directory contents')
        // Reset to default state if loading fails
        setDirectories([])
        setDirectoryFiles([])
      }
    }
  }

  /**
   * Navigates the files view to a directory by full path, rebuilding breadcrumb from the loaded tree.
   *
   * @param targetPath - Directory path to open
   */
  const navigateToDirectoryPath = (targetPath: string): void => {
    if (!directoryTree) {
      toast.error('Directory tree not loaded')
      return
    }
    const targetNorm = normalizePathForCompare(targetPath)
    if (normalizePathForCompare(directoryTree.path) === targetNorm) {
      setCurrentPath(directoryTree.path)
      setBreadcrumb([{ name: directoryTree.name, path: directoryTree.path }])
      setDirectories(directoryTree.subdirectories)
      setDirectoryFiles(directoryTree.files)
      return
    }
    const chain = findDirectoryChain(directoryTree, targetNorm)
    if (!chain) {
      toast.error('Could not find that folder in the tree. Try scanning directories first.')
      return
    }
    const last = chain[chain.length - 1]
    setCurrentPath(last.path)
    setBreadcrumb(chain.map((d) => ({ name: d.name, path: d.path })))
    setDirectories(last.subdirectories)
    setDirectoryFiles(last.files)
  }

  // Memoized search logic
  const allSearchHits = useMemo(() => {
    if (!directoryTree) return []
    return collectSearchHits(directoryTree)
  }, [directoryTree])

  const filteredSearchHits = useMemo(() => {
    const q = fileSearchQuery.trim().toLowerCase()
    if (!q) return []
    return allSearchHits
      .filter((hit) => {
        if (hit.kind === 'directory') {
          const d = hit.directory
          return d.name.toLowerCase().includes(q) || d.path.toLowerCase().includes(q)
        }
        const f = hit.file
        return f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
      })
      .slice(0, 100)
  }, [allSearchHits, fileSearchQuery])

  const handleScanAllDirectories = async () => {
    try {
      const allDirectories = await directoryApi.scanAllDirectories()
      // For scanAllDirectories, we'll set the first directory's contents as the current view
      if (allDirectories.length > 0) {
        // Update the directory tree to reflect all directories
        setDirectoryTree(allDirectories[0])
        setDirectories(allDirectories[0].subdirectories)
        setDirectoryFiles(allDirectories[0].files)
        setCurrentPath('/videos')
        setBreadcrumb([{ name: 'videos', path: '/videos' }])
      }
      toast.success('All directories loaded')
    } catch (err) {
      console.error('Failed to load all directories:', err)
      toast.error('Failed to load all directories')
    }
  }

  const handleShowFilesInDirectory = async (directory: Directory) => {
    try {
      // Update state with the selected directory's contents
      setDirectories(directory.subdirectories)
      setDirectoryFiles(directory.files)

      const pathParts = directory.path.split('\\').filter((part) => part !== '')
      const directoryName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '/videos'

      // Create new breadcrumb entry for this directory
      const newBreadcrumb = [{ name: directoryName, path: directory.path }]

      setBreadcrumb((prev) => [...prev, ...newBreadcrumb])
      setCurrentPath(directory.path)
    } catch (err) {
      console.error('Failed to load directory contents:', err)
    }
  }

  /**
   * Opens the folder containing the file and selects it for tasks.
   *
   * @param file - File to reveal
   */
  const navigateToFileFromSearch = (file: File): void => {
    const parent = getParentDirectoryPathFromFilePath(file.path)
    if (!parent) {
      toast.error('Could not resolve the file folder')
      return
    }
    navigateToDirectoryPath(parent)
    setSelectedFiles([file])
  }

  return {
    directoryTree,
    directories,
    directoryFiles,
    currentPath,
    breadcrumb,
    fileSearchQuery,
    setFileSearchQuery,
    filteredSearchHits,
    loadInitialTree,
    handleNavigateJump,
    handleNavigateBack,
    navigateToDirectoryPath,
    setDirectoryTree,
    setDirectories,
    setDirectoryFiles,
    setBreadcrumb,
    setCurrentPath,
    handleScanAllDirectories,
    handleShowFilesInDirectory,
    navigateToFileFromSearch,
  }
}
