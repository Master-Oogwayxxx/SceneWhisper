from sqlalchemy import Boolean, Column, Float, Integer, String, Text

from .db_helper import Base

DEFAULT_EXTERNAL_VIDEO_TARGETS = '[{"label":"Google","url_template":"https://www.google.com/search?q={videoCode}"}]'
DEFAULT_SCRAPER_TEMPLATES = '[{"label":"JavPlayer","url_template":"https://javplayer.org/model/{actress_name}"}]'
DEFAULT_PROCESSING_HOURS_WINDOWS = '{"mon":{"start":2,"end":19},"tue":{"start":2,"end":19},"wed":{"start":2,"end":19},"thu":{"start":2,"end":19},"fri":{"start":2,"end":19},"sat":{"start":2,"end":19},"sun":{"start":2,"end":19}}'


class SettingRecord(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, default=1)

    # App Behavior
    default_task_type = Column(String, nullable=False, default="all")
    default_subtitle_language = Column(String, nullable=False, default="en")
    default_layout = Column(String, nullable=False, default="grid")
    show_stats_panel = Column(Boolean, nullable=False, default=True)
    show_actress_work_covers = Column(Boolean, nullable=False, default=False)
    show_actress_work_titles = Column(Boolean, nullable=False, default=True)
    default_sort_field = Column(String, nullable=False, default="created_at")
    default_sort_direction = Column(String, nullable=False, default="desc")

    # Processing
    scene_detector = Column(String, nullable=False, default="threshold")  # "threshold" or "content"
    scene_content_threshold = Column(Float, nullable=False, default=45)
    scene_adaptive_threshold = Column(Float, nullable=False, default=3.0)
    scene_black_threshold = Column(Float, nullable=False, default=12.0)
    scene_white_threshold = Column(Float, nullable=False, default=240.0)
    min_scene_length_frames = Column(Integer, nullable=False, default=180)
    scene_detection_concurrency = Column(Integer, nullable=False, default=1)
    frame_pacing_analyzer_concurrency = Column(Integer, nullable=False, default=4)
    frame_pacing_analyzer_timeout_minutes = Column(Integer, nullable=False, default=30)
    split_min_video_duration_seconds = Column(Integer, nullable=False, default=0)
    split_concurrency = Column(Integer, nullable=False, default=1)
    split_gpu_required = Column(Boolean, nullable=False, default=False)
    subtitle_concurrency = Column(Integer, nullable=False, default=1)
    subtitle_gpu_required = Column(Boolean, nullable=False, default=False)

    # Monitor Sort
    monitor_sort_field = Column(String, nullable=False, default="directoryName")
    monitor_sort_direction = Column(String, nullable=False, default="asc")

    # Advanced
    task_poll_interval_ms = Column(Integer, nullable=False, default=5000)
    auto_cleanup_on_scan = Column(Boolean, nullable=False, default=False)
    scan_schedule_enabled = Column(Boolean, nullable=False, default=False)
    scan_schedule_time = Column(String, nullable=True)
    scan_schedule_time_zone = Column(String, nullable=True)
    scan_schedule_mode = Column(String, nullable=False, default="all")
    scan_schedule_day_of_week = Column(Integer, nullable=True)
    scan_schedule_last_run = Column(String, nullable=True)
    scan_schedule_next_run = Column(String, nullable=True)
    scan_schedule_last_error = Column(Text, nullable=True)
    task_timeout_minutes = Column(Integer, nullable=False, default=60)
    task_stall_minutes = Column(Integer, nullable=False, default=60)
    scene_timeout_minutes = Column(Integer, nullable=True, default=60)
    split_timeout_minutes = Column(Integer, nullable=True, default=90)
    subtitle_timeout_minutes = Column(Integer, nullable=True, default=60)

    # Processing Hours
    processing_hours_enabled = Column(Boolean, nullable=False, default=False)
    processing_hours_start = Column(Integer, nullable=False, default=2)
    processing_hours_end = Column(Integer, nullable=False, default=19)
    processing_hours_windows = Column(Text, nullable=False, default=DEFAULT_PROCESSING_HOURS_WINDOWS)

    # Processing Days (True = allowed)
    processing_mon = Column(Boolean, nullable=False, default=True)
    processing_tue = Column(Boolean, nullable=False, default=True)
    processing_wed = Column(Boolean, nullable=False, default=True)
    processing_thu = Column(Boolean, nullable=False, default=True)
    processing_fri = Column(Boolean, nullable=False, default=True)
    processing_sat = Column(Boolean, nullable=False, default=True)
    processing_sun = Column(Boolean, nullable=False, default=True)

    # File filtering
    ignore_patterns = Column(Text, nullable=True)

    # Directory Selection
    selected_scan_directories = Column(Text, nullable=True)  # JSON list of dir names, null = scan all

    # Queue Priority
    task_type_priority = Column(String, nullable=True, default='["all","merge","subtitle","split","scene","analyze_frame_pacing","nvenc_frame_pacing","remux"]')

    # Saved file browser filter presets (JSON array)
    saved_file_filters = Column(Text, nullable=True)
    external_video_targets = Column(Text, nullable=False, default=DEFAULT_EXTERNAL_VIDEO_TARGETS)
    scraper_templates = Column(Text, nullable=False, default=DEFAULT_SCRAPER_TEMPLATES)
    actress_favorites = Column(Text, nullable=True)
    r18_auto_refresh_enabled = Column(Boolean, nullable=False, default=False)
    r18_auto_refresh_time = Column(String, nullable=True)
    r18_auto_refresh_day_of_week = Column(Integer, nullable=True)
    r18_auto_refresh_last_run = Column(String, nullable=True)
    r18_auto_refresh_next_run = Column(String, nullable=True)
    r18_auto_refresh_last_error = Column(Text, nullable=True)

    # qBittorrent
    qbittorrent_url = Column(String, nullable=False, default="")
    qbittorrent_username = Column(String, nullable=False, default="")
    qbittorrent_password = Column(String, nullable=False, default="")

    # Bulk Download Queue
    queue_base_delay_seconds = Column(Integer, nullable=False, default=60)
    queue_jitter_seconds = Column(Integer, nullable=False, default=30)
    queue_window_start_hour = Column(Integer, nullable=False, default=0)
    queue_window_end_hour = Column(Integer, nullable=False, default=0)
    queue_download_time_limit_minutes = Column(Integer, nullable=False, default=0)
