import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from typing import Awaitable, Callable

from scenedetect import SceneList, SceneManager, open_video
from scenedetect.detectors import AdaptiveDetector, ContentDetector, ThresholdDetector

from .utils import get_video_duration

logger = logging.getLogger(__name__)

os.environ["HF_HOME"] = str(Path.home() / ".cache" / "huggingface")

model = None
_whisper_device: str | None = None

# Isolated executor for Whisper: stuck CTranslate2/CUDA threads can't exhaust
# the default asyncio executor and freeze DB writes or FastAPI handlers.
_WHISPER_EXECUTOR = ThreadPoolExecutor(max_workers=2)

# Isolated executor for PySceneDetect: CPU-bound frame analysis can occupy a
# thread for 5–30+ minutes. Keeping it off the default executor prevents it
# from starving the frequent DB write calls (update_task, get_settings, etc.)
# that also use run_in_executor(None, ...).
_SCENE_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="scene_detect")


def _get_whisper_model(require_gpu: bool = False):
    """Lazy-load Whisper model on first use."""
    from faster_whisper import WhisperModel

    global model, _whisper_device

    if require_gpu and model is not None and _whisper_device != "cuda":
        raise RuntimeError("Whisper GPU-only mode is enabled, but CUDA is unavailable for subtitle generation.")

    if model is None:
        cache_dir = os.environ.get("HF_HOME", str(Path.home() / ".cache" / "huggingface"))
        try:
            model = WhisperModel(
                "large-v3",
                device="cuda",
                compute_type="int8_float16",
                download_root=cache_dir,
            )
            _whisper_device = "cuda"
            logger.info("Whisper large-v3 loaded on CUDA")
        except Exception as e:
            if require_gpu:
                logger.error("Whisper CUDA load failed while GPU-only mode is enabled: %s", e)
                raise RuntimeError("Whisper GPU-only mode is enabled, but CUDA is unavailable for subtitle generation.") from e
            logger.warning("Whisper CUDA load failed (%s), falling back to CPU", e)
            model = WhisperModel(
                "large-v3",
                device="cpu",
                compute_type="int8",
                download_root=cache_dir,
            )
            _whisper_device = "cpu"
            logger.info("Whisper loaded on CPU")

    return model


def merge_short_scenes(
    scenes: SceneList,
    min_duration_seconds: float = 180,
):
    if not scenes:
        return []

    merged = [scenes[0]]

    for start, end in scenes[1:]:
        prev_start, prev_end = merged[-1]

        prev_duration = prev_end.get_seconds() - prev_start.get_seconds()

        current_duration = end.get_seconds() - start.get_seconds()

        # If previous OR current scene too short,
        # merge into previous block
        if prev_duration < min_duration_seconds or current_duration < min_duration_seconds:
            merged[-1] = (prev_start, end)
        else:
            merged.append((start, end))

    return merged


def _build_scene_manager(
    detector: str,
    content_threshold: float,
    adaptive_threshold: float,
    black_threshold: float,
    white_threshold: float,
    min_scene_len: int,
) -> "SceneManager":
    """Create and configure a SceneManager with the requested detector."""
    sm = SceneManager()
    if detector == "adaptive":
        sm.add_detector(AdaptiveDetector(adaptive_threshold=adaptive_threshold, min_scene_len=min_scene_len * 30))
    elif detector == "threshold":
        sm.add_detector(ThresholdDetector(threshold=black_threshold, method=ThresholdDetector.Method.FLOOR))
        sm.add_detector(ThresholdDetector(threshold=white_threshold, method=ThresholdDetector.Method.CEILING))
    else:
        sm.add_detector(ContentDetector(threshold=content_threshold, min_scene_len=min_scene_len * 30))
    return sm


