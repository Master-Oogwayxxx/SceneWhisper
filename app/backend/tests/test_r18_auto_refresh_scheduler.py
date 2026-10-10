from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest


def _settings(**overrides):
    base = {
        "r18_auto_refresh_enabled": False,
        "r18_auto_refresh_time": None,
        "r18_auto_refresh_day_of_week": None,
        "r18_auto_refresh_last_run": None,
        "r18_auto_refresh_next_run": None,
        "r18_auto_refresh_last_error": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_scheduler_ignores_disabled_auto_refresh():
    from src.workers.r18_auto_refresh_scheduler import run_due_r18_auto_refresh

    with patch("src.workers.r18_auto_refresh_scheduler.get_settings", return_value=_settings()), \
         patch("src.workers.r18_auto_refresh_scheduler.schedule_import_from_url") as mock_schedule, \
         patch("src.workers.r18_auto_refresh_scheduler.patch_settings") as mock_patch:
        ran = await run_due_r18_auto_refresh()

    assert ran is False
    mock_schedule.assert_not_called()
    mock_patch.assert_not_called()


@pytest.mark.asyncio
async def test_scheduler_ignores_future_next_run():
    from src.workers.r18_auto_refresh_scheduler import run_due_r18_auto_refresh

    settings = _settings(
        r18_auto_refresh_enabled=True,
        r18_auto_refresh_time="09:00",
        r18_auto_refresh_day_of_week=1,
        r18_auto_refresh_next_run="2099-01-01T00:00:00Z",
    )

    with patch("src.workers.r18_auto_refresh_scheduler.get_settings", return_value=settings), \
         patch("src.workers.r18_auto_refresh_scheduler.schedule_import_from_url") as mock_schedule, \
         patch("src.workers.r18_auto_refresh_scheduler.patch_settings") as mock_patch:
        ran = await run_due_r18_auto_refresh()

    assert ran is False
    mock_schedule.assert_not_called()
    mock_patch.assert_not_called()


@pytest.mark.asyncio
async def test_scheduler_triggers_due_import_and_advances_next_run():
    from src.workers.r18_auto_refresh_scheduler import run_due_r18_auto_refresh

    settings = _settings(
        r18_auto_refresh_enabled=True,
        r18_auto_refresh_time="09:00",
        r18_auto_refresh_day_of_week=1,
        r18_auto_refresh_next_run="2026-07-01T00:00:00Z",
        r18_auto_refresh_last_error="old error",
    )
    next_run = datetime(2026, 7, 14, 9, 0, tzinfo=timezone.utc)

    with patch("src.workers.r18_auto_refresh_scheduler.get_settings", return_value=settings), \
         patch("src.workers.r18_auto_refresh_scheduler.schedule_import_from_url", return_value={"state": "running"}) as mock_schedule, \
         patch("src.workers.r18_auto_refresh_scheduler.calculate_next_run", return_value=next_run), \
         patch("src.workers.r18_auto_refresh_scheduler.patch_settings") as mock_patch:
        ran = await run_due_r18_auto_refresh()

    assert ran is True
    mock_schedule.assert_called_once()
    mock_patch.assert_called_once_with({
        "r18_auto_refresh_last_run": mock_patch.call_args.args[0]["r18_auto_refresh_last_run"],
        "r18_auto_refresh_next_run": "2026-07-14T09:00:00Z",
        "r18_auto_refresh_last_error": None,
    })


@pytest.mark.asyncio
async def test_scheduler_records_error_and_advances_on_busy_import():
    from src.workers.r18_auto_refresh_scheduler import run_due_r18_auto_refresh

    settings = _settings(
        r18_auto_refresh_enabled=True,
        r18_auto_refresh_time="09:00",
        r18_auto_refresh_day_of_week=1,
        r18_auto_refresh_next_run="2026-07-01T00:00:00Z",
    )
    next_run = datetime(2026, 7, 14, 9, 0, tzinfo=timezone.utc)

    with patch("src.workers.r18_auto_refresh_scheduler.get_settings", return_value=settings), \
         patch("src.workers.r18_auto_refresh_scheduler.schedule_import_from_url", side_effect=RuntimeError("An import is already in progress")), \
         patch("src.workers.r18_auto_refresh_scheduler.calculate_next_run", return_value=next_run), \
         patch("src.workers.r18_auto_refresh_scheduler.patch_settings") as mock_patch:
        ran = await run_due_r18_auto_refresh()

    assert ran is False
    mock_patch.assert_called_once_with({
        "r18_auto_refresh_next_run": "2026-07-14T09:00:00Z",
        "r18_auto_refresh_last_error": "An import is already in progress",
    })


@pytest.mark.asyncio
async def test_scheduler_ignores_incomplete_schedule():
    from src.workers.r18_auto_refresh_scheduler import run_due_r18_auto_refresh

    settings = _settings(
        r18_auto_refresh_enabled=True,
        r18_auto_refresh_time=None,
        r18_auto_refresh_day_of_week=1,
        r18_auto_refresh_next_run="2026-07-01T00:00:00Z",
    )

    with patch("src.workers.r18_auto_refresh_scheduler.get_settings", return_value=settings), \
         patch("src.workers.r18_auto_refresh_scheduler.schedule_import_from_url") as mock_schedule, \
         patch("src.workers.r18_auto_refresh_scheduler.patch_settings") as mock_patch:
        ran = await run_due_r18_auto_refresh()

    assert ran is False
    mock_schedule.assert_not_called()
    mock_patch.assert_not_called()
