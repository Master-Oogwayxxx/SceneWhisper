import fnmatch
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import av
from fastapi import HTTPException

from ..models.models import Task

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv"}


def utc_isoformat(dt: datetime) -> str:
    """Format a UTC datetime as ISO 8601 with Z suffix."""
    return dt.replace(tzinfo=None).isoformat() + "Z"


def _local_timezone():
    return _timezone_from_name(os.environ.get("TZ"))


def _timezone_from_name(tz_name: str | None):
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except ZoneInfoNotFoundError:
            logging.warning("Invalid TZ value %s; falling back to system local timezone", tz_name)
    return datetime.now().astimezone().tzinfo


def calculate_next_run(schedule: Dict[str, any], *, default_timezone: str | None = None) -> datetime:
    """Calculate the next run time based on schedule. Returns timezone-aware UTC datetime."""
    timezone_name = schedule.get("timeZone") or default_timezone
    local_tz = _timezone_from_name(timezone_name) if timezone_name else _local_timezone()
    now = datetime.now(local_tz).replace(second=0, microsecond=0)
    interval = schedule.get("interval")
    time_str = schedule.get("time")
    day_of_week = schedule.get("dayOfWeek")  # JS convention: Sun=0, Mon=1, ..., Sat=6

    if interval == "hourly":
        return (now + timedelta(hours=1)).astimezone(timezone.utc)
    elif interval == "daily":
        if time_str:
            hours, minutes = map(int, time_str.split(":"))
            candidate = now.replace(hour=hours, minute=minutes)
            if candidate <= now:
                candidate += timedelta(days=1)
            return candidate.astimezone(timezone.utc)
    elif interval == "weekly":
        if time_str and day_of_week is not None:
            hours, minutes = map(int, time_str.split(":"))
            # Convert JS dayOfWeek (Sun=0) to Python weekday (Mon=0)
            python_day = (day_of_week - 1) % 7
            candidate = now.replace(hour=hours, minute=minutes)
            days_until = (python_day - now.weekday()) % 7
            if days_until == 0 and candidate <= now:
                days_until = 7
            return (candidate + timedelta(days=days_until)).astimezone(timezone.utc)

    return (now + timedelta(hours=1)).astimezone(timezone.utc)


def get_video_files(directory: str, patterns: list[str] = []) -> list[str]:
    path = Path(directory)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Directory not found")

    video_extensions = VIDEO_EXTENSIONS
    result = []

    for root, _, filenames in os.walk(directory):
        for filename in filenames:
            if Path(filename).suffix.lower() in video_extensions and not is_ignored(filename, patterns):
                result.append(os.path.join(root, filename))

    return result


def is_ignored(filename: str, patterns: list[str]) -> bool:
    """Return True if filename matches any ignore pattern or extension."""
    name_lower = filename.lower()
    suffix = Path(filename).suffix.lower()
    for pattern in patterns:
        p = pattern.strip().lower()
        if not p:
            continue
        if p.startswith("."):
            if suffix == p:
                return True
        else:
            if fnmatch.fnmatch(name_lower, p):
                return True
    return False


