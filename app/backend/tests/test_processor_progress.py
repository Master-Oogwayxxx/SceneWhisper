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


class _AsyncBytesStream:
    def __init__(self, lines: list[str]):
        self._lines = [line.encode() for line in lines]

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._lines:
            raise StopAsyncIteration
        return self._lines.pop(0)


def _mock_reencode_proc(
    returncode: int,
    lines: list[str],
    *,
    create_output: bool = False,
    output_path: str | None = None,
    wait_delay: float = 0.0,
):
    proc = MagicMock()
    proc.returncode = returncode

    async def _wait():
        if wait_delay:
            await asyncio.sleep(wait_delay)
        return returncode

    proc.wait = AsyncMock(side_effect=_wait)
    proc.terminate = MagicMock()
    proc.stderr = _AsyncBytesStream(lines)
    if create_output and output_path:
        Path(output_path).write_bytes(b"encoded")
    return proc


def test_get_whisper_model_gpu_only_rejects_existing_cpu_model():
    import src.processor as processor

    previous_model = processor.model
    previous_device = processor._whisper_device
    try:
        processor.model = object()
        processor._whisper_device = "cpu"

        with pytest.raises(RuntimeError, match="GPU-only mode is enabled"):
            processor._get_whisper_model(require_gpu=True)
    finally:
        processor.model = previous_model
        processor._whisper_device = previous_device


