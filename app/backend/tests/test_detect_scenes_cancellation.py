import asyncio
import threading
import pytest
from unittest.mock import MagicMock, patch
from src.processor import detect_scenes


@pytest.mark.asyncio
async def test_detect_scenes_with_cancel_event():
    """detect_scenes accepts cancel_event parameter without error."""
    cancel_event = threading.Event()

    with patch("src.processor.open_video") as mock_open, \
         patch("src.processor._build_scene_manager") as mock_build_sm, \
         patch("src.processor._probe_fps", return_value=30.0):

        # Mock the video and scene manager
        mock_video = MagicMock()
        mock_video.duration.get_frames.return_value = 300
        mock_video.position.get_frames.return_value = 0
        mock_open.return_value = mock_video

        mock_sm = MagicMock()
        mock_sm.get_scene_list.return_value = [
            (MagicMock(get_seconds=lambda: 0.0), MagicMock(get_seconds=lambda: 60.0)),
            (MagicMock(get_seconds=lambda: 60.0), MagicMock(get_seconds=lambda: 120.0)),
        ]
        mock_build_sm.return_value = mock_sm

        # Mock detect_scenes to return immediately (not actually detect)
        mock_sm.detect_scenes.return_value = None

        # Call with cancel_event (should not raise)
        result = await detect_scenes(
            "test.mp4",
            cancel_event=cancel_event
        )

        # Should return a list of scenes
        assert result is not None


@pytest.mark.asyncio
async def test_detect_scenes_cancellation_raises_error():
    """detect_scenes raises CancelledError when cancel_event is set."""
    cancel_event = threading.Event()

    with patch("src.processor.open_video") as mock_open, \
         patch("src.processor._build_scene_manager") as mock_build_sm, \
         patch("src.processor._probe_fps", return_value=30.0):

        # Mock the video and scene manager
        mock_video = MagicMock()
        mock_video.duration.get_frames.return_value = 300
        mock_video.position.get_frames.return_value = 0
        mock_open.return_value = mock_video

        mock_sm = MagicMock()
        mock_sm.get_scene_list.return_value = []
        mock_build_sm.return_value = mock_sm

        # Set up detection to take a bit longer so we can set the cancel event
        async def slow_detect(*args, **kwargs):
            await asyncio.sleep(0.5)

        # Make detect_scenes set cancel event during polling
        async def mock_detect_scenes(*args, **kwargs):
            # Simulate detection taking 1 second
            await asyncio.sleep(1.0)

        # Use run_in_executor replacement that lets us control timing
        called = []
        def fake_detect(*args, **kwargs):
            called.append(True)
            return None

        mock_sm.detect_scenes.side_effect = fake_detect

        # Now set the cancel event immediately (simulating quick cancellation)
        cancel_event.set()

        # Call with cancel_event - should raise CancelledError
        with pytest.raises(asyncio.CancelledError):
            await detect_scenes(
                "test.mp4",
                cancel_event=cancel_event
            )
