"""Tests for selective (directory-scoped) SRT cleanup stream."""
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

BASE = str(Path("/videos"))
SHOW_A = str(Path("/videos/showA"))
SHOW_B = str(Path("/videos/showB"))
SHOW_C = str(Path("/videos/showC"))
SHOW_ABC = str(Path("/videos/showABC"))

PATH_A = str(Path("/videos/showA/ep1.srt"))
PATH_B = str(Path("/videos/showB/ep2.srt"))
PATH_C = str(Path("/videos/showC/ep3.srt"))
PATH_ABC = str(Path("/videos/showABC/ep1.srt"))


def _make_subtitle_record(path: str, parent_id=None, file_type="subtitle"):
    r = MagicMock()
    r.path = path
    r.parent_id = parent_id
    r.file_type = file_type
    return r


def _run_filter(subtitle_paths: list[str], directories_param: str | None, video_storage_path: str):
    base = Path(video_storage_path)
    subtitle_files = [_make_subtitle_record(p) for p in subtitle_paths]

    if directories_param:
        dir_names = [d.strip() for d in directories_param.split(",") if d.strip()]
        allowed_prefixes = [str(base / name) for name in dir_names]
        subtitle_files = [
            f for f in subtitle_files
            if any(Path(f.path).is_relative_to(prefix) for prefix in allowed_prefixes)
        ]

    return subtitle_files


def test_no_filter_returns_all_subtitles():
    paths = [PATH_A, PATH_B]
    result = _run_filter(paths, None, BASE)
    assert len(result) == 2


def test_single_dir_filter():
    paths = [PATH_A, PATH_B]
    result = _run_filter(paths, "showA", BASE)
    assert len(result) == 1
    assert result[0].path == PATH_A


def test_multi_dir_filter():
    paths = [PATH_A, PATH_B, PATH_C]
    result = _run_filter(paths, "showA,showB", BASE)
    assert len(result) == 2
    paths_out = {r.path for r in result}
    assert PATH_A in paths_out
    assert PATH_B in paths_out


def test_filter_does_not_match_sibling_prefix():
    paths = [PATH_A, PATH_ABC]
    result = _run_filter(paths, "showA", BASE)
    assert len(result) == 1
    assert result[0].path == PATH_A


def test_empty_directories_param_returns_all():
    paths = [PATH_A, PATH_B]
    result = _run_filter(paths, "", BASE)
    assert len(result) == 2