def test_remux_to_temp_uses_video_only_stream_copy():
    """Scene-detection remux should avoid copying unsupported non-media streams."""
    from src.processor import _remux_to_temp

    with patch("src.processor.tempfile.mkstemp", return_value=(1, "/tmp/test.mp4")) as mock_mkstemp, \
         patch("src.processor.os.close") as mock_close, \
         patch("src.processor.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock()
        tmp_path = _remux_to_temp("/videos/example.mp4")

    assert tmp_path == "/tmp/test.mp4"
    mock_mkstemp.assert_called_once_with(suffix=".mp4")
    mock_close.assert_called_once_with(1)
    assert mock_run.call_args[0][0] == [
        "ffmpeg",
        "-y",
        "-i",
        "/videos/example.mp4",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "/tmp/test.mp4",
    ]


def test_probe_video_bitrate_falls_back_to_container_bitrate():
    from src.processor import _probe_video_bitrate

    with patch("src.processor.subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(stdout='{"streams":[{}],"format":{"bit_rate":"2400000"}}')

        bitrate = _probe_video_bitrate("/videos/example.mp4")

    assert bitrate == 2_400_000


@pytest.fixture
def fake_video():
    """Mock VideoStream with a known frame count."""
    video = MagicMock()
    video.duration.get_frames.return_value = 100
    return video


@pytest.fixture
def fake_scene_manager():
    """Mock SceneManager whose _frame_num advances when detect_scenes is called."""
    sm = MagicMock()
    sm._frame_num = 0
    sm.get_scene_list.return_value = []

    def _fake_detect_scenes(video, show_progress):
        # Simulate frame advancement
        for frame in range(0, 101, 10):
            sm._frame_num = frame

    sm.detect_scenes.side_effect = _fake_detect_scenes
    return sm


@pytest.mark.asyncio
async def test_detect_scenes_calls_progress_callback(fake_video, fake_scene_manager):
    """progress_callback receives float values and final call is 100.0."""
    received: list[float] = []

    async def callback(pct: float):
        received.append(pct)

    with (
        patch("src.processor.open_video", return_value=fake_video),
        patch("src.processor.SceneManager", return_value=fake_scene_manager),
        patch("src.processor._probe_fps", return_value=30.0),
    ):
        await asyncio.wait_for(
            _import_and_call(callback),
            timeout=5.0,
        )

    assert received, "callback was never called"
    assert received[-1] == 100.0, f"last call should be 100.0, got {received[-1]}"
    assert all(isinstance(v, float) for v in received)
    assert all(0.0 <= v <= 100.0 for v in received), f"out-of-range values: {received}"


@pytest.mark.asyncio
async def test_detect_scenes_progress_is_non_decreasing(fake_video, fake_scene_manager):
    """Progress values must never go backwards."""
    received: list[float] = []

    async def callback(pct: float):
        received.append(pct)

    with (
        patch("src.processor.open_video", return_value=fake_video),
        patch("src.processor.SceneManager", return_value=fake_scene_manager),
        patch("src.processor._probe_fps", return_value=30.0),
    ):
        await asyncio.wait_for(
            _import_and_call(callback),
            timeout=5.0,
        )

    for i in range(1, len(received)):
        assert received[i] >= received[i - 1], (
            f"progress went backwards: {received[i - 1]} -> {received[i]}"
        )


@pytest.mark.asyncio
async def test_detect_scenes_works_without_callback(fake_video, fake_scene_manager):
    """progress_callback=None must not raise."""
    with (
        patch("src.processor.open_video", return_value=fake_video),
        patch("src.processor.SceneManager", return_value=fake_scene_manager),
        patch("src.processor._probe_fps", return_value=30.0),
    ):
        result = await asyncio.wait_for(
            _import_and_call(None),
            timeout=5.0,
        )
    assert result == []


async def _import_and_call(callback):
    from src.processor import detect_scenes  # noqa: PLC0415

    return await detect_scenes(
        video_path="fake_path.mp4",
        progress_callback=callback,
    )


@pytest.mark.asyncio
async def test_split_video_calls_progress_callback():
    """progress_callback receives one call per scene, final value is 100.0."""
    received: list[float] = []

    async def callback(pct: float):
        received.append(pct)

    scene_list = [
        (MagicMock(get_timecode=lambda: "00:00:00.000", get_seconds=lambda: 0.0, get_frames=lambda: 0),
         MagicMock(get_timecode=lambda: "00:00:05.000", get_seconds=lambda: 5.0, get_frames=lambda: 150)),
        (MagicMock(get_timecode=lambda: "00:00:05.000", get_seconds=lambda: 5.0, get_frames=lambda: 150),
         MagicMock(get_timecode=lambda: "00:00:10.000", get_seconds=lambda: 10.0, get_frames=lambda: 300)),
    ]

    with patch("src.processor.asyncio.create_subprocess_exec", return_value=_mock_ffmpeg_proc()) as mock_exec:
        from src.processor import split_video
        await split_video(
            video_path="/fake/video.mp4",
            scene_list=scene_list,
            progress_callback=callback,
        )

    assert received[-1] == 100.0, f"last value should be 100.0, got {received[-1]}"
    assert len(received) == len(scene_list), f"expected {len(scene_list)} callbacks, got {len(received)}"
    assert received == sorted(received), "progress must be non-decreasing"
    assert mock_exec.call_count == len(scene_list)


@pytest.mark.asyncio
async def test_split_video_uses_stream_copy():
    """split_video invokes ffmpeg with stream copy, not NVENC re-encode."""
    scene_list = [
        (MagicMock(get_timecode=lambda: "00:00:00.000", get_seconds=lambda: 0.0),
         MagicMock(get_seconds=lambda: 5.0)),
    ]

    with patch("src.processor.asyncio.create_subprocess_exec", return_value=_mock_ffmpeg_proc()) as mock_exec:
        from src.processor import split_video
        await split_video(video_path="/fake/video.mp4", scene_list=scene_list)

    cmd = mock_exec.call_args[0]
    assert cmd[0:8] == (
        "ffmpeg", "-y",
        "-ss", "00:00:00.000",
        "-i", "/fake/video.mp4",
        "-t", "5.0",
    )
    assert cmd[cmd.index("-c") : cmd.index("-c") + 2] == ("-c", "copy")
    assert Path(cmd[-1]) == Path("/fake/video-001.mp4")
    assert "h264_nvenc" not in cmd


@pytest.mark.asyncio
async def test_split_video_remuxes_non_mp4_to_mp4():
    """Non-mp4 inputs are stream-copied into explicit mp4 split outputs."""
    scene_list = [
        (MagicMock(get_timecode=lambda: "00:00:00.000", get_seconds=lambda: 0.0),
         MagicMock(get_seconds=lambda: 5.0)),
    ]

    with patch("src.processor.asyncio.create_subprocess_exec", return_value=_mock_ffmpeg_proc()) as mock_exec:
        from src.processor import split_video
        await split_video(video_path="/fake/video.mkv", scene_list=scene_list)

    cmd = mock_exec.call_args[0]
    assert cmd[cmd.index("-c") : cmd.index("-c") + 2] == ("-c", "copy")
    assert cmd[cmd.index("-f") : cmd.index("-f") + 2] == ("-f", "mp4")
    assert Path(cmd[-1]) == Path("/fake/video-001.mp4")


@pytest.mark.asyncio
async def test_split_video_overwrite_removes_existing_output_before_ffmpeg(tmp_path):
    """Overwrite mode removes the old segment instead of allowing a renamed copy."""
    source = tmp_path / "video.mp4"
    source.write_bytes(b"source")
    output = tmp_path / "video-001.mp4"
    output.write_bytes(b"old segment")
    scene_list = [
        (MagicMock(get_timecode=lambda: "00:00:00.000", get_seconds=lambda: 0.0),
         MagicMock(get_seconds=lambda: 5.0)),
    ]

    async def fake_create_subprocess_exec(*_cmd, **_kwargs):
        assert not output.exists()
        output.write_bytes(b"new segment")
        return _mock_ffmpeg_proc()

    with patch("src.processor.asyncio.create_subprocess_exec", side_effect=fake_create_subprocess_exec):
        from src.processor import split_video

        await split_video(str(source), scene_list, overwrite_existing=True)

    assert output.read_bytes() == b"new segment"


@pytest.mark.asyncio
async def test_remux_video_uses_stream_copy_without_reencoding(tmp_path):
    """remux_video rewrites the container with stream copy only."""
    source = tmp_path / "video.mp4"
    source.write_bytes(b"source")
    temp_output = tmp_path / "video.remux.tmp.mp4"

    async def fake_create_subprocess_exec(*cmd, **kwargs):
        temp_output.write_bytes(b"remuxed")
        return _mock_reencode_proc(0, ["out_time_ms=1000000\n", "progress=end\n"])

    with (
        patch("src.processor.get_video_duration", return_value="00:00:01"),
        patch("src.processor.asyncio.create_subprocess_exec", side_effect=fake_create_subprocess_exec) as mock_exec,
    ):
        from src.processor import remux_video

        output_path = await remux_video(str(source))

    cmd = mock_exec.call_args[0]
    assert output_path == str(source)
    assert source.read_bytes() == b"remuxed"
    assert cmd[0:4] == ("ffmpeg", "-y", "-i", str(source))
    assert cmd[cmd.index("-map") : cmd.index("-map") + 2] == ("-map", "0")
    assert cmd[cmd.index("-c") : cmd.index("-c") + 2] == ("-c", "copy")
    assert "h264_nvenc" not in cmd
    assert "libx264" not in cmd
    assert "aac" not in cmd


@pytest.mark.asyncio
async def test_split_video_works_without_callback():
    """progress_callback=None must not raise."""
    scene_list = [
        (MagicMock(get_timecode=lambda: "00:00:00.000", get_seconds=lambda: 0.0, get_frames=lambda: 0),
         MagicMock(get_timecode=lambda: "00:00:05.000", get_seconds=lambda: 5.0, get_frames=lambda: 150)),
    ]

    with patch("src.processor.asyncio.create_subprocess_exec", return_value=_mock_ffmpeg_proc()):
        from src.processor import split_video
        await split_video(
            video_path="/fake/video.mp4",
            scene_list=scene_list,
            progress_callback=None,
        )
    # no assertion needed — just must not raise


@pytest.mark.asyncio
async def test_split_video_raises_on_ffmpeg_failure():
    """Non-zero ffmpeg returncode raises Exception."""
    scene_list = [
        (MagicMock(get_timecode=lambda: "00:00:00.000", get_seconds=lambda: 0.0, get_frames=lambda: 0),
         MagicMock(get_timecode=lambda: "00:00:05.000", get_seconds=lambda: 5.0, get_frames=lambda: 150)),
    ]

    with patch("src.processor.asyncio.create_subprocess_exec", return_value=_mock_ffmpeg_proc(returncode=1)):
        from src.processor import split_video
        with pytest.raises(Exception, match="Splitting Video failed"):
            await split_video(
                video_path="/fake/video.mp4",
                scene_list=scene_list,
                progress_callback=None,
            )


@pytest.mark.asyncio
async def test_reencode_video_falls_back_to_libx264_when_nvenc_fails(tmp_path):
    source = tmp_path / "input.mkv"
    source.write_bytes(b"source")

    calls: list[list[str]] = []

    def _fake_create_subprocess_exec(*cmd, **_kwargs):
        calls.append(list(cmd))
        output_path = cmd[-1]
        if "h264_nvenc" in cmd:
            return _mock_reencode_proc(
                1,
                [
                    "[h264_nvenc @ 0x1] 10 bit encode not supported\n",
                    "[h264_nvenc @ 0x1] No capable devices found\n",
                ],
            )

        return _mock_reencode_proc(
            0,
            [
                "out_time_ms=1000000\n",
                "progress=continue\n",
            ],
            create_output=True,
            output_path=output_path,
            wait_delay=0.01,
        )

    with (
        patch("src.processor.get_video_duration", return_value="00:00:10.000"),
        patch("src.processor.asyncio.create_subprocess_exec", side_effect=_fake_create_subprocess_exec),
    ):
        from src.processor import reencode_video

        encoder_used = await reencode_video(str(source))

    assert any("h264_nvenc" in cmd for cmd in calls)
    assert any("libx264" in cmd for cmd in calls)
    assert encoder_used == "libx264"
    assert source.read_bytes() == b"encoded"


@pytest.mark.asyncio
async def test_reencode_video_gpu_only_raises_when_nvenc_fails(tmp_path):
    source = tmp_path / "input.mkv"
    source.write_bytes(b"source")

    calls: list[list[str]] = []

    def _fake_create_subprocess_exec(*cmd, **_kwargs):
        calls.append(list(cmd))
        if "h264_nvenc" in cmd:
            return _mock_reencode_proc(
                1,
                [
                    "[h264_nvenc @ 0x1] No capable devices found\n",
                ],
            )

        return _mock_reencode_proc(
            0,
            ["out_time_ms=1000000\n"],
            create_output=True,
            output_path=cmd[-1],
            wait_delay=0.01,
        )

    with (
        patch("src.processor.get_video_duration", return_value="00:00:10.000"),
        patch("src.processor.asyncio.create_subprocess_exec", side_effect=_fake_create_subprocess_exec),
    ):
        from src.processor import reencode_video

        with pytest.raises(Exception, match="GPU-only mode is enabled"):
            await reencode_video(str(source), require_gpu=True)

    assert any("h264_nvenc" in cmd for cmd in calls)
    assert not any("libx264" in cmd for cmd in calls)


@pytest.mark.asyncio
async def test_reencode_video_uses_vsync_for_frame_pacing(tmp_path):
    source = tmp_path / "input.mkv"
    source.write_bytes(b"source")

    seen_cmds: list[list[str]] = []

    def _fake_create_subprocess_exec(*cmd, **_kwargs):
        seen_cmds.append(list(cmd))
        Path(cmd[-1]).write_bytes(b"encoded")
        return _mock_reencode_proc(0, ["out_time_ms=1000000\n", "progress=end\n"])

    with (
        patch("src.processor.asyncio.create_subprocess_exec", side_effect=_fake_create_subprocess_exec),
        patch("src.processor.asyncio.sleep", side_effect=lambda *_args, **_kwargs: None),
    ):
        from src.processor import normalize_nvenc_frame_pacing

        await normalize_nvenc_frame_pacing(str(source))

    assert seen_cmds, "expected ffmpeg to be invoked"
    assert any("-vsync" in cmd for cmd in seen_cmds)
    assert not any("-r" in cmd for cmd in seen_cmds)
    assert not any("-fps_mode" in cmd for cmd in seen_cmds)


@pytest.mark.asyncio
async def test_nvenc_frame_pacing_targets_source_video_bitrate(tmp_path):
    source = tmp_path / "input.mkv"
    source.write_bytes(b"source")

    seen_cmds: list[list[str]] = []

    def _fake_create_subprocess_exec(*cmd, **_kwargs):
        seen_cmds.append(list(cmd))
        Path(cmd[-1]).write_bytes(b"encoded")
        return _mock_reencode_proc(0, ["progress=end\n"])

    with (
        patch("src.processor._probe_video_bitrate", return_value=1_500_000),
        patch("src.processor.asyncio.create_subprocess_exec", side_effect=_fake_create_subprocess_exec),
        patch("src.processor.asyncio.sleep", side_effect=lambda *_args, **_kwargs: None),
    ):
        from src.processor import normalize_nvenc_frame_pacing

        await normalize_nvenc_frame_pacing(str(source))

    cmd = seen_cmds[0]
    assert cmd[cmd.index("-b:v") + 1] == "1500000"
    assert cmd[cmd.index("-maxrate") + 1] == "1650000"
    assert cmd[cmd.index("-bufsize") + 1] == "3000000"
    assert "-cq" not in cmd


@pytest.mark.asyncio
async def test_nvenc_frame_pacing_uses_cq_fallback_when_source_bitrate_unknown(tmp_path):
    source = tmp_path / "input.mkv"
    source.write_bytes(b"source")

    seen_cmds: list[list[str]] = []

    def _fake_create_subprocess_exec(*cmd, **_kwargs):
        seen_cmds.append(list(cmd))
        Path(cmd[-1]).write_bytes(b"encoded")
        return _mock_reencode_proc(0, ["progress=end\n"])

    with (
        patch("src.processor._probe_video_bitrate", return_value=0),
        patch("src.processor.asyncio.create_subprocess_exec", side_effect=_fake_create_subprocess_exec),
        patch("src.processor.asyncio.sleep", side_effect=lambda *_args, **_kwargs: None),
    ):
        from src.processor import normalize_nvenc_frame_pacing

        await normalize_nvenc_frame_pacing(str(source))

    cmd = seen_cmds[0]
    assert cmd[cmd.index("-cq") + 1] == "28"
    assert "-b:v" not in cmd


@pytest.mark.asyncio
async def test_nvenc_frame_pacing_overwrite_original_replaces_stale_temp(tmp_path):
    source = tmp_path / "input.mp4"
    source.write_bytes(b"source")
    stale_temp = tmp_path / "input.nvenc-overwrite.tmp.mp4"
    stale_temp.write_bytes(b"stale")
    seen_cmds: list[list[str]] = []

    def _fake_create_subprocess_exec(*cmd, **_kwargs):
        seen_cmds.append(list(cmd))
        Path(cmd[-1]).write_bytes(b"encoded")
        return _mock_reencode_proc(0, ["progress=end\n"])

    with (
        patch("src.processor.asyncio.create_subprocess_exec", side_effect=_fake_create_subprocess_exec),
        patch("src.processor.asyncio.sleep", side_effect=lambda *_args, **_kwargs: None),
    ):
        from src.processor import normalize_nvenc_frame_pacing

        output_path = await normalize_nvenc_frame_pacing(str(source), overwrite_original=True)

    assert output_path == str(source)
    assert source.read_bytes() == b"encoded"
    assert not stale_temp.exists()
    assert seen_cmds[0][0:2] == ["ffmpeg", "-y"]
    assert seen_cmds[0][-1] == str(stale_temp)


@pytest.mark.asyncio
async def test_reencode_video_reports_progress_from_out_time_ms(tmp_path):
    source = tmp_path / "input.mkv"
    source.write_bytes(b"source")

    received: list[float] = []

    async def callback(pct: float):
        received.append(pct)

    def _fake_create_subprocess_exec(*_cmd, **_kwargs):
        return _mock_reencode_proc(
            0,
            [
                "out_time_ms=1000000\n",
                "progress=continue\n",
                "out_time_ms=5000000\n",
                "progress=end\n",
            ],
            create_output=True,
            output_path=str(tmp_path / "input.tmp.mp4"),
            wait_delay=0.01,
        )

    with (
        patch("src.processor.get_video_duration", return_value="00:00:10.000"),
        patch("src.processor.asyncio.create_subprocess_exec", side_effect=_fake_create_subprocess_exec),
    ):
        from src.processor import reencode_video

        await reencode_video(str(source), progress_callback=callback)

    assert received, "progress callback was never called"
    assert received[0] == 1.0
    assert any(pct > 1.0 for pct in received)
    assert received[-1] == 100.0
