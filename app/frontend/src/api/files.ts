import { FileQueryParams, File, FilesResponse, GroupedFilesResponse, DirectoryRecord, DeletedFilesResponse } from '@/types/types'
import axios from 'axios'
import { API_BASE } from '@/api/client'

export const fileApi = {
  async getFiles(params: FileQueryParams, signal?: AbortSignal): Promise<FilesResponse> {
    const res = await axios.get(`${API_BASE}/files`, {
      signal,
      params: {
        page: params.page,
        limit: params.limit,
        search: params.search,
        type: params.type,
        format: params.format,
        date_range: params.dateRange,
        date_from: params.dateFrom || undefined,
        date_to: params.dateTo || undefined,
        directory_id: params.directoryId,
        directory_exclude: params.directoryExclude || undefined,
        sort_by: params.sortBy,
        sort_dir: params.sortDir,
        has_scenes: params.hasScenes || undefined,
        has_split: params.hasSplit || undefined,
        has_subtitle: params.hasSubtitle || undefined,
        has_no_scenes: params.hasNoScenes || undefined,
        has_no_split: params.hasNoSplit || undefined,
        has_no_subtitle: params.hasNoSubtitle || undefined,
        scene_count: params.sceneCount || undefined,
        status: params.status,
        queue_disabled: params.queueDisabled,
        split_disabled: params.splitDisabled,
        subtitle_disabled: params.subtitleDisabled,
        no_number_suffix: params.noNumberSuffix || undefined,
        new_videos: params.newVideos || undefined,
        content_tag: params.contentTag || undefined,
        resolution: params.resolution || undefined,
        file_size_operator: params.fileSizeOperator || undefined,
        file_size_bytes: params.fileSizeBytes ?? undefined,
      },
    })

    return res.data
  },

  async getGroupedFiles(params: FileQueryParams, signal?: AbortSignal): Promise<GroupedFilesResponse> {
    const res = await axios.get(`${API_BASE}/files/grouped`, {
      signal,
      params: {
        page: params.page,
        limit: params.limit,
        search: params.search,
        type: params.type,
        format: params.format,
        date_range: params.dateRange,
        date_from: params.dateFrom || undefined,
        date_to: params.dateTo || undefined,
        directory_id: params.directoryId,
        directory_exclude: params.directoryExclude || undefined,
        sort_by: params.sortBy,
        sort_dir: params.sortDir,
        has_scenes: params.hasScenes || undefined,
        has_split: params.hasSplit || undefined,
        has_subtitle: params.hasSubtitle || undefined,
        has_no_scenes: params.hasNoScenes || undefined,
        has_no_split: params.hasNoSplit || undefined,
        has_no_subtitle: params.hasNoSubtitle || undefined,
        scene_count: params.sceneCount || undefined,
        status: params.status,
        queue_disabled: params.queueDisabled,
        split_disabled: params.splitDisabled,
        subtitle_disabled: params.subtitleDisabled,
        no_number_suffix: params.noNumberSuffix || undefined,
        new_videos: params.newVideos || undefined,
        content_tag: params.contentTag || undefined,
        resolution: params.resolution || undefined,
        file_size_operator: params.fileSizeOperator || undefined,
        file_size_bytes: params.fileSizeBytes ?? undefined,
      },
    })
    return res.data
  },

  async getFileWithChildren(fileId: string): Promise<FilesResponse> {
    const res = await axios.get(`${API_BASE}/files/${encodeURIComponent(fileId)}/children-and-self`)
    return res.data
  },

  async getDeletedHistory(params: {
    page: number
    limit: number
    search?: string
    fileType?: string
  }): Promise<DeletedFilesResponse> {
    const res = await axios.get(`${API_BASE}/files/deleted-history`, {
      params: {
        page: params.page,
        limit: params.limit,
        search: params.search || undefined,
        file_type: params.fileType || undefined,
      },
    })
    return res.data
  },

  async getFileInfo(fileId: string): Promise<File> {
    const res = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}`)

    if (!res.ok) {
      throw new Error('Failed to fetch file info')
    }

    return res.json()
  },

  async deleteFile(fileId: string, options?: { deleteFromDisk?: boolean; deleteFromDatabase?: boolean }): Promise<void> {
    const params = new URLSearchParams({
      delete_from_disk: String(options?.deleteFromDisk ?? true),
      delete_from_database: String(options?.deleteFromDatabase ?? true),
    })
    const res = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}?${params.toString()}`, {
      method: 'DELETE',
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { detail?: string }).detail ?? 'Failed to delete file')
    }
  },

  async renameFile(fileId: string, newName: string): Promise<File> {
    const res = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_name: newName }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { detail?: string }).detail ?? 'Failed to rename file')
    }
    return res.json()
  },

  async moveFile(fileId: string, destinationDirectoryId: string): Promise<File> {
    const res = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}/move`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination_directory_id: destinationDirectoryId }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { detail?: string }).detail ?? 'Failed to move file')
    }
    return res.json()
  },

  async toggleQueueDisabled(fileId: string): Promise<File> {
    const res = await fetch(`${API_BASE}/files/${encodeURIComponent(fileId)}/queue-disabled`, {
      method: 'PATCH',
    })
    if (!res.ok) {
      throw new Error('Failed to toggle queue disabled')
    }
    return res.json()
  },

  async bulkDisableQueueDisabled(fileIds: string[]): Promise<File[]> {
    const res = await fetch(`${API_BASE}/files/queue-disabled/bulk-disable`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_ids: fileIds }),
    })
    if (!res.ok) {
      throw new Error('Failed to disable files from queue')
    }
    return res.json()
  },

  async bulkEnableQueueDisabled(fileIds: string[]): Promise<File[]> {
    const res = await fetch(`${API_BASE}/files/queue-disabled/bulk-enable`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_ids: fileIds }),
    })
    if (!res.ok) {
      throw new Error('Failed to enable files from queue')
    }
    return res.json()
  },

  async bulkDisableTaskType(taskType: 'split' | 'subtitle', fileIds: string[]): Promise<File[]> {
    const res = await fetch(`${API_BASE}/files/${taskType}-disabled/bulk-disable`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_ids: fileIds }),
    })
    if (!res.ok) {
      throw new Error(`Failed to disable files from ${taskType}`)
    }
    return res.json()
  },

  async bulkEnableTaskType(taskType: 'split' | 'subtitle', fileIds: string[]): Promise<File[]> {
    const res = await fetch(`${API_BASE}/files/${taskType}-disabled/bulk-enable`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_ids: fileIds }),
    })
    if (!res.ok) {
      throw new Error(`Failed to enable files for ${taskType}`)
    }
    return res.json()
  },

  async getFileContent(fileId: string): Promise<{ content: string }> {
    const res = await axios.get(`${API_BASE}/files/${encodeURIComponent(fileId)}/content`)
    return res.data
  },

  async saveFileContent(fileId: string, content: string): Promise<void> {
    await axios.put(`${API_BASE}/files/${encodeURIComponent(fileId)}/content`, { content })
  },

  async getDirectories(): Promise<DirectoryRecord[]> {
    const res = await axios.get(`${API_BASE}/directory`)
    return res.data
  },

  async cleanupMissingFiles(directoryPath?: string): Promise<{ deleted_files: string[]; deleted_directories: string[]; total_deleted: number }> {
    const url = directoryPath
      ? `${API_BASE}/directory/cleanup?directory_path=${encodeURIComponent(directoryPath)}`
      : `${API_BASE}/directory/cleanup`
    const res = await fetch(url, {
      method: 'DELETE',
    })

    if (!res.ok) {
      throw new Error('Failed to cleanup missing files')
    }

    return res.json()
  },

  async cleanupUnusedSubtitles(): Promise<{ deleted: number }> {
    const res = await fetch(`${API_BASE}/directory/cleanup-subtitles`, {
      method: 'DELETE',
    })

    if (!res.ok) {
      throw new Error('Failed to cleanup unused subtitles')
    }

    return res.json()
  },
}
