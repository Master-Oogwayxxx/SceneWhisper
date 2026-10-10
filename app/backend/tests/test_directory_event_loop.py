import asyncio
from unittest.mock import MagicMock, patch

import pytest

from src.api import directory
from src.models.models import Directory as DirectoryModel


def _record_executor_calls(loop):
    original_run_in_executor = loop.run_in_executor
    calls = []

    def recording_run_in_executor(executor, func, *args):
        calls.append((executor, func, args))
        return original_run_in_executor(executor, func, *args)

    return calls, recording_run_in_executor


@pytest.mark.asyncio
async def test_scan_directory_runs_blocking_scan_in_executor(tmp_path):
    loop = asyncio.get_running_loop()
    calls, recording = _record_executor_calls(loop)
    scan_result = DirectoryModel(
        id="dir-1",
        name=tmp_path.name,
        path=str(tmp_path),
        files=[],
        subdirectories=[],
    )

    directory_crud = MagicMock()
    directory_crud.get_or_create_directory.return_value = MagicMock(id="dir-1")

    with (
        patch.object(loop, "run_in_executor", side_effect=recording),
        patch.object(directory, "emit_notification"),
        patch.object(directory, "get_settings", return_value=MagicMock(ignore_patterns=[])),
        patch.object(directory, "get_directory_contents", return_value=scan_result),
        patch.object(directory, "Directory", return_value=directory_crud),
    ):
        response = await directory.scan_directory(str(tmp_path), MagicMock())

    assert response == [scan_result]
    assert calls
