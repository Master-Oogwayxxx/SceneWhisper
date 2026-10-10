"""Test that get_video_files works correctly with the new os.walk implementation."""
import os
import tempfile
from pathlib import Path

from src.utils import get_video_files


def test_get_video_files():
    """Verify get_video_files finds all video files recursively."""
    with tempfile.TemporaryDirectory() as tmpdir:
        # Create directory structure with videos and other files
        Path(tmpdir, "subdir1").mkdir()
        Path(tmpdir, "subdir1", "subdir2").mkdir()

        # Create test files
        Path(tmpdir, "video1.mp4").touch()
        Path(tmpdir, "video2.avi").touch()
        Path(tmpdir, "document.txt").touch()
        Path(tmpdir, "subdir1", "video3.mkv").touch()
        Path(tmpdir, "subdir1", "image.jpg").touch()
        Path(tmpdir, "subdir1", "subdir2", "video4.mov").touch()

        # Find all videos
        videos = get_video_files(tmpdir)

        # Verify results
        assert len(videos) == 4, f"Expected 4 videos, got {len(videos)}: {videos}"

        # Check that all expected videos are found
        video_names = [os.path.basename(v) for v in videos]
        assert "video1.mp4" in video_names
        assert "video2.avi" in video_names
        assert "video3.mkv" in video_names
        assert "video4.mov" in video_names

        # Check that non-videos are excluded
        assert "document.txt" not in video_names
        assert "image.jpg" not in video_names

        print(f"OK: Found {len(videos)} videos")
        for v in sorted(videos):
            print(f"  - {v}")


def test_get_video_files_with_patterns():
    """Verify get_video_files respects ignore patterns."""
    with tempfile.TemporaryDirectory() as tmpdir:
        Path(tmpdir, "important.mp4").touch()
        Path(tmpdir, "temp.mp4").touch()
        Path(tmpdir, "ignore_stuff.mp4").touch()

        # Find videos, ignoring temp and ignore-* pattern
        videos = get_video_files(tmpdir, ["temp*", "ignore*"])

        assert len(videos) == 1, f"Expected 1 video after filtering, got {len(videos)}: {videos}"
        assert "important.mp4" in videos[0]

        print("OK: Ignore patterns work correctly")


if __name__ == "__main__":
    test_get_video_files()
    test_get_video_files_with_patterns()