def _probe_fps(video_path: str) -> float:
    """Return the framerate reported by ffprobe, or 0.0 on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=r_frame_rate",
                "-of",
                "json",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        data = json.loads(result.stdout)
        r_frame_rate = data["streams"][0]["r_frame_rate"]  # e.g. "30000/1001"
        num, den = r_frame_rate.split("/")
        fps = float(num) / float(den)
        return fps if fps > 0 else 0.0
    except Exception:
        return 0.0


def _probe_video_bitrate(video_path: str) -> int:
    """Return a source bitrate in bits/sec, or 0 if unknown."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=bit_rate:format=bit_rate",
                "-of",
                "json",
                video_path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        data = json.loads(result.stdout)
        stream_bitrate = int(data["streams"][0].get("bit_rate") or 0)
        format_bitrate = int(data.get("format", {}).get("bit_rate") or 0)
        bitrate = stream_bitrate or format_bitrate
        return bitrate if bitrate > 0 else 0
    except Exception:
        return 0


def _remux_to_temp(video_path: str) -> str:
    """Re-mux video into a temp file with ffmpeg -c copy; returns temp path."""
    suffix = Path(video_path).suffix or ".mp4"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                video_path,
                "-map",
                "0:v:0",
                "-map",
                "0:a?",
                "-c",
                "copy",
                tmp_path,
            ],
            capture_output=True,
            timeout=300,
            check=True,
        )
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode(errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        if stderr:
            logger.warning("ffmpeg remux failed for %s: %s", video_path, stderr.strip())
        raise
    return tmp_path


async def detect_scenes(
    video_path: str,
    detector: str = "content",
    content_threshold: float = 45.0,
    adaptive_threshold: float = 3.0,
    black_threshold: float = 12.0,
    white_threshold: float = 240.0,
    min_scene_len: int = 180,
    progress_callback: Callable[[float], Awaitable[None]] | None = None,
    cancel_event: threading.Event | None = None,
) -> list[tuple]:
    """Detect scenes using PySceneDetect, reporting frame progress via callback.

    Polls SceneManager._frame_num from an async task while detection runs in a
    thread pool so the event loop stays unblocked.
    """
    try:
        loop = asyncio.get_running_loop()
        scene_manager = _build_scene_manager(
            detector=detector,
            content_threshold=content_threshold,
            adaptive_threshold=adaptive_threshold,
            black_threshold=black_threshold,
            white_threshold=white_threshold,
            min_scene_len=min_scene_len,
        )

        # open_video reads the file header — blocking I/O that can stall for
        # seconds on network mounts if called directly on the event loop thread.
        # Probe fps first; if OpenCV would get 0 (corrupted header, VFR, etc.)
        # re-mux into a temp file before handing off to PySceneDetect.
        def _open_video():
            target = video_path
            tmp_path = None
            fps = _probe_fps(target)
            if fps <= 0:
                logger.warning("fps=0 for %s — re-muxing to fix container headers", target)
                tmp_path = _remux_to_temp(target)
                fps2 = _probe_fps(tmp_path)
                if fps2 <= 0:
                    os.unlink(tmp_path)
                    raise RuntimeError(f"Cannot determine framerate for {video_path}")
                target = tmp_path
            try:
                v = open_video(target)
                return v, v.duration.get_frames(), tmp_path
            except Exception:
                if tmp_path:
                    os.unlink(tmp_path)
                raise

        video, total_frames, _tmp_path = await loop.run_in_executor(_SCENE_EXECUTOR, _open_video)

        # Use the dedicated scene executor so CPU-bound frame analysis doesn't
        # starve the default executor (which handles all DB writes / get_settings).
        detect_future = loop.run_in_executor(
            _SCENE_EXECUTOR,
            lambda: scene_manager.detect_scenes(video, show_progress=False),
        )

        async def _poll():
            while not detect_future.done():
                await asyncio.sleep(0.25)

                if cancel_event and cancel_event.is_set():
                    scene_manager.stop()
                    break

                if progress_callback and total_frames:
                    current = video.position.get_frames()
                    pct = min(current / total_frames * 100, 99.0)
                    await progress_callback(pct)

        poll_task = asyncio.create_task(_poll())

        try:
            await detect_future
        finally:
            poll_task.cancel()
            if _tmp_path:
                try:
                    os.unlink(_tmp_path)
                except OSError:
                    pass

        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError()

        if progress_callback:
            await progress_callback(100.0)

        scenes = scene_manager.get_scene_list()

        merged = merge_short_scenes(scenes)

        return merged

    except asyncio.CancelledError:
        raise
    except Exception as e:
        raise Exception(f"Scene detection failed: {str(e)}")


class SplitVideoFfmpegError(Exception):
    """Raised when ffmpeg stream-copy split exits with a non-zero status."""


def split_output_paths(video_path: str | Path, scene_count: int) -> list[Path]:
    """Return expected split segment paths for a source video and scene count.

    Args:
        video_path: Source video path used as the split prefix.
        scene_count: Number of scenes to split.

    Returns:
        Paths for ``{stem}-{NNN}.mp4`` outputs in the source directory.
    """
    source = Path(video_path)
    return [source.parent / f"{source.stem}-{i:03}.mp4" for i in range(1, scene_count + 1)]


async def split_video(
    video_path: str,
    scene_list: list[tuple],
    progress_callback: Callable[[float], Awaitable[None]] | None = None,
    cancel_event: threading.Event | None = None,
    created_files: list[Path] | None = None,
    max_concurrent: int = 3,
    overwrite_existing: bool = False,
):
    """Split each scene from video_path into a numbered mp4 using ffmpeg stream copy.

    Runs up to max_concurrent ffmpeg processes in parallel using asyncio.gather
    and a Semaphore. When overwrite_existing is enabled, each canonical output
    is removed before FFmpeg starts. Calls progress_callback(pct) after each
    scene completes; progress jumps in steps as scenes finish out of order.
    """
    output_dir = Path(video_path).parent
    video_name = Path(video_path).stem
    total = len(scene_list)
    sem = asyncio.Semaphore(max_concurrent)
    completed = [0]  # mutable counter; safe in asyncio (single-threaded, cooperates at await points)

    async def _split_one(i: int, start_tc, end_tc):
        async with sem:
            if cancel_event and cancel_event.is_set():
                raise asyncio.CancelledError()

            scene_number = i + 1
            output_path = output_dir / f"{video_name}-{scene_number:03}.mp4"
            if overwrite_existing:
                output_path.unlink(missing_ok=True)
            start_ts = start_tc.get_timecode()
            duration = end_tc.get_seconds() - start_tc.get_seconds()

            cmd = [
                "ffmpeg",
                "-y",
                "-ss",
                start_ts,
                "-i",
                video_path,
                "-t",
                str(duration),
                "-c",
                "copy",
                "-f",
                "mp4",
                str(output_path),
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )

            async def _poll_cancel():
                while not proc_done.done():
                    await asyncio.sleep(0.25)
                    if cancel_event and cancel_event.is_set():
                        try:
                            proc.terminate()
                        except ProcessLookupError:
                            pass
                        break

            proc_done = asyncio.ensure_future(proc.wait())
            poll_task = asyncio.create_task(_poll_cancel())
            try:
                await proc_done
            except asyncio.CancelledError:
                # Sibling scene failed and gather cancelled this coroutine — terminate ffmpeg
                # and clean up any partial output before re-raising.
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
                output_path.unlink(missing_ok=True)
                raise
            finally:
                poll_task.cancel()
                await asyncio.gather(poll_task, return_exceptions=True)

            if cancel_event and cancel_event.is_set():
                raise asyncio.CancelledError()

            if proc.returncode != 0:
                raise SplitVideoFfmpegError(f"Splitting Video failed: ffmpeg exited {proc.returncode} on scene {scene_number}")

            if created_files is not None:
                created_files.append(output_path)

            completed[0] += 1
            if progress_callback:
                await progress_callback(round(completed[0] / total * 100, 2))

    await asyncio.gather(
        *[_split_one(i, s, e) for i, (s, e) in enumerate(scene_list)],
        return_exceptions=False,
    )


async def reencode_video(
    video_path: str,
    progress_callback: Callable[[float], Awaitable[None]] | None = None,
    cancel_event: threading.Event | None = None,
    require_gpu: bool = False,
) -> str:
    """Re-encode video to H.264 and audio to AAC, replacing the source in place.

    Calls progress_callback with pct from 0 to 100. Returns the encoder that
    succeeded. Does not track the source path in created_files because the
    output replaces the original file.
    """
    output_dir = Path(video_path).parent
    video_name = Path(video_path).stem
    temp_output = output_dir / f"{video_name}.tmp.mp4"

    loop = asyncio.get_running_loop()

    def _get_duration_seconds() -> float:
        hms = get_video_duration(video_path)
        if not hms or hms == 0:
            return 0.0
        try:
            parts = str(hms).split(":")
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        except Exception:
            return 0.0

    total_duration = await loop.run_in_executor(None, _get_duration_seconds)

    _time_pattern = re.compile(r"time=(\d+):(\d+):(\d+\.\d+)")
    _progress_time_ms_pattern = re.compile(r"out_time_ms=(\d+)")
    _progress_time_pattern = re.compile(r"out_time=(\d+):(\d+):(\d+\.\d+)")

    async def _emit_progress(raw_value: float) -> None:
        if progress_callback and total_duration:
            pct = min(raw_value / total_duration * 100, 99.0)
            await progress_callback(round(pct, 2))

    async def _run_reencode(cmd: list[str]) -> tuple[int, str]:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )

        stderr_lines: list[str] = []

        async def _read_progress():
            async for raw in proc.stderr:
                line = raw.decode(errors="replace")
                stderr_lines.append(line)
                if not progress_callback or not total_duration:
                    continue

                m_ms = _progress_time_ms_pattern.search(line)
                if m_ms:
                    await _emit_progress(float(m_ms.group(1)) / 1000.0)
                    continue

                m_progress = _progress_time_pattern.search(line)
                if m_progress:
                    elapsed = float(m_progress.group(1)) * 3600 + float(m_progress.group(2)) * 60 + float(m_progress.group(3))
                    await _emit_progress(elapsed)
                    continue

                m = _time_pattern.search(line)
                if m:
                    elapsed = float(m.group(1)) * 3600 + float(m.group(2)) * 60 + float(m.group(3))
                    await _emit_progress(elapsed)

        async def _poll_cancel():
            while not proc_done.done():
                await asyncio.sleep(0.25)
                if cancel_event and cancel_event.is_set():
                    try:
                        proc.terminate()
                    except ProcessLookupError:
                        pass
                    break

        proc_done = asyncio.ensure_future(proc.wait())
        poll_task = asyncio.create_task(_poll_cancel())
        progress_task = asyncio.create_task(_read_progress())
        try:
            if progress_callback and total_duration:
                await progress_callback(1.0)
            await proc_done
        finally:
            poll_task.cancel()
            progress_task.cancel()
            await asyncio.gather(poll_task, progress_task, return_exceptions=True)

        return proc.returncode, "".join(stderr_lines).strip()

    nvenc_cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p5",
        "-cq",
        "23",
        "-c:a",
        "aac",
        str(temp_output),
    ]

    encoder_used = "h264_nvenc"
    returncode, error_msg = await _run_reencode(nvenc_cmd)

    if cancel_event and cancel_event.is_set():
        raise asyncio.CancelledError()

    if returncode != 0:
        if require_gpu:
            temp_output.unlink(missing_ok=True)
            raise Exception(f"Re-encoding failed: h264_nvenc unavailable and GPU-only mode is enabled.\n{error_msg}")
        fallback_cmd = [
            "ffmpeg",
            "-y",
            "-i",
            video_path,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(temp_output),
        ]
        temp_output.unlink(missing_ok=True)
        encoder_used = "libx264"
        returncode, error_msg = await _run_reencode(fallback_cmd)

        if cancel_event and cancel_event.is_set():
            raise asyncio.CancelledError()

        if returncode != 0:
            temp_output.unlink(missing_ok=True)
            raise Exception(f"Re-encoding failed: ffmpeg exited {returncode}\n{error_msg}")

    original_path = Path(video_path)
    # rename can copy across filesystems for large files — offload to avoid blocking event loop
    await loop.run_in_executor(None, lambda: (original_path.unlink(missing_ok=True), temp_output.rename(original_path)))

    if progress_callback:
        await progress_callback(100.0)

    return encoder_used


