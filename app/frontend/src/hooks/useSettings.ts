import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import { AppSettings } from '@/types/types'

const SETTINGS_KEY = ['settings'] as const

export const PROCESSING_SETTINGS_DEFAULTS = {
  task_poll_interval_ms: 3000,
  task_stall_minutes: 10,
  scene_timeout_minutes: 60,
  scene_detector: 'content',
  scene_content_threshold: 35,
  scene_adaptive_threshold: 3.0,
  scene_black_threshold: 12.0,
  scene_white_threshold: 240.0,
  min_scene_length_frames: 90,
  scene_detection_concurrency: 1,
  frame_pacing_analyzer_concurrency: 4,
  frame_pacing_analyzer_timeout_minutes: 30,
  split_timeout_minutes: 60,
  split_concurrency: 3,
  subtitle_timeout_minutes: 60,
  subtitle_concurrency: 2,
  split_min_video_duration_seconds: 0,
} satisfies Partial<AppSettings>

const DEFAULTS: AppSettings = {
  default_task_type: 'split',
  default_subtitle_language: 'en',
  default_layout: 'grid',
  show_stats_panel: true,
  show_actress_work_covers: false,
  show_actress_work_titles: true,
  default_sort_field: 'name',
  default_sort_direction: 'asc',
  monitor_sort_field: 'directoryName',
  monitor_sort_direction: 'asc',
  ignore_patterns: [],
  selected_scan_directories: [],
  external_video_targets: [
    {
      label: 'Google',
      url_template: 'https://www.google.com/search?q={videoCode}',
    },
  ],
  scraper_templates: [
    {
      label: 'JavPlayer',
      url_template: 'https://javplayer.org/model/{actress_name}',
    },
  ],
  task_type_priority: ['all', 'merge', 'subtitle', 'split', 'scene', 'analyze_frame_pacing', 'nvenc_frame_pacing', 'remux'],
  scene_detector: PROCESSING_SETTINGS_DEFAULTS.scene_detector,
  scene_content_threshold: PROCESSING_SETTINGS_DEFAULTS.scene_content_threshold,
  scene_adaptive_threshold: PROCESSING_SETTINGS_DEFAULTS.scene_adaptive_threshold,
  scene_black_threshold: PROCESSING_SETTINGS_DEFAULTS.scene_black_threshold,
  scene_white_threshold: PROCESSING_SETTINGS_DEFAULTS.scene_white_threshold,
  min_scene_length_frames: PROCESSING_SETTINGS_DEFAULTS.min_scene_length_frames,
  scene_detection_concurrency: PROCESSING_SETTINGS_DEFAULTS.scene_detection_concurrency,
  frame_pacing_analyzer_concurrency: PROCESSING_SETTINGS_DEFAULTS.frame_pacing_analyzer_concurrency,
  frame_pacing_analyzer_timeout_minutes: PROCESSING_SETTINGS_DEFAULTS.frame_pacing_analyzer_timeout_minutes,
  split_min_video_duration_seconds: PROCESSING_SETTINGS_DEFAULTS.split_min_video_duration_seconds,
  split_gpu_required: false,
  subtitle_gpu_required: false,
  task_poll_interval_ms: PROCESSING_SETTINGS_DEFAULTS.task_poll_interval_ms,
  auto_cleanup_on_scan: false,
  scan_schedule_enabled: false,
  scan_schedule_time: null,
  scan_schedule_time_zone: null,
  scan_schedule_mode: 'all',
  scan_schedule_last_run: null,
  scan_schedule_next_run: null,
  scan_schedule_last_error: null,
  task_timeout_minutes: 60,
  scene_timeout_minutes: PROCESSING_SETTINGS_DEFAULTS.scene_timeout_minutes,
  split_timeout_minutes: PROCESSING_SETTINGS_DEFAULTS.split_timeout_minutes,
  subtitle_timeout_minutes: PROCESSING_SETTINGS_DEFAULTS.subtitle_timeout_minutes,
  task_stall_minutes: PROCESSING_SETTINGS_DEFAULTS.task_stall_minutes,
  split_concurrency: PROCESSING_SETTINGS_DEFAULTS.split_concurrency,
  subtitle_concurrency: PROCESSING_SETTINGS_DEFAULTS.subtitle_concurrency,
  processing_hours_enabled: false,
  processing_hours_start: 2,
  processing_hours_end: 19,
  processing_hours_windows: {
    mon: { start: 2, end: 19 },
    tue: { start: 2, end: 19 },
    wed: { start: 2, end: 19 },
    thu: { start: 2, end: 19 },
    fri: { start: 2, end: 19 },
    sat: { start: 2, end: 19 },
    sun: { start: 2, end: 19 },
  },
  processing_mon: true,
  processing_tue: true,
  processing_wed: true,
  processing_thu: true,
  processing_fri: true,
  processing_sat: true,
  processing_sun: true,
  qbittorrent_url: '',
  qbittorrent_username: '',
  qbittorrent_password: '',
  queue_base_delay_seconds: 60,
  queue_jitter_seconds: 30,
  queue_window_start_hour: 0,
  queue_window_end_hour: 0,
  queue_download_time_limit_minutes: 0,
  r18_auto_refresh_enabled: false,
  r18_auto_refresh_time: null,
  r18_auto_refresh_day_of_week: null,
  r18_auto_refresh_last_run: null,
  r18_auto_refresh_next_run: null,
  r18_auto_refresh_last_error: null,
}

export function useSettings() {
  const queryClient = useQueryClient()

  const { data: settings = DEFAULTS, isLoading } = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: settingsApi.getSettings,
    staleTime: Infinity,
  })

  const mutation = useMutation({
    mutationFn: settingsApi.patchSettings,
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: SETTINGS_KEY })
      const previous = queryClient.getQueryData<AppSettings>(SETTINGS_KEY)
      queryClient.setQueryData<AppSettings>(SETTINGS_KEY, (old) => ({
        ...(old ?? DEFAULTS),
        ...updates,
      }))
      return { previous }
    },
    onError: (_err, _updates, context) => {
      if (context?.previous) {
        queryClient.setQueryData(SETTINGS_KEY, context.previous)
      }
    },
  })

  return {
    settings,
    isLoading,
    patchSettings: (updates: Partial<AppSettings>) => mutation.mutate(updates),
  }
}
