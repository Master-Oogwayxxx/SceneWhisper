from datetime import datetime

from src.api.file import _file_date_range_cutoff


def test_this_month_starts_at_first_day_of_calendar_month():
    cutoff = _file_date_range_cutoff("this_month", datetime(2026, 9, 20, 14, 30, 15))

    assert cutoff == datetime(2026, 9, 1)


def test_this_year_starts_at_first_day_of_calendar_year():
    cutoff = _file_date_range_cutoff("this_year", datetime(2026, 9, 20, 14, 30, 15))

    assert cutoff == datetime(2026, 1, 1)


def test_multiple_date_ranges_use_earliest_cutoff():
    cutoff = _file_date_range_cutoff("this_month,last_7_days,this_year", datetime(2026, 9, 20, 14, 30, 15))

    assert cutoff == datetime(2026, 1, 1)
