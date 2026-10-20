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


def test_bulk_rename_translates_before_removing_non_english(monkeypatch):
    def translate(value):
        assert "日本語" in value
        return value.replace("日本語", "Japanese")

    monkeypatch.setattr("src.api.tools._translate_japanese_to_english", translate)
    options = BulkRenameOptions(translate_to_english=True, remove_non_english=True)

    assert _bulk_rename_name("日本語 video.mp4", options) == "Japanese video.mp4"


def test_bulk_rename_translation_keeps_title_when_code_extraction_is_enabled(monkeypatch):
    monkeypatch.setattr("src.api.tools._translate_japanese_to_english", lambda value: value.replace("日本語", "Japanese"))
    options = BulkRenameOptions(translate_to_english=True, extract_video_code=False)

    assert _bulk_rename_name("ABC-123 日本語.mp4", options) == "ABC-123 Japanese.mp4"


@pytest.mark.parametrize(
    ("case_conversion", "expected"),
    [("capitalize", "A title with mixed case.MP4"), ("lower", "a title with mixed case.MP4")],
)
def test_bulk_rename_changes_stem_case_without_touching_extension(case_conversion, expected):
    options = BulkRenameOptions(case_conversion=case_conversion)

    assert _bulk_rename_name("a TITLE with MIXED case.MP4", options) == expected