def format_timestamp(seconds: float) -> str:
    """Format timestamp for SRT subtitle format"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_hms(seconds: float) -> str:
    seconds = int(seconds)
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    return f"{h:02}:{m:02}:{s:02}"


def _in_hour_window(hour: int, start: int, end: int) -> bool:
    """True if hour falls within the inclusive window, with wrap-around support."""
    if start > end:
        return hour >= start or hour <= end
    return start <= hour <= end


def _seconds_until(target_day: int, target_hour: int) -> float:
    """Seconds from now until target_day (0=Mon) at target_hour:00:00 UTC."""
    now = datetime.utcnow()
    days_ahead = (target_day - now.weekday()) % 7
    target_dt = (now + timedelta(days=days_ahead)).replace(hour=target_hour, minute=0, second=0, microsecond=0)
    if target_dt <= now:
        target_dt += timedelta(days=7)
    return (target_dt - now).total_seconds()


def _elapsed_seconds_since_start(task: Task, end: datetime) -> int | None:
    """Whole seconds from startedAt to end; None if the job never left the queue."""
    if not task.startedAt:
        return None
    started = datetime.fromisoformat(task.startedAt).replace(tzinfo=None)
    return max(0, int((end - started).total_seconds()))


def _stage_elapsed_seconds(task: Task, end: datetime) -> int | None:
    """Whole seconds from stageStartedAt to end; None if stage never started."""
    if not task.stageStartedAt:
        return None
    started = datetime.fromisoformat(task.stageStartedAt).replace(tzinfo=None)
    return max(0, int((end - started).total_seconds()))


def get_video_duration(path: str):
    try:
        with av.open(path) as container:
            if container.duration is None:
                return 0
            duration = container.duration / av.time_base
            return format_hms(duration)
    except Exception:
        return 0


def get_video_metadata(path: str) -> dict:
    """Extract video metadata in a single av.open() call."""
    result = {"duration": "00:00:00", "width": None, "height": None, "fps": None, "codec": None, "bitrate": None}
    try:
        with av.open(path) as container:
            if container.duration is not None:
                result["duration"] = format_hms(container.duration / av.time_base)
            if container.bit_rate:
                result["bitrate"] = container.bit_rate
            video_stream = next((s for s in container.streams if s.type == "video"), None)
            if video_stream:
                result["width"] = video_stream.width
                result["height"] = video_stream.height
                result["codec"] = video_stream.codec_context.name
                if video_stream.average_rate:
                    result["fps"] = float(video_stream.average_rate)
    except Exception:
        pass
    return result


def remove_number_suffix(file_name: str):
    """Removes numeric suffix like -001, -002, ..., -100 from a filename."""
    return re.sub(r"-\d{3}(?=\.|$)", "", file_name)


def serialize_scenes(scene_path: Path):
    from scenedetect import FrameTimecode

    if not os.path.exists(scene_path):
        raise HTTPException(status_code=404, detail="Scene file not found")

    try:
        with open(scene_path, "r") as infile:
            json_object = json.load(infile)

            scenes = []
            for scene_object in json_object:
                scenes.append(
                    (
                        FrameTimecode(
                            timecode=scene_object["start"]["timecode"],
                            fps=scene_object.get("framerate") or 30.0,
                        ),
                        FrameTimecode(
                            timecode=scene_object["end"]["timecode"],
                            fps=scene_object.get("framerate") or 30.0,
                        ),
                    )
                )
    except Exception as e:
        raise e

    return scenes


def get_scenes(path: str):
    video_name = Path(remove_number_suffix(path)).stem

    scene_path = Path(path).parent / "scenes" / f"{video_name}.json"

    if not os.path.exists(scene_path):
        return []

    try:
        scenes = serialize_scenes(scene_path)
    except Exception as e:
        logging.error(e)
        return []

    return scenes


def is_split(path: str) -> bool:
    scenes = get_scenes(path)

    if not scenes:
        return False

    if all(os.path.exists(Path(path).parent / f"{Path(path).stem}-{i:03d}.mp4") for i in range(1, len(scenes) + 1)):
        return True

    return False


def is_split_video(path: str) -> bool:
    video_name = Path(remove_number_suffix(path)).stem

    scenes = get_scenes(path)

    if not scenes:
        return False

    if f"{Path(path).stem}.mp4" in [f"{video_name}-{i:03d}.mp4" for i in range(1, len(scenes) + 1)]:
        return True

    return False


def generate_filename_id(filename: str, filepath: str = None) -> str:
    """Generate a unique ID based on filename and optionally filepath."""
    content = filename
    if filepath:
        content += filepath

    hash_object = hashlib.sha256(content.encode("utf-8"))
    return hash_object.hexdigest()[:16]


def is_subtitled(path: str) -> bool:
    video_name = Path(path).stem

    return os.path.exists(Path(path).parent / "subtitles" / f"{video_name}.srt")


def is_pyscenedetect_split(path: Path) -> bool:
    """Returns True if filename ends with -001 through -100."""
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        return False

    SCENE_SPLIT_SUFFIX_RE = re.compile(r"-(00[1-9]|0[1-9]\d|100)$")

    return bool(SCENE_SPLIT_SUFFIX_RE.search(path.stem))


def find_pyscenedetect_splits(path: Path) -> list[Path]:
    """Find split_video's canonical <stem>-001.mp4 through <stem>-100.mp4 outputs."""
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        return []

    return [
        candidate
        for candidate in path.parent.glob(f"{path.stem}-*.mp4")
        if candidate.suffix.lower() == ".mp4" and is_pyscenedetect_split(candidate)
    ]
