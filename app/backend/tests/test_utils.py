"""Tests for calculate_next_run in utils.py."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

from src.utils import calculate_next_run, find_pyscenedetect_splits, is_ignored


def _now_utc():
    return datetime.now(timezone.utc).replace(second=0, microsecond=0)


class TestCalculateNextRunHourly:
    def test_returns_timezone_aware(self):
        result = calculate_next_run({"interval": "hourly"})
        assert result.tzinfo is not None, "Result must be timezone-aware"

    def test_approximately_one_hour_from_now(self):
        result = calculate_next_run({"interval": "hourly"})
        now = _now_utc()
        diff = result - now
        assert timedelta(minutes=59) <= diff <= timedelta(minutes=61)


class TestCalculateNextRunDaily:
    def test_future_time_today(self):
        """If schedule time is in the future today, result should be today."""
        now = datetime.now().astimezone()
        if now.hour >= 22:
            pytest.skip("Late local time makes a two-hour future target cross midnight")
        # Pick a time 2 hours from now
        future = now + timedelta(hours=2)
        time_str = future.strftime("%H:%M")

        result = calculate_next_run({"interval": "daily", "time": time_str})

        assert result.tzinfo is not None
        assert result.astimezone(now.tzinfo).date() == now.date(), "Should fire today when time is in the future"

    def test_past_time_tomorrow(self):
        """If schedule time has passed today, result should be tomorrow."""
        now = datetime.now().astimezone()
        if now.hour < 2:
            pytest.skip("Early local time makes a two-hour past target belong to yesterday")
        # Pick a time 2 hours in the past
        past = now - timedelta(hours=2)
        time_str = past.strftime("%H:%M")

        result = calculate_next_run({"interval": "daily", "time": time_str})

        assert result.tzinfo is not None
        tomorrow = (now + timedelta(days=1)).date()
        assert result.astimezone(now.tzinfo).date() == tomorrow, "Should fire tomorrow when time has passed"

    def test_midnight_is_local_midnight(self):
        """A daily 00:00 schedule should resolve to midnight in the configured local timezone."""
        local_tz = datetime.now().astimezone().tzinfo

        result = calculate_next_run({"interval": "daily", "time": "00:00"})
        local_result = result.astimezone(local_tz)

        assert result.tzinfo is not None
        assert local_result.hour == 0
        assert local_result.minute == 0

    def test_uses_schedule_timezone_when_present(self, monkeypatch):
        """A browser timezone on the schedule should override the container timezone."""
        schedule_tz = ZoneInfo("America/Los_Angeles")
        monkeypatch.setenv("TZ", "UTC")

        result = calculate_next_run({"interval": "daily", "time": "09:00", "timeZone": "America/Los_Angeles"})
        local_result = result.astimezone(schedule_tz)

        assert result.tzinfo is not None
        assert local_result.hour == 9
        assert local_result.minute == 0

    def test_uses_default_timezone_when_schedule_timezone_missing(self, monkeypatch):
        """Legacy directory monitor times without timeZone can still be interpreted as UTC."""
        monkeypatch.setenv("TZ", "America/Los_Angeles")

        result = calculate_next_run(
            {"interval": "daily", "time": "08:00"},
            default_timezone="UTC",
        )
        utc_result = result.astimezone(timezone.utc)

        assert result.tzinfo is not None
        assert utc_result.hour == 8
        assert utc_result.minute == 0


class TestCalculateNextRunWeekly:
    def test_result_falls_on_monday(self):
        """JS dayOfWeek=1 means Monday; result must land on a Monday."""
        result = calculate_next_run({"interval": "weekly", "time": "09:00", "dayOfWeek": 1})

        assert result.tzinfo is not None
        # Python weekday: 0=Monday
        assert result.weekday() == 0, f"Expected Monday (0), got {result.weekday()}"

    def test_result_falls_on_sunday(self):
        """JS dayOfWeek=0 means Sunday; result must land on a Sunday."""
        result = calculate_next_run({"interval": "weekly", "time": "09:00", "dayOfWeek": 0})

        assert result.tzinfo is not None
        # Python weekday: 6=Sunday
        assert result.weekday() == 6, f"Expected Sunday (6), got {result.weekday()}"

    def test_result_falls_on_saturday(self):
        """JS dayOfWeek=6 means Saturday; result must land on a Saturday."""
        result = calculate_next_run({"interval": "weekly", "time": "09:00", "dayOfWeek": 6})

        assert result.tzinfo is not None
        # Python weekday: 5=Saturday
        assert result.weekday() == 5, f"Expected Saturday (5), got {result.weekday()}"

    def test_result_is_in_the_future(self):
        """Weekly result must always be in the future."""
        result = calculate_next_run({"interval": "weekly", "time": "09:00", "dayOfWeek": 1})
        now = _now_utc()
        assert result > now


class TestIsIgnored:
    def test_empty_patterns_never_ignores(self):
        assert is_ignored("movie.mp4", []) is False

    def test_extension_match(self):
        assert is_ignored("movie.avi", [".avi"]) is True

    def test_extension_no_match(self):
        assert is_ignored("movie.mp4", [".avi"]) is False

    def test_glob_match(self):
        assert is_ignored("movie-sample.mp4", ["*sample*"]) is True

    def test_glob_no_match(self):
        assert is_ignored("movie.mp4", ["*sample*"]) is False

    def test_glob_case_insensitive(self):
        assert is_ignored("Movie-SAMPLE.mp4", ["*sample*"]) is True

    def test_extension_case_insensitive(self):
        assert is_ignored("movie.AVI", [".avi"]) is True

    def test_blank_pattern_skipped(self):
        assert is_ignored("movie.mp4", ["", "  "]) is False

    def test_multiple_patterns_first_match(self):
        assert is_ignored("trailer.mp4", ["*trailer*", "*sample*"]) is True

    def test_multiple_patterns_second_match(self):
        assert is_ignored("sample.mp4", ["*trailer*", "*sample*"]) is True

    def test_extension_with_whitespace_stripped(self):
        assert is_ignored("movie.avi", ["  .avi  "]) is True


def test_find_pyscenedetect_splits_uses_mp4_outputs_for_non_mp4_source(tmp_path):
    source = tmp_path / "movie.mkv"
    split = tmp_path / "movie-001.mp4"
    same_extension_split = tmp_path / "movie-001.mkv"
    source.touch()
    split.touch()
    same_extension_split.touch()

    assert find_pyscenedetect_splits(source) == [split]


class TestStageElapsedSeconds:
    def test_returns_none_when_no_stage_start(self):
        from src.utils import _stage_elapsed_seconds
        from src.models.models import File, Task, TaskStatus, TaskType
        from datetime import datetime
        f = File(id="f1", name="v.mp4", path="/v.mp4", size=1, duration="00:01:00", format=".mp4")
        task = Task(id="t1", file=f, type=TaskType.ALL, status=TaskStatus.PROCESSING, createdAt="2026-01-01T00:00:00")
        assert _stage_elapsed_seconds(task, datetime.utcnow()) is None

    def test_returns_correct_whole_seconds(self):
        from src.utils import _stage_elapsed_seconds
        from src.models.models import File, Task, TaskStatus, TaskType
        from datetime import datetime
        f = File(id="f1", name="v.mp4", path="/v.mp4", size=1, duration="00:01:00", format=".mp4")
        task = Task(
            id="t1", file=f, type=TaskType.ALL, status=TaskStatus.PROCESSING,
            createdAt="2026-01-01T00:00:00",
            stageStartedAt="2026-01-01T00:00:00",
        )
        end = datetime(2026, 1, 1, 0, 1, 45)  # 105 seconds after midnight
        assert _stage_elapsed_seconds(task, end) == 105

    def test_clamps_to_zero_on_negative_delta(self):
        from src.utils import _stage_elapsed_seconds
        from src.models.models import File, Task, TaskStatus, TaskType
        from datetime import datetime, timedelta
        f = File(id="f1", name="v.mp4", path="/v.mp4", size=1, duration="00:01:00", format=".mp4")
        future = (datetime.utcnow() + timedelta(seconds=10)).isoformat()
        task = Task(
            id="t1", file=f, type=TaskType.ALL, status=TaskStatus.PROCESSING,
            createdAt="2026-01-01T00:00:00",
            stageStartedAt=future,
        )
        assert _stage_elapsed_seconds(task, datetime.utcnow()) == 0
