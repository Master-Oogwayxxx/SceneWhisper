import { File, Stats, Directory, Task, DirectoryMonitor } from '@/types/types'

/** Normalizes path separators and casing for stable comparisons. */
export function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * Returns the parent directory path for a file path (handles mixed separators).
 *
 * @param filePath - Full filesystem path to a file
 * @returns Parent directory path, or empty string if none could be derived
 */
export function getParentDirectoryPathFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/\//g, '\\')
  const lastSlash = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
  if (lastSlash <= 0) return ''
  return normalized.slice(0, lastSlash)
}

type FileSearchHit = { kind: 'directory'; directory: Directory } | { kind: 'file'; file: File }

/**
 * Collects every directory and file in the tree for global search.
 *
 * @param root - Root directory node
 * @returns Flat list of directory and file hits
 */
export function collectSearchHits(root: Directory): FileSearchHit[] {
  const hits: FileSearchHit[] = [{ kind: 'directory', directory: root }]
  for (const file of root.files) {
    hits.push({ kind: 'file', file })
  }
  for (const sub of root.subdirectories) {
    hits.push(...collectSearchHits(sub))
  }
  return hits
}

/**
 * Finds the chain of directories from root down to a matching path.
 *
 * @param root - Tree root
 * @param targetNorm - Target path, normalized with `normalizePathForCompare`
 * @returns Directory chain from root to target, or null if not found
 */
export function findDirectoryChain(root: Directory, targetNorm: string): Directory[] | null {
  if (normalizePathForCompare(root.path) === targetNorm) {
    return [root]
  }
  for (const sub of root.subdirectories) {
    const chain = findDirectoryChain(sub, targetNorm)
    if (chain) {
      return [root, ...chain]
    }
  }
  return null
}

export function calculateNextRun(schedule: DirectoryMonitor['schedule']): Date {
  const now = new Date()
  const next = new Date()

  switch (schedule.interval) {
    case 'hourly':
      next.setHours(now.getHours() + 1, 0, 0, 0)
      break
    case 'daily':
      if (schedule.time) {
        const [hours, minutes] = schedule.time.split(':').map(Number)
        next.setHours(hours, minutes, 0, 0)
        if (next <= now) next.setDate(next.getDate() + 1)
      }
      break
    case 'weekly':
      if (schedule.time && schedule.dayOfWeek !== undefined) {
        const [hours, minutes] = schedule.time.split(':').map(Number)
        next.setHours(hours, minutes, 0, 0)
        const daysUntilNext = (schedule.dayOfWeek - now.getDay() + 7) % 7 || 7
        next.setDate(now.getDate() + daysUntilNext)
      }
      break
  }
  return next
}

export function findDirectoryById(directories: Directory[], id: string): Directory | null {
  for (const directory of directories) {
    if (directory.id === id) return directory
    const found = findDirectoryById(directory.subdirectories, id)
    if (found) return found
  }
  return null
}

export function getAllFilesFromDirectory(directory: Directory): File[] {
  const files = [...directory.files]
  directory.subdirectories.forEach((subdirectory) => {
    files.push(...getAllFilesFromDirectory(subdirectory))
  })

  return files
}

export function filterOriginFiles(files: File[]): File[] {
  return files.filter((file) => {
    const match = file.name.match(/-(\d{3})(?=\.\w+$|$)/)

    if (match) {
      const num = parseInt(match[1], 999)
      // Return false if it's in our "blacklist" (001 to 999)
      if (num >= 1 && num <= 999) return false
    }

    return true
  })
}

export function getGroupedFiles(files: File[]): File[][] {
  if (!files || files.length === 0) {
    return []
  }

  // First, try to group by parent-child relationships
  const groups: { [key: string]: File[] } = {}
  const usedFiles: Set<string> = new Set()

  // Create a map of all files by id for quick lookup
  const fileMap: { [key: string]: File } = {}
  for (const file of files) {
    fileMap[file.id] = file
  }

  // Group files that have parent-child relationships based on parent_id
  for (const file of files) {
    if (usedFiles.has(file.id)) continue

    // Check if this file has a parent (i.e., it's a child)
    if (file.parent_id && fileMap[file.parent_id]) {
      // This is a child file - find its parent and create group with parent + other children
      const parent = fileMap[file.parent_id]

      // Start group with the parent and this child
      const group: File[] = [parent, file]
      usedFiles.add(parent.id)
      usedFiles.add(file.id)

      // Find all siblings (children of the same parent)
      const siblings = files.filter((f) => f.parent_id === parent.id && f.id !== file.id)

      // Add siblings to the group
      for (const sibling of siblings) {
        if (!usedFiles.has(sibling.id)) {
          group.push(sibling)
          usedFiles.add(sibling.id)
        }
      }

      // Only add the group if it has more than one file (meaning there was a parent-child relationship)
      if (group.length > 1) {
        const key = `group-${parent.id}`
        groups[key] = group
      }
    } else {
      // This is a parent file - check for children and create group
      const children = files.filter((f) => f.parent_id === file.id)

      // If there are children, group this parent with its children
      if (children.length > 0) {
        const group: File[] = [file]
        usedFiles.add(file.id)

        // Add children to the group
        for (const child of children) {
          if (!usedFiles.has(child.id)) {
            group.push(child)
            usedFiles.add(child.id)
          }
        }

        // Only add the group if it has more than one file (meaning there was a parent-child relationship)
        if (group.length > 1) {
          const key = `group-${file.id}`
          groups[key] = group
        }
      }
    }
  }

  // If we found parent-child relationship groups, return them as the primary grouping
  const parentChildGroups = Object.values(groups)
  if (parentChildGroups.length > 0) {
    return parentChildGroups
  }

  // Fallback to prefix-based grouping as secondary method
  // Create a map to group by directory + base name prefix
  const prefixMap: { [key: string]: File[] } = {}

  // For each file, extract the common prefix pattern using regex
  for (const file of files) {
    const dir = file.path.includes('/')
      ? file.path.substring(0, file.path.lastIndexOf('/'))
      : file.path.includes('\\')
        ? file.path.substring(0, file.path.lastIndexOf('\\'))
        : ''
    const fileName = file.name.toLowerCase()
    const baseName = fileName.replace(/\.[^/.]+$/, '')

    // Extract prefix using regex - match all parts before the final numeric sequence
    // This handles patterns like "movie-name-001" -> prefix "movie-name"
    const match = baseName.match(/^(.*?)(-\d+)$/)

    let namePrefix = baseName

    if (match) {
      // Extract the part before the last numeric sequence
      namePrefix = match[1]
    } else {
      // Fallback for cases where there's no numeric suffix or other edge cases
      const parts = baseName.split('-')
      if (parts.length >= 2) {
        // Check if the last part is numeric, if so, remove it from prefix
        const lastPart = parts[parts.length - 1]
        if (/^\d+$/.test(lastPart)) {
          namePrefix = parts.slice(0, -1).join('-')
        }
      }
    }

    const key = `${dir}::${namePrefix}`
    if (!prefixMap[key]) {
      prefixMap[key] = []
    }
    prefixMap[key].push(file)
  }

  // Return groups with multiple files (indicating a group)
  return Object.values(prefixMap).filter((group) => group.length > 1)
}
