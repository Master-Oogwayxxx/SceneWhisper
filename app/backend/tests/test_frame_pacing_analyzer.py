import json
import subprocess
import time
from types import SimpleNamespace

import pytest

import src.api.tools as tools
from src.api.tools import (
    RepeatedFrameDetection,
    _classify_frame_deltas,
    _detect_repeated_visual_frames,
    _frame_pacing_repeat_timeout_result,
    _rate_to_float,
    _repeated_frame_scan_windows,
    _stream_frame_timestamp_events,
)


def test_rate_to_float_parses_fractional_rate():
    assert _rate_to_float("30000/1001") == pytest.approx(29.97003)
    assert _rate_to_float("0/0") is None


def test_frame_pacing_classifier_marks_consistent_cadence_healthy():
    status, score, recommended_fps, irregular, gaps, percent = _classify_frame_deltas([1 / 30] * 300)

    assert status == "healthy"
    assert score == 0
    assert recommended_fps == pytest.approx(30)
    assert (irregular, gaps, percent) == (0, 0, 0)


def test_frame_pacing_classifier_marks_repeated_large_gaps_severe():
    deltas = [1 / 30] * 270 + [3 / 30] * 30

    status, score, _, irregular, gaps, percent = _classify_frame_deltas(deltas)

    assert status == "severe"
    assert score >= 50
    assert irregular == 30
    assert gaps == 30
    assert percent == pytest.approx(10)


def test_frame_pacing_classifier_counts_moderate_cadence_jitter():
    base_delta = 1 / 30
    deltas = [base_delta] * 270 + [base_delta * 1.2] * 30

    status, score, _, irregular, gaps, percent = _classify_frame_deltas(deltas)

    assert status == "severe"
    assert score >= 50
    assert irregular == 30
    assert gaps == 0
    assert percent == pytest.approx(10)


def test_frame_pacing_classifier_counts_duplicate_or_backward_timestamps_as_irregular():
    deltas = [1 / 30] * 270 + [0, -1 / 30] * 15

    status, score, _, irregular, gaps, percent = _classify_frame_deltas(deltas)

    assert status == "severe"
    assert score >= 50
    assert irregular == 30
    assert gaps == 0
    assert percent == pytest.approx(10)


def test_frame_pacing_classifier_includes_repeated_visual_frames():
    deltas = [1 / 30] * 300

    status, score, _, irregular, gaps, percent = _classify_frame_deltas(deltas, repeated_frames=30)

    assert status == "severe"
    assert score >= 50
    assert irregular == 30
    assert gaps == 0
    assert percent == pytest.approx(10)


def test_frame_pacing_classifier_marks_many_repeated_frames_suspect_even_when_percent_is_low():
    deltas = [1 / 30] * 30000

    status, score, _, irregular, gaps, percent = _classify_frame_deltas(deltas, repeated_frames=245)

    assert status == "suspect"
    assert score == 49
    assert irregular == 245
    assert gaps == 0
    assert percent == pytest.approx(245 / 30000 * 100)


def test_detect_repeated_visual_frames_counts_mpdecimate_drops(monkeypatch, tmp_path):
    class FakeResult:
        returncode = 0
        stderr = """
        [Parsed_mpdecimate_0 @ 000001] lo:0<1 lo:0<1 hi:0<1 drop pts:120 pts_time:4
        [Parsed_mpdecimate_0 @ 000001] lo:0<1 lo:0<1 hi:0<1 drop pts:180 pts_time:6
        """

    monkeypatch.setattr(subprocess, "run", lambda *args, **kwargs: FakeResult())

    result = _detect_repeated_visual_frames(tmp_path / "video.mp4", 60)

    assert result.count == 2
    assert result.timed_out is False


def test_repeated_frame_scan_windows_sample_long_videos():
    windows = _repeated_frame_scan_windows(3600)

    assert len(windows) == 20
    assert windows[0] == (0, 60)
    assert windows[-1] == (3540, 60)
    assert sum(window_duration or 0 for _, window_duration in windows) >= 3600 / 3


