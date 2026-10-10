import asyncio
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from src.api import r18
from src.api.r18 import DownloadRequest, EnqueueItem, EnqueueRequest


def _record_executor_calls(loop):
    original_run_in_executor = loop.run_in_executor
    calls = []

    def recording_run_in_executor(executor, func, *args):
        calls.append((executor, func, args))
        return original_run_in_executor(executor, func, *args)

    return calls, recording_run_in_executor


@pytest.mark.asyncio
async def test_enqueue_download_queue_runs_db_work_in_executor():
    loop = asyncio.get_running_loop()
    calls, recording = _record_executor_calls(loop)
    db = MagicMock()

    with (
        patch.object(loop, "run_in_executor", side_effect=recording),
        patch.object(r18._dbh, "SessionLocal", return_value=db),
        patch.object(r18, "enqueue_works", return_value=1) as mock_enqueue,
    ):
        response = await r18.enqueue_download_queue(
            EnqueueRequest(items=[EnqueueItem(content_id="abc001", video_code="ABC-001")], save_path="D:/Media/Downloads")
        )

    assert response == {"queued": 1, "skipped": 0}
    assert calls
    assert mock_enqueue.call_args.args[2] == "D:/Media/Downloads"


@pytest.mark.asyncio
async def test_get_download_queue_runs_db_work_in_executor():
    loop = asyncio.get_running_loop()
    calls, recording = _record_executor_calls(loop)
    now = datetime.now(timezone.utc)
    row = MagicMock(
        id=1,
        content_id="abc001",
        video_code="ABC-001",
        status="pending",
        error=None,
        torrent_url=None,
        save_path=None,
        added_at=now,
        processed_at=None,
        position=1,
    )

    with (
        patch.object(loop, "run_in_executor", side_effect=recording),
        patch.object(r18._dbh, "SessionLocal", return_value=MagicMock()),
        patch.object(r18, "get_all_queue", return_value=[row]),
    ):
        response = await r18.get_download_queue()

    assert response[0].video_code == "ABC-001"
    assert calls


@pytest.mark.asyncio
async def test_clear_download_queue_done_runs_db_work_in_executor():
    loop = asyncio.get_running_loop()
    calls, recording = _record_executor_calls(loop)

    with (
        patch.object(loop, "run_in_executor", side_effect=recording),
        patch.object(r18._dbh, "SessionLocal", return_value=MagicMock()),
        patch.object(r18, "clear_done_queue", return_value=3),
    ):
        response = await r18.clear_download_queue_done(include_failed=True)

    assert response == {"removed": 3}
    assert calls


@pytest.mark.asyncio
async def test_retry_download_queue_item_runs_db_work_in_executor():
    loop = asyncio.get_running_loop()
    calls, recording = _record_executor_calls(loop)

    with (
        patch.object(loop, "run_in_executor", side_effect=recording),
        patch.object(r18._dbh, "SessionLocal", return_value=MagicMock()),
        patch.object(r18, "retry_queue_item", return_value=True),
    ):
        response = await r18.retry_download_queue_item(7)

    assert response == {"ok": True}
    assert calls


@pytest.mark.asyncio
async def test_send_to_qbittorrent_runs_tracking_writes_in_executor():
    loop = asyncio.get_running_loop()
    calls, recording = _record_executor_calls(loop)

    body = DownloadRequest(
        torrent_url="https://example.com/ABC-001.torrent",
        video_code="ABC-001",
        content_id="abc001",
        tags=["Sample"],
    )

    with (
        patch.object(loop, "run_in_executor", side_effect=recording),
        patch.object(r18._dbh, "SessionLocal", return_value=MagicMock()),
        patch.object(r18, "_send_to_qbit"),
        patch.object(r18, "insert_tracking"),
        patch.object(r18, "mark_processing_by_content_id"),
    ):
        response = await r18.send_to_qbittorrent(body)

    assert response == {"ok": True}
    assert len(calls) >= 2
