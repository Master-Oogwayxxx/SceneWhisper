import asyncio
import threading
import pytest
from unittest.mock import MagicMock, patch, AsyncMock
from src.processor import split_video


@pytest.mark.asyncio
async def test_split_video_cancel_between_scenes():
    """cancel_event set before loop starts → raises CancelledError without launching ffmpeg"""
    cancel_event = threading.Event()
    cancel_event.set()

    scene_list = [(MagicMock(), MagicMock()), (MagicMock(), MagicMock())]
    for start, end in scene_list:
        start.get_timecode.return_value = "00:00:00.000"
        start.get_seconds.return_value = 0.0
        end.get_seconds.return_value = 5.0

    with patch("src.processor.asyncio.create_subprocess_exec") as mock_exec:
        with pytest.raises(asyncio.CancelledError):
            await split_video(
                "/fake/video.mp4",
                scene_list,
                cancel_event=cancel_event,
            )
    mock_exec.assert_not_called()


@pytest.mark.asyncio
async def test_split_video_cancel_mid_encode():
    """cancel_event set while proc.wait() is pending → proc.terminate() called, raises CancelledError"""
    cancel_event = threading.Event()

    scene_list = [(MagicMock(), MagicMock())]
    scene_list[0][0].get_timecode.return_value = "00:00:00.000"
    scene_list[0][0].get_seconds.return_value = 0.0
    scene_list[0][1].get_seconds.return_value = 5.0

    mock_proc = AsyncMock()
    mock_proc.returncode = 0

    async def fake_wait():
        # Simulate encode taking time; set cancel mid-wait
        # Sleep long enough for poll task to detect (poll runs every 0.25s)
        await asyncio.sleep(0.5)
        cancel_event.set()
        await asyncio.sleep(0.5)
        return 0

    mock_proc.wait = fake_wait

    with patch("src.processor.asyncio.create_subprocess_exec", return_value=mock_proc):
        with pytest.raises(asyncio.CancelledError):
            await split_video(
                "/fake/video.mp4",
                scene_list,
                cancel_event=cancel_event,
            )

    mock_proc.terminate.assert_called_once()