def test_detect_repeated_visual_frames_scans_samples_for_long_videos(monkeypatch, tmp_path):
    commands = []

    class FakeResult:
        returncode = 0
        stderr = "[Parsed_mpdecimate_0 @ 000001] drop pts:120 pts_time:4"

    def fake_run(command, **kwargs):
        commands.append((command, kwargs))
        return FakeResult()

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = _detect_repeated_visual_frames(tmp_path / "video.mp4", 1800, duration=3600)

    assert result.count == 20
    assert result.timed_out is False
    assert len(commands) == 20
    assert all("-ss" in command for command, _ in commands)
    assert all("-t" in command for command, _ in commands)
    assert all(kwargs["timeout"] == 15 for _, kwargs in commands)


def test_detect_repeated_visual_frames_marks_timeout(monkeypatch, tmp_path):
    seen_timeout = {}

    def raise_timeout(*args, **kwargs):
        seen_timeout["value"] = kwargs.get("timeout")
        raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=kwargs.get("timeout"))

    monkeypatch.setattr(subprocess, "run", raise_timeout)

    result = _detect_repeated_visual_frames(tmp_path / "video.mp4", 60)

    assert result.count == 0
    assert result.timed_out is True
    assert seen_timeout["value"] == 60


def test_repeated_frame_timeout_is_severe():
    result = _frame_pacing_repeat_timeout_result("file-1", [0, 1 / 30, 2 / 30], 30)

    assert result.status == "severe"
    assert result.score == 100
    assert result.repeated_frames == 0
    assert result.irregular_frames == 2
    assert result.large_gaps == 0
    assert result.message == "Repeated-frame detection timed out"


def test_save_frame_pacing_file_progress_preserves_created_at(monkeypatch):
    record = SimpleNamespace(progress_json="{}", status="running")

    class FakeQuery:
        @staticmethod
        def filter(*args, **kwargs):
            return FakeQuery()

        @staticmethod
        def first():
            return record

    class FakeDb:
        @staticmethod
        def query(*args, **kwargs):
            return FakeQuery()

        @staticmethod
        def commit():
            return None

    monkeypatch.setattr(tools, "get_db", lambda: FakeDb())
    monkeypatch.setattr(tools, "close_db", lambda db: None)

    tools._save_frame_pacing_file_progress("run-1", {"file_id": "file-1", "progress": 10, "frames_analyzed": 100})
    first_saved = json.loads(record.progress_json)["file-1"]

    tools._save_frame_pacing_file_progress("run-1", {"file_id": "file-1", "progress": 20, "frames_analyzed": 200})
    second_saved = json.loads(record.progress_json)["file-1"]

    assert first_saved["created_at"].endswith("Z")
    assert second_saved["created_at"] == first_saved["created_at"]
    assert second_saved["progress"] == 20
    assert second_saved["frames_analyzed"] == 200


def test_stream_frame_timestamp_events_returns_severe_result_on_timeout(monkeypatch, tmp_path):
    class SlowStdout:
        def __iter__(self):
            return self

        def __next__(self):
            time.sleep(10)
            raise StopIteration

    class FakeProcess:
        stdout = SlowStdout()
        killed = False

        class FakeStderr:
            @staticmethod
            def read():
                return ""

        stderr = FakeStderr()

        def wait(self, timeout=None):
            return -9 if self.killed else 0

        def poll(self):
            return -9 if self.killed else None

        def kill(self):
            self.killed = True

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProcess())

    events = [
        json.loads(chunk.decode("utf-8"))
        for chunk in _stream_frame_timestamp_events("file-1", tmp_path / "video.mp4", 1, 30, timeout_seconds=0)
    ]

    assert events[-1]["event"] == "result"
    assert events[-1]["status"] == "severe"
    assert events[-1]["score"] == 100
    assert events[-1]["message"] == "Frame pacing analysis timed out after 0 minutes"


