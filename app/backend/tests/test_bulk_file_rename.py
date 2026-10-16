import pytest

from src.api.tools import BulkRenameOptions, _bulk_rename_name


@pytest.mark.parametrize(
    ("date", "expected"),
    [
        ("2025.08.29", "Example.mp4"),
        ("29.08.2025", "Example.mp4"),
    ],
)
def test_bulk_rename_removes_year_first_and_day_first_dates(date, expected):
    options = BulkRenameOptions(remove_dates=True)

    assert _bulk_rename_name(f"Example {date}.mp4", options) == expected


@pytest.mark.parametrize("resolution", ["1080p", "1080P"])
def test_bulk_rename_removes_resolution_before_extracting_video_code(resolution):
    options = BulkRenameOptions(remove_resolution=True)

    assert _bulk_rename_name(f"Neither is {resolution}.mp4", options) == "Neither is.mp4"


def test_bulk_rename_removes_dates_and_resolution_next_to_underscores():
    options = BulkRenameOptions(remove_dates=True, remove_resolution=True)
    name = "29.08.2025_WEBDL_YURIEVIJ__011225 001_AN IMMORAL TWO DAYS FOR A SCHOOL TRIP_1080P.mp4"

    assert _bulk_rename_name(name, options) == "WEBDL-YURIEVIJ-001-AN IMMORAL TWO DAYS FOR A SCHOOL TRIP.mp4"