async def remux_video(
    video_path: str,
    progress_callback: Callable[[float], Awaitable[None]] | None = None,
    cancel_event: threading.Event | None = None,
) -> str:
    """Remux a video in place with stream copy only; no audio/video re-encoding."""
    input_path = Path(video_path)
    temp_output = input_path.parent / f"{input_path.stem}.remux.tmp{input_path.suffix}"
    loop = asyncio.get_running_loop()

    def _get_duration_seconds() -> float:
        hms = get_video_duration(video_path)
        if not hms or hms == 0:
            return 0.0
        try:
            parts = str(hms).split(":")
            return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
        except Exception:
            return 0.0

    total_duration = await loop.run_in_executor(None, _get_duration_seconds)
    progress_time_ms_pattern = re.compile(r"out_time_ms=(\d+)")
    progress_time_pattern = re.compile(r"out_time=(\d+):(\d+):(\d+\.\d+)")

    async def _emit_progress(raw_value: float) -> None:
        if progress_callback and total_duration:
            pct = min(raw_value / total_duration * 100, 99.0)
            await progress_callback(round(pct, 2))

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-progress",
        "pipe:2",
        "-map",
        "0",
        "-c",
        "copy",
        str(temp_output),
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    stderr_lines: list[str] = []

    async def _read_stderr() -> None:
        async for raw in proc.stderr:
            line = raw.decode(errors="replace")
            stderr_lines.append(line)
            if not progress_callback or not total_duration:
                continue

            m_ms = progress_time_ms_pattern.search(line)
            if m_ms:
                await _emit_progress(float(m_ms.group(1)) / 1000.0)
                continue

            m_progress = progress_time_pattern.search(line)
            if m_progress:
                elapsed = float(m_progress.group(1)) * 3600 + float(m_progress.group(2)) * 60 + float(m_progress.group(3))
                await _emit_progress(elapsed)

    async def _poll_cancel() -> None:
        while not proc_done.done():
            await asyncio.sleep(0.25)
            if cancel_event and cancel_event.is_set():
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
                break

    proc_done = asyncio.ensure_future(proc.wait())
    poll_task = asyncio.create_task(_poll_cancel())
    stderr_task = asyncio.create_task(_read_stderr())
    try:
        if progress_callback:
            await progress_callback(1.0)
        await proc_done
    finally:
        poll_task.cancel()
        stderr_task.cancel()
        await asyncio.gather(poll_task, stderr_task, return_exceptions=True)

    if cancel_event and cancel_event.is_set():
        temp_output.unlink(missing_ok=True)
        raise asyncio.CancelledError()

    if proc.returncode != 0:
        temp_output.unlink(missing_ok=True)
        error_msg = "".join(stderr_lines).strip()
        raise Exception(f"Video remux failed: ffmpeg exited {proc.returncode}\n{error_msg}")

    await asyncio.get_running_loop().run_in_executor(
        None,
        lambda: (input_path.unlink(missing_ok=True), temp_output.rename(input_path)),
    )

    if progress_callback:
        await progress_callback(100.0)

    return str(input_path)


