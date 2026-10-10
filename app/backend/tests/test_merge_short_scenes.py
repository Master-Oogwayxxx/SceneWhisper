"""Tests for merge_short_scenes using real scene data from videoprocessor.db."""

import sqlite3
from pathlib import Path
from unittest.mock import MagicMock

import pytest

DB_PATH = Path(__file__).parent.parent / "data" / "videoprocessor.db"
FILE_ID = "9e20a96c2f0fa221"


def _load_db_scenes() -> list[tuple]:
    """Return scenes from DB as (start_seconds, end_seconds) tuples, ordered by start."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT start_seconds, end_seconds FROM scenes WHERE file_id=? ORDER BY start_seconds",
        (FILE_ID,),
    ).fetchall()
    conn.close()
    return rows


def _make_tc(seconds: float) -> MagicMock:
    tc = MagicMock()
    tc.get_seconds.return_value = seconds
    return tc


def _to_scene_list(rows: list[tuple]) -> list[tuple]:
    return [(_make_tc(s), _make_tc(e)) for s, e in rows]


@pytest.fixture
def db_scenes():
    if not DB_PATH.exists():
        pytest.skip(f"DB not found at {DB_PATH}")
    return _load_db_scenes()


@pytest.fixture
def scene_list(db_scenes):
    return _to_scene_list(db_scenes)


def _merged_durations(merged):
    return [round(end.get_seconds() - start.get_seconds(), 4) for start, end in merged]


def test_all_merged_scenes_meet_min_duration(scene_list):
    """Every scene in output must be >= min_duration_seconds, except possibly the last when there's only one scene."""
    from src.processor import merge_short_scenes

    min_dur = 8.0
    merged = merge_short_scenes(scene_list, min_duration_seconds=min_dur)

    assert merged, "merge returned empty list"
    durations = _merged_durations(merged)
    for i, d in enumerate(durations):
        assert d >= min_dur, f"scene {i} duration {d}s < min {min_dur}s"


def test_no_scenes_lost_after_merge(scene_list, db_scenes):
    """Total time span of merged scenes must equal original (contiguous coverage)."""
    from src.processor import merge_short_scenes

    merged = merge_short_scenes(scene_list, min_duration_seconds=8.0)

    original_start = db_scenes[0][0]
    original_end = db_scenes[-1][1]
    merged_start = merged[0][0].get_seconds()
    merged_end = merged[-1][1].get_seconds()

    assert abs(merged_start - original_start) < 0.01, "start shifted"
    assert abs(merged_end - original_end) < 0.01, "end shifted"


def test_short_trailing_scene_merged_backward(scene_list, db_scenes):
    """Short last scene must be absorbed into previous, not left as a short orphan.

    DB last scene is 14.72s — using min_duration_seconds=20 forces it to be 'short'.
    Before the fix, it would pass through unmerged.
    """
    from src.processor import merge_short_scenes

    min_dur = 20.0
    merged = merge_short_scenes(scene_list, min_duration_seconds=min_dur)

    durations = _merged_durations(merged)
    last_dur = durations[-1]
    assert last_dur >= min_dur, (
        f"trailing scene still short: {last_dur}s < {min_dur}s — "
        "backward merge not applied"
    )


def test_merged_scene_count_less_than_original(scene_list, db_scenes):
    """Merging at 30s threshold must reduce scene count — DB has many scenes between 8–30s."""
    from src.processor import merge_short_scenes

    min_dur = 30.0
    merged = merge_short_scenes(scene_list, min_duration_seconds=min_dur)
    assert len(merged) < len(db_scenes), (
        f"no merging at {min_dur}s threshold: {len(merged)} == {len(db_scenes)}"
    )


def test_empty_scene_list_returns_empty():
    from src.processor import merge_short_scenes

    assert merge_short_scenes([]) == []


def test_single_scene_returned_as_is():
    from src.processor import merge_short_scenes

    scene = [(_make_tc(0.0), _make_tc(5.0))]
    result = merge_short_scenes(scene, min_duration_seconds=8.0)
    assert len(result) == 1
    assert result[0][0].get_seconds() == 0.0
    assert result[0][1].get_seconds() == 5.0
