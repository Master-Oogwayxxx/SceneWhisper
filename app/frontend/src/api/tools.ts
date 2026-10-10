import axios from 'axios'
import type { BookmarkVideoCheckItem, BookmarkVideoCheckResponse, File } from '@/types/types'

import { API_BASE } from '@/api/client'

interface ApiBookmarkVideoCheckItem {
  title: string
  url: string
  video_code: string
  bookmark_path?: string | null
  file_exists: boolean
  matched_files: File[]
}

interface ApiBookmarkVideoCheckResponse {
  items: ApiBookmarkVideoCheckItem[]
  total: number
  existing: number
}

function fromApiItem(item: ApiBookmarkVideoCheckItem): BookmarkVideoCheckItem {
  return {
    title: item.title,
    url: item.url,
    videoCode: item.video_code,
    bookmarkPath: item.bookmark_path ?? undefined,
    fileExists: item.file_exists,
    matchedFiles: item.matched_files,
  }
}

export const toolsApi = {
  async scanSubtitleHealth(): Promise<SubtitleHealthResponse> {
    const res = await axios.get<ApiSubtitleHealthResponse>(`${API_BASE}/tools/subtitles/health`)
    return {
      totalVideos: res.data.total_videos,
      totalSubtitles: res.data.total_subtitles,
      missingSubtitles: res.data.missing_subtitles.map(fromApiSubtitleHealthItem),
      missingSubtitleFiles: res.data.missing_subtitle_files.map(fromApiSubtitleHealthItem),
      emptySubtitles: res.data.empty_subtitles.map(fromApiSubtitleHealthItem),
      orphanedSubtitles: res.data.orphaned_subtitles.map(fromApiSubtitleHealthItem),
    }
  },
  async deleteOrphanedSubtitles(fileIds: string[]): Promise<DeleteOrphanedSubtitlesResponse> {
    const res = await axios.post<ApiDeleteOrphanedSubtitlesResponse>(`${API_BASE}/tools/subtitles/orphaned/delete`, { file_ids: fileIds })
    return {
      deleted: res.data.deleted,
      skipped: res.data.skipped,
      deletedFiles: res.data.deleted_files,
    }
  },
  async deleteSubtitleHealthSrtFiles(fileIds: string[], issue: SubtitleHealthItem['issue']): Promise<DeleteSubtitleHealthFilesResponse> {
    const res = await axios.post<ApiDeleteSubtitleHealthFilesResponse>(`${API_BASE}/tools/subtitles/health/delete-srt`, { file_ids: fileIds, issue })
    return {
      deleted: res.data.deleted,
      skipped: res.data.skipped,
      deletedFiles: res.data.deleted_files,
    }
  },
  async analyzeFramePacing(fileId: string): Promise<FramePacingAnalysis> {
    const res = await axios.post<ApiFramePacingAnalysis>(`${API_BASE}/tools/frame-pacing/analyze`, { file_id: fileId })
    return fromApiFramePacingAnalysis(res.data)
  },
  async analyzeFramePacingWithProgress(fileId: string, onProgress: (progress: FramePacingProgress) => void): Promise<FramePacingAnalysis> {
    const response = await fetch(`${API_BASE}/tools/frame-pacing/analyze/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(detail || 'Analysis failed')
    }
    if (!response.body) throw new Error('Analysis stream was not available')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalResult: FramePacingAnalysis | null = null

    const consumeLine = (line: string) => {
      if (!line.trim()) return
      const event = JSON.parse(line) as ApiFramePacingStreamEvent
      if (event.event === 'progress') {
        onProgress({
          fileId: event.file_id,
          progress: event.progress,
          framesAnalyzed: event.frames_analyzed,
          message: event.message,
        })
        return
      }
      if (event.event === 'result') {
        finalResult = fromApiFramePacingAnalysis(event)
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      lines.forEach(consumeLine)
      if (done) break
    }
    consumeLine(buffer)
    if (!finalResult) throw new Error('Analysis finished without a result')
    return finalResult
  },
  async startFramePacingRun(fileIds: string[]): Promise<FramePacingRun> {
    const res = await axios.post<ApiFramePacingRun>(`${API_BASE}/tools/frame-pacing/runs`, { file_ids: fileIds })
    return fromApiFramePacingRun(res.data)
  },
  async getLatestFramePacingRun(): Promise<FramePacingRun | null> {
    const res = await axios.get<ApiFramePacingRun | null>(`${API_BASE}/tools/frame-pacing/runs/latest`)
    return res.data ? fromApiFramePacingRun(res.data) : null
  },
  async getFramePacingRun(runId: string): Promise<FramePacingRun> {
    const res = await axios.get<ApiFramePacingRun>(`${API_BASE}/tools/frame-pacing/runs/${encodeURIComponent(runId)}`)
    return fromApiFramePacingRun(res.data)
  },
  async cancelFramePacingRun(runId: string): Promise<FramePacingRun> {
    const res = await axios.post<ApiFramePacingRun>(`${API_BASE}/tools/frame-pacing/runs/${encodeURIComponent(runId)}/cancel`)
    return fromApiFramePacingRun(res.data)
  },
  async checkBookmarkVideos(items: BookmarkVideoCheckItem[], directoryIds: string[] = []): Promise<BookmarkVideoCheckResponse> {
    const res = await axios.post<ApiBookmarkVideoCheckResponse>(`${API_BASE}/tools/bookmarks/check`, {
      directory_ids: directoryIds,
      items: items.map((item) => ({
        title: item.title,
        url: item.url,
        video_code: item.videoCode,
        file_exists: item.fileExists,
        bookmark_path: item.bookmarkPath,
      })),
    })

    return {
      items: res.data.items.map(fromApiItem),
      total: res.data.total,
      existing: res.data.existing,
    }
  },
}

interface ApiSubtitleHealthItem {
  file: File
  issue: SubtitleHealthItem['issue']
  message: string
  related_video?: File | null
}

interface ApiSubtitleHealthResponse {
  total_videos: number
  total_subtitles: number
  missing_subtitles: ApiSubtitleHealthItem[]
  missing_subtitle_files: ApiSubtitleHealthItem[]
  empty_subtitles: ApiSubtitleHealthItem[]
  orphaned_subtitles: ApiSubtitleHealthItem[]
}

interface ApiDeleteOrphanedSubtitlesResponse {
  deleted: number
  skipped: number
  deleted_files: File[]
}

interface ApiDeleteSubtitleHealthFilesResponse {
  deleted: number
  skipped: number
  deleted_files: File[]
}

function fromApiSubtitleHealthItem(item: ApiSubtitleHealthItem): SubtitleHealthItem {
  return {
    file: item.file,
    issue: item.issue,
    message: item.message,
    relatedVideo: item.related_video,
  }
}

export interface SubtitleHealthItem {
  file: File
  issue: 'missing_subtitle' | 'missing_subtitle_file' | 'empty_subtitle' | 'orphaned_subtitle'
  message: string
  relatedVideo?: File | null
}

export interface SubtitleHealthResponse {
  totalVideos: number
  totalSubtitles: number
  missingSubtitles: SubtitleHealthItem[]
  missingSubtitleFiles: SubtitleHealthItem[]
  emptySubtitles: SubtitleHealthItem[]
  orphanedSubtitles: SubtitleHealthItem[]
}

export interface DeleteOrphanedSubtitlesResponse {
  deleted: number
  skipped: number
  deletedFiles: File[]
}

export interface DeleteSubtitleHealthFilesResponse {
  deleted: number
  skipped: number
  deletedFiles: File[]
}

function fromApiFramePacingAnalysis(item: ApiFramePacingAnalysis): FramePacingAnalysis {
  return {
    fileId: item.file_id,
    status: item.status,
    score: item.score,
    detectedFps: item.detected_fps,
    recommendedFps: item.recommended_fps,
    framesAnalyzed: item.frames_analyzed,
    irregularFrames: item.irregular_frames,
    largeGaps: item.large_gaps,
    repeatedFrames: item.repeated_frames,
    irregularPercent: item.irregular_percent,
    message: item.message,
  }
}

interface ApiFramePacingAnalysis {
  file_id: string
  status: FramePacingAnalysis['status']
  score: number
  detected_fps?: number | null
  recommended_fps?: number | null
  frames_analyzed: number
  irregular_frames: number
  large_gaps: number
  repeated_frames: number
  irregular_percent: number
  message?: string | null
}

interface ApiFramePacingProgress {
  event: 'progress'
  file_id: string
  progress: number
  frames_analyzed: number
  message?: string | null
  created_at?: string | null
}

interface ApiFramePacingRunResult extends ApiFramePacingAnalysis {
  file: File
  analysis_time_ms: number
}

interface ApiFramePacingRun {
  id: string
  status: FramePacingRun['status']
  total: number
  done: number
  error?: string | null
  created_at: string
  started_at?: string | null
  completed_at?: string | null
  files: File[]
  results: ApiFramePacingRunResult[]
  progress: ApiFramePacingProgress[]
}

type ApiFramePacingStreamEvent = (ApiFramePacingAnalysis & { event: 'result' }) | ApiFramePacingProgress

export interface FramePacingAnalysis {
  fileId: string
  status: 'healthy' | 'suspect' | 'severe' | 'unknown' | 'error'
  score: number
  detectedFps?: number | null
  recommendedFps?: number | null
  framesAnalyzed: number
  irregularFrames: number
  largeGaps: number
  repeatedFrames: number
  irregularPercent: number
  message?: string | null
}

export interface FramePacingRunResult extends FramePacingAnalysis {
  file: File
  analysisTimeMs: number
}

export interface FramePacingRun {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  total: number
  done: number
  error?: string | null
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
  files: File[]
  results: FramePacingRunResult[]
  progress: FramePacingProgress[]
}

export interface FramePacingProgress {
  fileId: string
  progress: number
  framesAnalyzed: number
  message?: string | null
  createdAt?: string | null
}

function fromApiFramePacingRun(item: ApiFramePacingRun): FramePacingRun {
  return {
    id: item.id,
    status: item.status,
    total: item.total,
    done: item.done,
    error: item.error,
    createdAt: item.created_at,
    startedAt: item.started_at,
    completedAt: item.completed_at,
    files: item.files,
    progress: item.progress.map((progress) => ({
      fileId: progress.file_id,
      progress: progress.progress,
      framesAnalyzed: progress.frames_analyzed,
      message: progress.message,
      createdAt: progress.created_at,
    })),
    results: item.results.map((result) => ({
      ...fromApiFramePacingAnalysis(result),
      file: result.file,
      analysisTimeMs: result.analysis_time_ms,
    })),
  }
}