async def normalize_nvenc_frame_pacing(
    video_path: str,
    progress_callback: Callable[[float], Awaitable[None]] | None = None,
    cancel_event: threading.Event | None = None,
    created_files: list[Path] | None = None,
    overwrite_original: bool = False,
) -> str:
    """Re-encode a video with NVENC while normalizing timestamps/frame pacing."""
    output_dir = Path(video_path).parent
    input_path = Path(video_path)
    output_path = input_path if overwrite_original else output_dir / f"{input_path.stem}.frame-pacing-repaired.mp4"
    temp_output = output_dir / (f"{input_path.stem}.nvenc-overwrite.tmp{input_path.suffix}" if overwrite_original else f"{input_path.stem}.frame-pacing-repaired.tmp.mp4")
    temp_output.unlink(missing_ok=True)
    source_video_bitrate = _probe_video_bitrate(video_path)
    video_encode_args = [
        "-b:v",
        str(source_video_bitrate),
        "-maxrate",
        str(max(source_video_bitrate, int(source_video_bitrate * 1.10))),
        "-bufsize",
        str(source_video_bitrate * 2),
    ] if source_video_bitrate else [
        "-cq",
        "28",
    ]

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_path,
        "-map",
        "0",
        "-c:v",
        "h264_nvenc",
        "-preset",
        "p5",
        *video_encode_args,
        "-vsync",
        "cfr",
        "-c:a",
        "copy",
        str(temp_output),
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    stderr_lines: list[str] = []

    async def _read_stderr() -> None:
        async for raw in proc.stderr:
            stderr_lines.append(raw.decode(errors="replace"))

    async def _poll_cancel() -> None:
        while not proc_done.done():
            await asyncio.sleep(0.25)
            if cancel_event and cancel_event.is_set():
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
                break

    proc_done = asyncio.ensure_future(proc.wait())
    poll_task = asyncio.create_task(_poll_cancel())
    stderr_task = asyncio.create_task(_read_stderr())
    try:
        if progress_callback:
            await progress_callback(1.0)
        await proc_done
    finally:
        poll_task.cancel()
        stderr_task.cancel()
        await asyncio.gather(poll_task, stderr_task, return_exceptions=True)

    if cancel_event and cancel_event.is_set():
        temp_output.unlink(missing_ok=True)
        raise asyncio.CancelledError()

    if proc.returncode != 0:
        temp_output.unlink(missing_ok=True)
        error_msg = "".join(stderr_lines).strip()
        raise Exception(f"NVENC frame pacing normalization failed: ffmpeg exited {proc.returncode}\n{error_msg}")

    if overwrite_original:
        await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: (input_path.unlink(missing_ok=True), temp_output.rename(input_path)),
        )
    else:
        await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: (output_path.unlink(missing_ok=True), temp_output.rename(output_path)),
        )

    if created_files is not None:
        created_files.append(output_path)

    if progress_callback:
        await progress_callback(100.0)

    return str(output_path)


