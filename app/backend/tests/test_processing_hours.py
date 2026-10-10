import json
from datetime import datetime
from types import SimpleNamespace

from src.task_manager import _processing_allowed_now
from src.utils import _in_hour_window


def _settings(windows, **day_flags):
    defaults = {
        "processing_mon": False,
        "processing_tue": False,
        "processing_wed": False,
        "processing_thu": False,
        "processing_fri": False,
        "processing_sat": False,
        "processing_sun": False,
    }
    defaults.update(day_flags)
    return SimpleNamespace(
        processing_hours_start=0,
        processing_hours_end=23,
        processing_hours_windows=json.dumps(windows),
        **defaults,
    )


def test_processing_hour_window_includes_end_hour():
    assert _in_hour_window(23, 0, 23) is True


def test_processing_hours_allow_previous_day_wrapped_window():
    windows = {
        "mon": {"start": 0, "end": 23},
        "tue": {"start": 0, "end": 23},
        "wed": {"start": 0, "end": 23},
        "thu": {"start": 0, "end": 23},
        "fri": {"start": 0, "end": 23},
        "sat": {"start": 0, "end": 23},
        "sun": {"start": 7, "end": 6},
    }
    settings = _settings(windows, processing_sun=True)

    assert _processing_allowed_now(settings, datetime(2026, 8, 10, 5, 30)) is True


def test_processing_hours_do_not_require_current_utc_day_when_previous_day_wraps():
    windows = {
        "mon": {"start": 0, "end": 23},
        "tue": {"start": 0, "end": 23},
        "wed": {"start": 0, "end": 23},
        "thu": {"start": 0, "end": 23},
        "fri": {"start": 0, "end": 23},
        "sat": {"start": 0, "end": 23},
        "sun": {"start": 7, "end": 6},
    }
    settings = _settings(windows, processing_mon=False, processing_sun=True)

    assert _processing_allowed_now(settings, datetime(2026, 8, 10, 5, 30)) is True


def test_processing_hours_use_local_day_and_hour_values_directly():
    windows = {
        "mon": {"start": 0, "end": 23},
        "tue": {"start": 0, "end": 23},
        "wed": {"start": 0, "end": 23},
        "thu": {"start": 0, "end": 23},
        "fri": {"start": 0, "end": 23},
        "sat": {"start": 0, "end": 23},
        "sun": {"start": 0, "end": 23},
    }
    settings = _settings(windows, processing_sun=True)

    assert _processing_allowed_now(settings, datetime(2026, 8, 9, 23, 30)) is True
    assert _processing_allowed_now(settings, datetime(2026, 8, 10, 0, 30)) is False