def test_stream_frame_timestamp_events_returns_severe_result_when_timestamps_stall(monkeypatch, tmp_path):
    class StalledStdout:
        def __init__(self):
            self._sent_first = False

        def __iter__(self):
            return self

        def __next__(self):
            if not self._sent_first:
                self._sent_first = True
                return "12.000000\n"
            time.sleep(10)
            raise StopIteration

    class FakeProcess:
        stdout = StalledStdout()
        killed = False

        class FakeStderr:
            @staticmethod
            def read():
                return ""

        stderr = FakeStderr()

        def wait(self, timeout=None):
            return -9 if self.killed else 0

        def poll(self):
            return -9 if self.killed else None

        def kill(self):
            self.killed = True

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProcess())
    monkeypatch.setattr(tools, "FRAME_PACING_TIMESTAMP_IDLE_TIMEOUT_SECONDS", 0)

    events = [
        json.loads(chunk.decode("utf-8"))
        for chunk in _stream_frame_timestamp_events("file-1", tmp_path / "video.mp4", 48, 30, timeout_seconds=60)
    ]

    assert events[-1]["event"] == "result"
    assert events[-1]["status"] == "severe"
    assert events[-1]["score"] == 100
    assert events[-1]["frames_analyzed"] == 1
    assert events[-1]["message"] == "Frame timestamp scan stalled after 0 minutes"


def test_stream_frame_timestamp_events_returns_severe_result_when_timestamp_scan_never_starts(monkeypatch, tmp_path):
    class BlockingStdout:
        def __iter__(self):
            return self

        def __next__(self):
            time.sleep(10)
            raise StopIteration

    class FakeProcess:
        stdout = BlockingStdout()
        killed = False

        class FakeStderr:
            @staticmethod
            def read():
                return ""

        stderr = FakeStderr()

        def wait(self, timeout=None):
            return -9 if self.killed else 0

        def poll(self):
            return -9 if self.killed else None

        def kill(self):
            self.killed = True

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProcess())
    monkeypatch.setattr(tools, "FRAME_PACING_TIMESTAMP_IDLE_TIMEOUT_SECONDS", 0)

    events = [
        json.loads(chunk.decode("utf-8"))
        for chunk in _stream_frame_timestamp_events("file-1", tmp_path / "video.mp4", 48, 30, timeout_seconds=60)
    ]

    assert events[-1]["event"] == "result"
    assert events[-1]["status"] == "severe"
    assert events[-1]["score"] == 100
    assert events[-1]["frames_analyzed"] == 0
    assert events[-1]["message"] == "Frame timestamp scan did not start after 0 minutes"


def test_stream_frame_timestamp_events_returns_error_result_when_ffprobe_fails(monkeypatch, tmp_path):
    class FakeProcess:
        stdout = iter(["0.000000\n"])

        class FakeStderr:
            @staticmethod
            def read():
                return "Invalid data found when processing input\n"

        stderr = FakeStderr()

        @staticmethod
        def wait(timeout=None):
            return 1

        @staticmethod
        def poll():
            return 1

        @staticmethod
        def kill():
            raise AssertionError("finished process should not be killed")

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProcess())

    events = [
        json.loads(chunk.decode("utf-8"))
        for chunk in _stream_frame_timestamp_events("file-1", tmp_path / "video.mp4", 1, 30)
    ]

    assert events[-1]["event"] == "result"
    assert events[-1]["status"] == "error"
    assert events[-1]["message"] == "Invalid data found when processing input"


def test_stream_frame_timestamp_events_finishes_after_99_when_ffprobe_stalls(monkeypatch, tmp_path):
    class BlockingStdout:
        def __init__(self):
            self.sent = False

        def __iter__(self):
            return self

        def __next__(self):
            if not self.sent:
                self.sent = True
                return "0.990000\n"
            time.sleep(10)
            raise StopIteration

    class FakeProcess:
        stdout = BlockingStdout()
        killed = False

        class FakeStderr:
            @staticmethod
            def read():
                return ""

        stderr = FakeStderr()

        def wait(self, timeout=None):
            return -9 if self.killed else 0

        def poll(self):
            return -9 if self.killed else None

        def kill(self):
            self.killed = True

    monkeypatch.setattr(subprocess, "Popen", lambda *args, **kwargs: FakeProcess())
    monkeypatch.setattr(tools, "FRAME_PACING_TIMESTAMP_FINALIZE_TIMEOUT_SECONDS", 0)
    monkeypatch.setattr(tools, "_detect_repeated_visual_frames", lambda *args, **kwargs: RepeatedFrameDetection(0))

    events = [
        json.loads(chunk.decode("utf-8"))
        for chunk in _stream_frame_timestamp_events("file-1", tmp_path / "video.mp4", 1, 30)
    ]

    assert any(event.get("progress") == 99 for event in events)
    assert events[-1]["event"] == "result"
    assert events[-1]["status"] == "unknown"