async def merge_videos(
    input_paths: list[str],
    output_path: str,
    progress_callback: Callable[[float], Awaitable[None]] | None = None,
    cancel_event: threading.Event | None = None,
    created_files: list[Path] | None = None,
):
    """Merge multiple videos using ffmpeg concat demuxer (no re-encode).

    Calls progress_callback(pct) when done, where pct = 100.0.
    """
    import tempfile

    loop = asyncio.get_running_loop()
    output_file = Path(output_path)
    temp_output = output_file.parent / f"{output_file.stem}.tmp.mp4"
    filelist_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            filelist_path = f.name
            for p in input_paths:
                f.write(f"file '{p}'\n")

        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            filelist_path,
            "-c",
            "copy",
            str(temp_output),
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )

        stderr_lines: list[str] = []

        async def _drain_stderr():
            async for raw in proc.stderr:
                stderr_lines.append(raw.decode(errors="replace"))

        async def _poll_cancel():
            while not proc_done.done():
                await asyncio.sleep(0.25)
                if cancel_event and cancel_event.is_set():
                    try:
                        proc.terminate()
                    except ProcessLookupError:
                        pass
                    break

        proc_done = asyncio.ensure_future(proc.wait())
        poll_task = asyncio.create_task(_poll_cancel())
        drain_task = asyncio.create_task(_drain_stderr())
        try:
            await proc_done
        finally:
            poll_task.cancel()
            drain_task.cancel()
            await asyncio.gather(poll_task, drain_task, return_exceptions=True)

        if cancel_event and cancel_event.is_set():
            temp_output.unlink(missing_ok=True)
            raise asyncio.CancelledError()

        if proc.returncode != 0:
            temp_output.unlink(missing_ok=True)
            error_msg = "".join(stderr_lines).strip() or "unknown error"
            raise Exception(f"ffmpeg merge failed: {error_msg}")

        # Rename temp file to final output only after ffmpeg succeeds.
        # rename can copy across filesystems for large files — offload to avoid blocking event loop.
        await loop.run_in_executor(None, lambda: (output_file.unlink(missing_ok=True), temp_output.rename(output_file)))

        if created_files is not None:
            created_files.append(output_file)

        if progress_callback:
            await progress_callback(100.0)

    finally:
        if filelist_path:
            try:
                os.unlink(filelist_path)
            except OSError:
                pass


