import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _mock_ffmpeg_proc(returncode: int = 0):
    """Return a mock asyncio subprocess whose wait() completes with returncode."""
    proc = MagicMock()
    proc.returncode = returncode
    proc.wait = AsyncMock(return_value=returncode)
    proc.terminate = MagicMock()
    return proc


@pytest.mark.asyncio
async def test_split_video_tracks_created_files_on_success():
    """split_video appends each successfully created file to created_files."""
    created: list[Path] = []

    scene_list = [
        (MagicMock(get_timecode=lambda: "00:00:00.000", get_seconds=lambda: 0.0),
         MagicMock(get_timecode=lambda: "00:01:00.000", get_seconds=lambda: 60.0)),
        (MagicMock(get_timecode=lambda: "00:01:00.000", get_seconds=lambda: 60.0),
         MagicMock(get_timecode=lambda: "00:02:00.000", get_seconds=lambda: 120.0)),
    ]

    with patch("src.processor.asyncio.create_subprocess_exec", return_value=_mock_ffmpeg_proc()):
        from src.processor import split_video
        await split_video(
            video_path="/fake/video.mp4",
            scene_list=scene_list,
            created_files=created,
        )

    assert len(created) == 2
    assert created[0] == Path("/fake/video-001.mp4")
    assert created[1] == Path("/fake/video-002.mp4")


@pytest.mark.asyncio
async def test_split_video_tracks_files_even_on_failure():
    """split_video tracks successfully created files before a later scene fails."""
    created: list[Path] = []

    scene_list = [
        (MagicMock(get_timecode=lambda: "00:00:00.000", get_seconds=lambda: 0.0),
         MagicMock(get_timecode=lambda: "00:01:00.000", get_seconds=lambda: 60.0)),
        (MagicMock(get_timecode=lambda: "00:01:00.000", get_seconds=lambda: 60.0),
         MagicMock(get_timecode=lambda: "00:02:00.000", get_seconds=lambda: 120.0)),
    ]

    with patch(
        "src.processor.asyncio.create_subprocess_exec",
        side_effect=[_mock_ffmpeg_proc(0), _mock_ffmpeg_proc(1)],
    ):
        from src.processor import split_video
        with pytest.raises(Exception, match="Splitting Video failed"):
            await split_video(
                video_path="/fake/video.mp4",
                scene_list=scene_list,
                created_files=created,
            )

    assert len(created) == 1
    assert created[0] == Path("/fake/video-001.mp4")


def test_save_subtitles_tracks_created_file(tmp_path):
    """save_subtitles appends the .srt path to created_files after writing."""
    created: list[Path] = []
    video_path = str(tmp_path / "clip-001.mp4")

    from src.processor import save_subtitles
    save_subtitles(video_path=video_path, subtitles="1\n00:00:00,000 --> 00:00:01,000\nHello\n", created_files=created)

    assert len(created) == 1
    assert created[0] == tmp_path / "clip-001.srt"
    assert created[0].exists()


def test_save_subtitles_no_created_files_arg(tmp_path):
    """save_subtitles works normally when created_files is omitted."""
    video_path = str(tmp_path / "clip-001.mp4")

    from src.processor import save_subtitles
    save_subtitles(video_path=video_path, subtitles="content")
    assert (tmp_path / "clip-001.srt").exists()


def test_cleanup_created_files_deletes_existing(tmp_path):
    """_cleanup_created_files deletes files that exist."""
    f1 = tmp_path / "video-001.mp4"
    f2 = tmp_path / "video-002.mp4"
    f1.write_text("fake")
    f2.write_text("fake")

    from src.task_manager import TaskManager
    tm = TaskManager.__new__(TaskManager)
    tm._cleanup_created_files("task-1", [f1, f2])

    assert not f1.exists()
    assert not f2.exists()


def test_cleanup_created_files_tolerates_missing(tmp_path):
    """_cleanup_created_files does not raise if a file is already gone."""
    from src.task_manager import TaskManager
    tm = TaskManager.__new__(TaskManager)
    missing = tmp_path / "ghost.mp4"

    tm._cleanup_created_files("task-1", [missing])
