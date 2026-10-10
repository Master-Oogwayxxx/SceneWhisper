"""Tests for selective (directory-scoped) cleanup."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app


def _make_file_record(path: str):
    r = MagicMock()
    r.path = path
    return r


def _make_dir_record(path: str):
    r = MagicMock()
    r.path = path
    return r


def _make_db_and_crud(file_paths: list[str], dir_paths: list[str]):
    """Return (mock_db, mock_directory_crud_instance)."""
    files = [_make_file_record(p) for p in file_paths]
    dirs = [_make_dir_record(p) for p in dir_paths]

    crud = MagicMock()
    crud.get_file_metadata.return_value = files
    crud.get_directory_hierarchy.return_value = dirs

    db = MagicMock()
    return db, crud, files, dirs


def test_no_filter_deletes_all_missing(tmp_path):
    """Without directory_path, all non-existent paths are deleted."""
    existing = tmp_path / "exists.mp4"
    existing.write_text("x")

    file_paths = [str(existing), "/nonexistent/a.mp4"]
    dir_paths = ["/nonexistent/subdir"]

    with patch("src.api.directory.Directory") as MockCrud:
        db, crud, files, dirs = _make_db_and_crud(file_paths, dir_paths)
        MockCrud.return_value = crud

        from src.api.directory import _cleanup_missing_files_blocking
        deleted_files, deleted_dirs = _cleanup_missing_files_blocking(db)

    assert str(existing) not in deleted_files
    assert "/nonexistent/a.mp4" in deleted_files
    assert "/nonexistent/subdir" in deleted_dirs


def test_directory_path_filters_files():
    """With directory_path, only files under that prefix are candidates."""
    target_dir = "/videos/showA"
    other_dir = "/videos/showB"

    file_paths = [
        f"{target_dir}/ep1.mp4",   # missing — should be deleted
        f"{other_dir}/ep2.mp4",    # missing but wrong dir — should be skipped
    ]
    dir_paths = []

    with patch("src.api.directory.Directory") as MockCrud:
        db, crud, _, _ = _make_db_and_crud(file_paths, dir_paths)
        MockCrud.return_value = crud

        from src.api.directory import _cleanup_missing_files_blocking
        deleted_files, deleted_dirs = _cleanup_missing_files_blocking(db, directory_path=target_dir)

    assert f"{target_dir}/ep1.mp4" in deleted_files
    assert f"{other_dir}/ep2.mp4" not in deleted_files


def test_directory_path_filters_dirs():
    """With directory_path, only dirs equal to or under that prefix are candidates."""
    target = "/videos/showA"

    dir_paths = [
        target,                          # exact match — should be checked
        f"{target}/sub",                 # child — should be checked
        "/videos/showB",                 # sibling — should be skipped
    ]

    with patch("src.api.directory.Directory") as MockCrud:
        db, crud, _, _ = _make_db_and_crud([], dir_paths)
        MockCrud.return_value = crud

        from src.api.directory import _cleanup_missing_files_blocking
        _, deleted_dirs = _cleanup_missing_files_blocking(db, directory_path=target)

    assert target in deleted_dirs
    assert f"{target}/sub" in deleted_dirs
    assert "/videos/showB" not in deleted_dirs


def test_directory_path_does_not_match_sibling_prefix():
    """showA filter must not match showABC — boundary must use '/' separator."""
    target = "/videos/showA"

    file_paths = [
        f"{target}/ep1.mp4",        # should match
        "/videos/showABC/ep1.mp4",  # must NOT match
    ]

    with patch("src.api.directory.Directory") as MockCrud:
        db, crud, _, _ = _make_db_and_crud(file_paths, [])
        MockCrud.return_value = crud

        from src.api.directory import _cleanup_missing_files_blocking
        deleted_files, _ = _cleanup_missing_files_blocking(db, directory_path=target)

    assert f"{target}/ep1.mp4" in deleted_files
    assert "/videos/showABC/ep1.mp4" not in deleted_files


def test_trailing_slash_in_directory_path_is_normalized():
    """A trailing slash in directory_path must not break filtering."""
    target = "/videos/showA"

    file_paths = [
        f"{target}/ep1.mp4",   # should match
        "/videos/showABC/ep1.mp4",  # must NOT match
    ]

    with patch("src.api.directory.Directory") as MockCrud:
        db, crud, _, _ = _make_db_and_crud(file_paths, [])
        MockCrud.return_value = crud

        from src.api.directory import _cleanup_missing_files_blocking
        # Pass with trailing slash — must behave same as without
        deleted_files, _ = _cleanup_missing_files_blocking(db, directory_path=target + "/")

    assert f"{target}/ep1.mp4" in deleted_files
    assert "/videos/showABC/ep1.mp4" not in deleted_files


def test_delete_cleanup_endpoint_passes_directory_path():
    """DELETE /directory/cleanup?directory_path=X forwards param to blocking helper."""
    with patch("src.api.directory._cleanup_missing_files_blocking") as mock_fn:
        mock_fn.return_value = ([], [])
        client = TestClient(app)
        resp = client.delete("/api/directory/cleanup?directory_path=/videos/showA")

    assert resp.status_code == 200
    assert mock_fn.call_args.args[1] == "/videos/showA"