def format_srt_time(seconds: float) -> str:
    """Helper to format seconds into SRT timestamp: HH:MM:SS,mmm"""
    td = timedelta(seconds=seconds)
    total_seconds = int(td.total_seconds())
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    millis = int((seconds - int(seconds)) * 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def _generate_subtitles_sync(
    video_path: str,
    subtitle_language: str,
    cancel_event: threading.Event | None = None,
    current_progress: list[float] | None = None,
    require_gpu: bool = False,
) -> str:
    """Synchronous subtitle generation (runs in thread pool)"""

    logging.info(f"Generating subtitles for {video_path}")

    language_map = {
        "english": "en",
        "japanese": "ja",
        "chinese": "zh",
        "korean": "ko",
        "french": "fr",
        "german": "de",
        "spanish": "es",
        "italian": "it",
        "portuguese": "pt",
        "russian": "ru",
    }

    # faster-whisper transcribe() is synchronous, BUT it returns:
    #   1. an iterator/generator of segments
    #   2. metadata info
    #
    # The actual transcription work happens lazily while iterating
    # through "segments" below.
    segments, info = _get_whisper_model(require_gpu=require_gpu).transcribe(
        video_path,
        language=language_map.get(subtitle_language.lower() if subtitle_language else "", "en"),
        task="translate",
        beam_size=5,
    )

    srt_content = []

    # Each loop iteration pulls the next transcription segment
    # from the generator. This allows progress updates in real-time.
    for i, seg in enumerate(segments, start=1):
        # Allow cancellation from another thread
        if cancel_event and cancel_event.is_set():
            raise RuntimeError("cancelled")

        # seg.end increases as more audio is processed.
        # info.duration is the total video duration.
        #
        # Example:
        #   seg.end = 30 seconds
        #   info.duration = 120 seconds
        #   progress = 25%
        pct = round((seg.end / info.duration) * 100, 2)

        # current_progress is a shared mutable list between threads.
        #
        # Example:
        #   current_progress = [0]
        #
        # Updating index 0 here allows another thread
        # (such as a UI or API polling thread) to read
        # the latest progress value in real-time.
        if current_progress is not None:
            current_progress[0] = pct

        # faster-whisper segments have .start and .end attributes
        start = format_srt_time(seg.start)
        end = format_srt_time(seg.end)

        # Remove extra whitespace from transcript text
        text = seg.text.strip()

        srt_content.append(f"{i}\n{start} --> {end}\n{text}\n\n")

    return "".join(srt_content)


_cpu_warning_emitted = False


async def generate_subtitles(
    video_path: str,
    subtitle_language: str,
    progress_callback: Callable[[float], Awaitable[None]] | None = None,
    cancel_event: threading.Event | None = None,
    require_gpu: bool = False,
) -> str:
    """Generate subtitles using Whisper (async wrapper)"""
    from .models.notification import NotificationType
    from .notification_service import emit_notification

    global _cpu_warning_emitted

    loop = asyncio.get_running_loop()
    current_progress: list[float] = [0.0]

    future = loop.run_in_executor(
        _WHISPER_EXECUTOR,
        lambda: _generate_subtitles_sync(video_path, subtitle_language, cancel_event, current_progress, require_gpu),
    )

    async def _poll():
        while not future.done():
            await asyncio.sleep(0.5)
            if cancel_event and cancel_event.is_set():
                break
            if progress_callback:
                await progress_callback(current_progress[0])

    poll_task = asyncio.create_task(_poll())
    try:
        await future
        if _whisper_device == "cpu" and not _cpu_warning_emitted:
            _cpu_warning_emitted = True
            await emit_notification(
                NotificationType.SYSTEM_WARNING,
                "Whisper running on CPU",
                "CUDA unavailable — subtitle generation will be slower. Install CUDA 12 for GPU acceleration.",
            )
    except RuntimeError as e:
        if "cancelled" in str(e):
            raise asyncio.CancelledError()
        raise Exception(f"Subtitle generation failed: {str(e)}")
    except Exception as e:
        raise Exception(f"Subtitle generation failed: {str(e)}")
    finally:
        poll_task.cancel()
        await asyncio.gather(poll_task, return_exceptions=True)

    if cancel_event and cancel_event.is_set():
        raise asyncio.CancelledError()

    if progress_callback:
        await progress_callback(100.0)

    return future.result()


def save_scenes(scene_path: str, scenes: list[tuple] | None = None) -> None:
    """Save scene information to files"""

    # Save scene information
    serializable_scene_list = []
    for scene in scenes:
        # if scene[1].get_seconds() - scene[0].get_seconds() > (2 * 60):
        serializable_scene_list.append(
            {
                "start": {
                    "timecode": scene[0].get_timecode(),
                    "seconds": scene[0].get_seconds(),
                    "frames": scene[0].get_frames(),
                    "framerate": scene[0].get_framerate() or 30.0,
                },
                "end": {
                    "timecode": scene[1].get_timecode(),
                    "seconds": scene[1].get_seconds(),
                    "frames": scene[1].get_frames(),
                    "framerate": scene[1].get_framerate() or 30.0,
                },
            }
        )

    with open(scene_path, "w+") as f:
        json.dump(serializable_scene_list, f, indent=4)


def save_subtitles(video_path: str, subtitles: str, created_files: list[Path] | None = None) -> None:
    """Save subtitles to file"""
    output_dir = Path(video_path).parent
    srt_path = output_dir / f"{Path(video_path).stem}.srt"

    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(subtitles)

    if created_files is not None:
        created_files.append(srt_path)


def merge_subtitles(
    inputs: list[tuple[str, float]],
    output_srt_path: str,
    created_files: list[Path] | None = None,
) -> None:
    """Merge SRT subtitle files with per-segment time offsets.

    inputs: ordered list of (srt_path, video_duration_seconds)
    output_srt_path: destination .srt file path
    """

    def _parse_srt_time(ts: str) -> float:
        h, m, s_ms = ts.split(":")
        s, ms = s_ms.split(",")
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000

    blocks: list[str] = []
    offset = 0.0
    cue_index = 1

    for srt_path, duration in inputs:
        content = Path(srt_path).read_text(encoding="utf-8", errors="replace")
        raw_blocks = re.split(r"\n\s*\n", content.strip())
        for block in raw_blocks:
            lines = block.strip().splitlines()
            timing_idx = next((i for i, l in enumerate(lines) if "-->" in l), None)
            if timing_idx is None:
                continue
            parts = lines[timing_idx].split("-->", 1)
            if len(parts) != 2:
                continue
            start_ts = format_srt_time(_parse_srt_time(parts[0].strip()) + offset)
            end_ts = format_srt_time(_parse_srt_time(parts[1].strip()) + offset)
            text = "\n".join(lines[timing_idx + 1 :])
            blocks.append(f"{cue_index}\n{start_ts} --> {end_ts}\n{text}")
            cue_index += 1
        offset += duration

    Path(output_srt_path).write_text("\n\n".join(blocks) + "\n", encoding="utf-8")

    if created_files is not None:
        created_files.append(Path(output_srt_path))
