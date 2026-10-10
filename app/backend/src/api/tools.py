import asyncio
import json
import math
import re
import statistics
import subprocess
import threading
import time
import uuid
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from queue import Empty, Queue
from typing import Iterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import or_

from ..crud.deleted_file import record_deleted_file
from ..crud.setting import get_settings
from ..models.models import BookmarkMatchedFile, BookmarkVideoCheckRequest, BookmarkVideoCheckResponse
from ..schemas.db_helper import close_db, get_db
from ..schemas.file import FileRecord
from ..schemas.frame_pacing_analysis import FramePacingAnalysisRunRecord

router = APIRouter(prefix="/api/tools")
DEFAULT_FRAME_PACING_ANALYZER_TIMEOUT_SECONDS = 30 * 60
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv"}
SUBTITLE_EXTENSIONS = {".srt", ".vtt"}
FRAME_PACING_REPEAT_DETECTION_TIMEOUT_SECONDS = 60
FRAME_PACING_REPEAT_SAMPLE_SECONDS = 60
FRAME_PACING_REPEAT_SAMPLE_COVERAGE = 1 / 3
FRAME_PACING_REPEAT_WINDOW_TIMEOUT_SECONDS = 15
FRAME_PACING_REPEAT_FULL_SCAN_MAX_SECONDS = 90
FRAME_PACING_TIMESTAMP_FINALIZE_TIMEOUT_SECONDS = 15
FRAME_PACING_TIMESTAMP_IDLE_TIMEOUT_SECONDS = 120
_frame_pacing_run_lock = threading.Lock()
_active_frame_pacing_runs: set[str] = set()


@dataclass(frozen=True)
class RepeatedFrameDetection:
    count: int
    timed_out: bool = False


class FramePacingAnalyzeRequest(BaseModel):
    file_id: str


class FramePacingRunRequest(BaseModel):
    file_ids: list[str]


class FramePacingAnalysis(BaseModel):
    file_id: str
    status: str
    score: int
    detected_fps: float | None = None
    recommended_fps: float | None = None
    frames_analyzed: int = 0
    irregular_frames: int = 0
    large_gaps: int = 0
    repeated_frames: int = 0
    irregular_percent: float = 0.0
    message: str | None = None


class FramePacingRunResult(FramePacingAnalysis):
    file: BookmarkMatchedFile
    analysis_time_ms: int


class FramePacingRunProgress(BaseModel):
    file_id: str
    progress: float = 0
    frames_analyzed: int = 0
    message: str | None = None
    created_at: datetime | None = None


class FramePacingRunResponse(BaseModel):
    id: str
    status: str
    total: int
    done: int
    error: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    files: list[BookmarkMatchedFile] = []
    results: list[FramePacingRunResult] = []
    progress: list[FramePacingRunProgress] = []


class SubtitleHealthItem(BaseModel):
    file: BookmarkMatchedFile
    issue: str
    message: str
    related_video: BookmarkMatchedFile | None = None


class SubtitleHealthResponse(BaseModel):
    total_videos: int
    total_subtitles: int
    missing_subtitles: list[SubtitleHealthItem] = []
    missing_subtitle_files: list[SubtitleHealthItem] = []
    empty_subtitles: list[SubtitleHealthItem] = []
    orphaned_subtitles: list[SubtitleHealthItem] = []


class DeleteOrphanedSubtitlesRequest(BaseModel):
    file_ids: list[str]


class DeleteOrphanedSubtitlesResponse(BaseModel):
    deleted: int
    skipped: int
    deleted_files: list[BookmarkMatchedFile] = []


class DeleteSubtitleHealthFilesRequest(BaseModel):
    file_ids: list[str]
    issue: str


class DeleteSubtitleHealthFilesResponse(BaseModel):
    deleted: int
    skipped: int
    deleted_files: list[BookmarkMatchedFile] = []


def _rate_to_float(value: str | None) -> float | None:
    try:
        numerator, denominator = (value or "").split("/", 1)
        rate = float(numerator) / float(denominator)
        return rate if rate > 0 else None
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _classify_frame_deltas(
    deltas: list[float],
    repeated_frames: int = 0,
) -> tuple[str, int, float, int, int, float]:
    positive_deltas = [delta for delta in deltas if delta > 0]
    median_delta = statistics.median(positive_deltas)
    recommended_fps = 1.0 / median_delta
    tolerance = max(0.001, median_delta * 0.15)
    non_increasing_frames = len(deltas) - len(positive_deltas)
    timing_irregular_frames = non_increasing_frames + sum(1 for delta in positive_deltas if abs(delta - median_delta) > tolerance)
    irregular_frames = timing_irregular_frames + repeated_frames
    large_gaps = sum(1 for delta in positive_deltas if delta > median_delta * 1.5)
    irregular_percent = irregular_frames / len(deltas) * 100
    gap_percent = large_gaps / len(deltas) * 100
    repeated_percent = repeated_frames / len(deltas) * 100
    repeated_count_score = min(60, repeated_frames // 5)
    score = min(100, max(repeated_count_score, round(irregular_percent * 8 + gap_percent * 12)))
    status = (
        "severe"
        if score >= 50 or gap_percent >= 2 or repeated_frames >= 250 or repeated_percent >= 1
        else "suspect"
        if score >= 15 or irregular_percent >= 2 or repeated_frames >= 25
        else "healthy"
    )
    return status, score, recommended_fps, irregular_frames, large_gaps, irregular_percent


def _frame_pacing_video_path(file_id: str) -> Path:
    db = get_db()
    try:
        record = db.query(FileRecord).filter(FileRecord.id == file_id).first()
        if not record or record.file_type != "video" or record.is_deleted:
            raise HTTPException(status_code=404, detail="Indexed video was not found")
        return Path(record.path)
    finally:
        close_db(db)


def _frame_pacing_result(
    file_id: str,
    timestamps: list[float],
    detected_fps: float | None,
    repeated_frames: int = 0,
) -> FramePacingAnalysis:
    deltas = [later - earlier for earlier, later in zip(timestamps, timestamps[1:])]
    if len(deltas) < 30:
        return FramePacingAnalysis(
            file_id=file_id,
            status="unknown",
            score=0,
            detected_fps=round(detected_fps, 3) if detected_fps else None,
            frames_analyzed=len(timestamps),
            message="Not enough timestamped frames to classify",
        )
    if not any(delta > 0 for delta in deltas):
        return FramePacingAnalysis(
            file_id=file_id,
            status="unknown",
            score=0,
            detected_fps=round(detected_fps, 3) if detected_fps else None,
            frames_analyzed=len(timestamps),
            message="Not enough increasing frame timestamps to classify",
        )

    status, score, recommended_fps, irregular_frames, large_gaps, irregular_percent = _classify_frame_deltas(deltas, repeated_frames)

    return FramePacingAnalysis(
        file_id=file_id,
        status=status,
        score=score,
        detected_fps=round(detected_fps, 3) if detected_fps else None,
        recommended_fps=round(recommended_fps, 3) if recommended_fps else None,
        frames_analyzed=len(timestamps),
        irregular_frames=irregular_frames,
        large_gaps=large_gaps,
        repeated_frames=repeated_frames,
        irregular_percent=round(irregular_percent, 3),
    )


def _frame_pacing_error_result(file_id: str, message: str) -> FramePacingAnalysis:
    return FramePacingAnalysis(
        file_id=file_id,
        status="error",
        score=0,
        frames_analyzed=0,
        irregular_frames=0,
        large_gaps=0,
        repeated_frames=0,
        irregular_percent=0,
        message=message,
    )


def _frame_pacing_timeout_result(
    file_id: str,
    message: str,
    timestamps: list[float] | None = None,
    detected_fps: float | None = None,
) -> FramePacingAnalysis:
    deltas = [later - earlier for earlier, later in zip(timestamps or [], (timestamps or [])[1:])]
    irregular_frames = len(deltas)
    return FramePacingAnalysis(
        file_id=file_id,
        status="severe",
        score=100,
        detected_fps=round(detected_fps, 3) if detected_fps else None,
        frames_analyzed=len(timestamps or []),
        irregular_frames=irregular_frames,
        large_gaps=0,
        repeated_frames=0,
        irregular_percent=100 if irregular_frames else 0,
        message=message,
    )


def _repeated_frame_scan_windows(duration: float | None) -> list[tuple[float | None, float | None]]:
    if not duration or duration <= FRAME_PACING_REPEAT_FULL_SCAN_MAX_SECONDS:
        return [(None, None)]

    sample_seconds = min(FRAME_PACING_REPEAT_SAMPLE_SECONDS, duration)
    sample_count = max(1, math.ceil(duration * FRAME_PACING_REPEAT_SAMPLE_COVERAGE / sample_seconds))
    max_start = max(0.0, duration - sample_seconds)
    starts = [0.0] if sample_count == 1 else [
        max_start * index / (sample_count - 1)
        for index in range(sample_count)
    ]
    unique_starts = list(dict.fromkeys(round(start, 3) for start in starts))
    return [(start, sample_seconds) for start in unique_starts]


def _repeated_frame_timeout_seconds(timeout_seconds: int, window_count: int) -> int:
    requested_timeout = max(1, timeout_seconds)
    sample_timeout = max(
        FRAME_PACING_REPEAT_DETECTION_TIMEOUT_SECONDS,
        window_count * FRAME_PACING_REPEAT_WINDOW_TIMEOUT_SECONDS,
    )
    return min(requested_timeout, sample_timeout)


def _detect_repeated_visual_frames(
    video_path: Path,
    timeout_seconds: int,
    duration: float | None = None,
) -> RepeatedFrameDetection:
    windows = _repeated_frame_scan_windows(duration)
    repeat_timeout_seconds = _repeated_frame_timeout_seconds(timeout_seconds, len(windows))
    per_window_timeout = max(1, repeat_timeout_seconds // len(windows))
    repeated_frames = 0

    for start, window_duration in windows:
        command = [
            "ffmpeg", "-hide_banner", "-nostats", "-v", "debug",
        ]
        if start is not None:
            command.extend(["-ss", f"{start:.3f}"])
        command.extend(
            [
                "-i", str(video_path),
            ]
        )
        if window_duration is not None:
            command.extend(["-t", f"{window_duration:.3f}"])
        command.extend(
            [
                "-an", "-sn", "-dn",
                "-vf", "mpdecimate",
                "-f", "null", "-",
            ]
        )

        try:
            probe = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=per_window_timeout,
                check=False,
            )
        except FileNotFoundError:
            return RepeatedFrameDetection(0)
        except subprocess.TimeoutExpired:
            return RepeatedFrameDetection(repeated_frames, timed_out=True)

        if probe.returncode != 0:
            continue
        repeated_frames += len(re.findall(r"mpdecimate[^\r\n]*\bdrop\b", probe.stderr, flags=re.IGNORECASE))

    return RepeatedFrameDetection(repeated_frames)


def _frame_pacing_repeat_timeout_result(
    file_id: str,
    timestamps: list[float],
    detected_fps: float | None,
) -> FramePacingAnalysis:
    return _frame_pacing_timeout_result(
        file_id,
        "Repeated-frame detection timed out",
        timestamps,
        detected_fps,
    )


def _ndjson_event(event: str, data: dict) -> bytes:
    return (json.dumps({"event": event, **data}) + "\n").encode("utf-8")


def _frame_pacing_timeout_seconds() -> int:
    try:
        minutes = int(getattr(get_settings(), "frame_pacing_analyzer_timeout_minutes", 30) or 30)
    except (TypeError, ValueError):
        return DEFAULT_FRAME_PACING_ANALYZER_TIMEOUT_SECONDS
    return max(1, min(240, minutes)) * 60


def _file_record_payload(record: FileRecord) -> BookmarkMatchedFile:
    return BookmarkMatchedFile(
        id=record.id,
        name=record.name,
        path=record.path,
        size=record.size,
        created_at=record.created_at,
        modified_at=record.modified_at,
        duration=record.duration,
        format=record.format,
        file_type=record.file_type,
        width=record.width,
        height=record.height,
        fps=record.fps,
        codec=record.codec,
        bitrate=record.bitrate,
        is_deleted=record.is_deleted,
    )


def _subtitle_counterpart_path(subtitle_path: Path) -> Path | None:
    for extension in VIDEO_EXTENSIONS:
        candidate = subtitle_path.with_suffix(extension)
        if candidate.exists():
            return candidate
    return None


def _video_has_subtitle_path(video_path: Path) -> bool:
    return any(video_path.with_suffix(extension).exists() for extension in SUBTITLE_EXTENSIONS)


def _find_related_video_record(db, subtitle_record: FileRecord) -> FileRecord | None:
    if subtitle_record.parent_id:
        parent = db.query(FileRecord).filter(
            FileRecord.id == subtitle_record.parent_id,
            FileRecord.file_type == "video",
            FileRecord.is_deleted.is_(False),
        ).first()
        if parent:
            return parent

    subtitle_path = Path(subtitle_record.path)
    counterpart_path = _subtitle_counterpart_path(subtitle_path)
    if counterpart_path is None:
        return None
    return db.query(FileRecord).filter(
        FileRecord.path == str(counterpart_path),
        FileRecord.file_type == "video",
        FileRecord.is_deleted.is_(False),
    ).first()


def _subtitle_is_orphaned(db, subtitle_record: FileRecord) -> bool:
    related_video = _find_related_video_record(db, subtitle_record)
    if related_video:
        return not Path(related_video.path).exists()
    return _subtitle_counterpart_path(Path(subtitle_record.path)) is None


def _scan_subtitle_health() -> SubtitleHealthResponse:
    db = get_db()
    try:
        videos = db.query(FileRecord).filter(
            FileRecord.file_type == "video",
            FileRecord.parent_id.is_(None),
            FileRecord.is_deleted.is_(False),
        ).order_by(FileRecord.name.asc()).all()
        subtitles = db.query(FileRecord).filter(
            FileRecord.file_type == "subtitle",
            FileRecord.is_deleted.is_(False),
        ).order_by(FileRecord.name.asc()).all()

        subtitle_children_by_parent: dict[str, list[FileRecord]] = {}
        for subtitle in subtitles:
            if subtitle.parent_id:
                subtitle_children_by_parent.setdefault(subtitle.parent_id, []).append(subtitle)

        missing_subtitles: list[SubtitleHealthItem] = []
        missing_subtitle_files: list[SubtitleHealthItem] = []
        empty_subtitles: list[SubtitleHealthItem] = []
        orphaned_subtitles: list[SubtitleHealthItem] = []

        for video in videos:
            video_path = Path(video.path)
            child_subtitles = subtitle_children_by_parent.get(video.id, [])
            if not child_subtitles and not _video_has_subtitle_path(video_path):
                missing_subtitles.append(SubtitleHealthItem(
                    file=_file_record_payload(video),
                    issue="missing_subtitle",
                    message="No linked or same-name subtitle file was found",
                ))

        for subtitle in subtitles:
            subtitle_path = Path(subtitle.path)
            related_video = _find_related_video_record(db, subtitle)
            related_payload = _file_record_payload(related_video) if related_video else None
            if not subtitle_path.exists():
                missing_subtitle_files.append(SubtitleHealthItem(
                    file=_file_record_payload(subtitle),
                    issue="missing_subtitle_file",
                    message="Subtitle is indexed but missing on disk",
                    related_video=related_payload,
                ))
            elif subtitle_path.stat().st_size == 0:
                empty_subtitles.append(SubtitleHealthItem(
                    file=_file_record_payload(subtitle),
                    issue="empty_subtitle",
                    message="Subtitle file is empty",
                    related_video=related_payload,
                ))

            if _subtitle_is_orphaned(db, subtitle):
                orphaned_subtitles.append(SubtitleHealthItem(
                    file=_file_record_payload(subtitle),
                    issue="orphaned_subtitle",
                    message="No existing video counterpart was found",
                    related_video=related_payload,
                ))

        return SubtitleHealthResponse(
            total_videos=len(videos),
            total_subtitles=len(subtitles),
            missing_subtitles=missing_subtitles,
            missing_subtitle_files=missing_subtitle_files,
            empty_subtitles=empty_subtitles,
            orphaned_subtitles=orphaned_subtitles,
        )
    finally:
        close_db(db)


def _delete_orphaned_subtitles(file_ids: list[str]) -> DeleteOrphanedSubtitlesResponse:
    unique_ids = list(dict.fromkeys(file_id for file_id in file_ids if file_id))
    if not unique_ids:
        raise HTTPException(status_code=400, detail="Select at least one subtitle to remove")

    db = get_db()
    try:
        records = db.query(FileRecord).filter(FileRecord.id.in_(unique_ids)).all()
        deleted_files: list[BookmarkMatchedFile] = []
        skipped = 0
        for record in records:
            if record.file_type != "subtitle" or record.is_deleted or not _subtitle_is_orphaned(db, record):
                skipped += 1
                continue
            payload = _file_record_payload(record)
            try:
                Path(record.path).unlink(missing_ok=True)
            except OSError as exc:
                raise HTTPException(status_code=500, detail=f"Failed to delete {record.path}: {exc}") from exc
            record_deleted_file(db, record, reason="orphaned_subtitle_cleanup", source="subtitle_health_tool")
            db.delete(record)
            deleted_files.append(payload)

        skipped += max(0, len(unique_ids) - len(records))
        db.commit()
        return DeleteOrphanedSubtitlesResponse(deleted=len(deleted_files), skipped=skipped, deleted_files=deleted_files)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        close_db(db)


def _subtitle_matches_health_issue(db, record: FileRecord, issue: str) -> bool:
    subtitle_path = Path(record.path)
    if issue == "missing_subtitle_file":
        return not subtitle_path.exists()
    if issue == "empty_subtitle":
        return subtitle_path.exists() and subtitle_path.stat().st_size == 0
    if issue == "orphaned_subtitle":
        return _subtitle_is_orphaned(db, record)
    return False


def _delete_subtitle_health_files(body: DeleteSubtitleHealthFilesRequest) -> DeleteSubtitleHealthFilesResponse:
    unique_ids = list(dict.fromkeys(file_id for file_id in body.file_ids if file_id))
    if not unique_ids:
        raise HTTPException(status_code=400, detail="Select at least one SRT subtitle to remove")
    if body.issue not in {"missing_subtitle_file", "empty_subtitle", "orphaned_subtitle"}:
        raise HTTPException(status_code=400, detail="This subtitle health group cannot remove SRT files")

    db = get_db()
    try:
        records = db.query(FileRecord).filter(FileRecord.id.in_(unique_ids)).all()
        deleted_files: list[BookmarkMatchedFile] = []
        skipped = 0
        for record in records:
            if (
                record.file_type != "subtitle"
                or record.is_deleted
                or Path(record.path).suffix.lower() != ".srt"
                or not _subtitle_matches_health_issue(db, record, body.issue)
            ):
                skipped += 1
                continue

            payload = _file_record_payload(record)
            try:
                Path(record.path).unlink(missing_ok=True)
            except OSError as exc:
                raise HTTPException(status_code=500, detail=f"Failed to delete {record.path}: {exc}") from exc
            record_deleted_file(db, record, reason=f"{body.issue}_srt_cleanup", source="subtitle_health_tool")
            db.delete(record)
            deleted_files.append(payload)

        skipped += max(0, len(unique_ids) - len(records))
        db.commit()
        return DeleteSubtitleHealthFilesResponse(deleted=len(deleted_files), skipped=skipped, deleted_files=deleted_files)
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        close_db(db)


def _frame_pacing_run_response(record: FramePacingAnalysisRunRecord) -> FramePacingRunResponse:
    try:
        results = [FramePacingRunResult(**item) for item in json.loads(record.results_json or "[]")]
    except (TypeError, ValueError):
        results = []
    try:
        progress = [FramePacingRunProgress(**item) for item in (json.loads(record.progress_json or "{}")).values()]
    except (AttributeError, TypeError, ValueError):
        progress = []
    try:
        file_ids = json.loads(record.file_ids_json or "[]")
    except (TypeError, ValueError):
        file_ids = []
    files_by_id: dict[str, BookmarkMatchedFile] = {result.file.id: result.file for result in results}
    if file_ids:
        db = get_db()
        try:
            rows = db.query(FileRecord).filter(FileRecord.id.in_(file_ids)).all()
            files_by_id.update({row.id: _file_record_payload(row) for row in rows})
        finally:
            close_db(db)
    files = [files_by_id[file_id] for file_id in file_ids if file_id in files_by_id]
    return FramePacingRunResponse(
        id=record.id,
        status=record.status,
        total=record.total,
        done=record.done,
        error=record.error,
        created_at=record.created_at,
        started_at=record.started_at,
        completed_at=record.completed_at,
        files=files,
        results=results,
        progress=progress,
    )


def _latest_frame_pacing_run(db) -> FramePacingAnalysisRunRecord | None:
    return (
        db.query(FramePacingAnalysisRunRecord)
        .order_by(FramePacingAnalysisRunRecord.created_at.desc())
        .first()
    )


def _active_frame_pacing_run(db) -> FramePacingAnalysisRunRecord | None:
    return (
        db.query(FramePacingAnalysisRunRecord)
        .filter(FramePacingAnalysisRunRecord.status.in_(["queued", "running"]))
        .order_by(FramePacingAnalysisRunRecord.created_at.desc())
        .first()
    )


def _frame_pacing_analysis_concurrency() -> int:
    try:
        value = int(getattr(get_settings(), "frame_pacing_analyzer_concurrency", 4) or 4)
    except (TypeError, ValueError):
        return 4
    return max(1, min(8, value))


def _save_frame_pacing_file_progress(run_id: str, progress: dict) -> None:
    with _frame_pacing_run_lock:
        db = get_db()
        try:
            record = db.query(FramePacingAnalysisRunRecord).filter(FramePacingAnalysisRunRecord.id == run_id).first()
            if not record or record.status == "cancelled":
                return
            try:
                all_progress = json.loads(record.progress_json or "{}")
            except (TypeError, ValueError):
                all_progress = {}
            existing_progress = all_progress.get(progress["file_id"]) if isinstance(all_progress, dict) else None
            if isinstance(existing_progress, dict) and existing_progress.get("created_at"):
                progress["created_at"] = existing_progress["created_at"]
            else:
                progress["created_at"] = datetime.utcnow().isoformat() + "Z"
            all_progress[progress["file_id"]] = progress
            record.progress_json = json.dumps(all_progress)
            db.commit()
        finally:
            close_db(db)


def _run_single_frame_pacing_analysis(run_id: str, file_id: str) -> dict:
    started_at = time.monotonic()
    db = get_db()
    try:
        record = db.query(FileRecord).filter(FileRecord.id == file_id).first()
        if not record or record.file_type != "video" or record.is_deleted:
            file_payload = BookmarkMatchedFile(
                id=file_id,
                name=file_id,
                path="",
                size=0,
                file_type="video",
            )
            missing = True
        else:
            file_payload = _file_record_payload(record)
            missing = False
    finally:
        close_db(db)

    if missing:
        analysis = _frame_pacing_error_result(file_id, "Indexed video was not found")
    else:
        try:
            analysis = None
            for raw_event in _stream_frame_pacing_analysis(file_id):
                event = json.loads(raw_event.decode("utf-8"))
                if event.get("event") == "progress":
                    _save_frame_pacing_file_progress(
                        run_id,
                        {
                            "file_id": event["file_id"],
                            "progress": event["progress"],
                            "frames_analyzed": event["frames_analyzed"],
                            "message": event.get("message"),
                        },
                    )
                elif event.get("event") == "result":
                    analysis = FramePacingAnalysis(**{key: value for key, value in event.items() if key != "event"})
            if analysis is None:
                analysis = _frame_pacing_error_result(file_id, "Analysis finished without a result")
        except HTTPException as exc:
            analysis = _frame_pacing_error_result(file_id, str(exc.detail) if exc.detail else "Analysis failed")
        except Exception as exc:
            analysis = _frame_pacing_error_result(file_id, f"Analysis failed: {exc}")
    return {
        **analysis.model_dump(),
        "file": file_payload.model_dump(mode="json"),
        "analysis_time_ms": round((time.monotonic() - started_at) * 1000),
    }


def _save_frame_pacing_run_progress(run_id: str, results: list[dict], status: str | None = None, error: str | None = None) -> None:
    db = get_db()
    try:
        record = db.query(FramePacingAnalysisRunRecord).filter(FramePacingAnalysisRunRecord.id == run_id).first()
        if not record:
            return
        record.results_json = json.dumps(results)
        record.done = len(results)
        if status:
            record.status = status
        if error:
            record.error = error
        if status in {"completed", "failed", "cancelled"}:
            record.completed_at = datetime.utcnow()
        db.commit()
    finally:
        close_db(db)


def _frame_pacing_run_status(run_id: str) -> str | None:
    db = get_db()
    try:
        record = db.query(FramePacingAnalysisRunRecord.status).filter(FramePacingAnalysisRunRecord.id == run_id).first()
        return record[0] if record else None
    finally:
        close_db(db)


def _cancel_frame_pacing_run(run_id: str) -> FramePacingRunResponse:
    db = get_db()
    try:
        record = db.query(FramePacingAnalysisRunRecord).filter(FramePacingAnalysisRunRecord.id == run_id).first()
        if not record:
            raise HTTPException(status_code=404, detail="Analysis run was not found")
        if record.status in {"queued", "running"}:
            record.status = "cancelled"
            record.completed_at = datetime.utcnow()
            db.commit()
            db.refresh(record)
        return _frame_pacing_run_response(record)
    finally:
        close_db(db)


def _run_frame_pacing_analysis_job(run_id: str) -> None:
    should_exit = False
    db = get_db()
    try:
        record = db.query(FramePacingAnalysisRunRecord).filter(FramePacingAnalysisRunRecord.id == run_id).first()
        if not record:
            return
        file_ids = json.loads(record.file_ids_json or "[]")
        if record.status == "cancelled":
            should_exit = True
        else:
            record.status = "running"
            record.started_at = record.started_at or datetime.utcnow()
            db.commit()
    finally:
        close_db(db)

    if should_exit:
        with _frame_pacing_run_lock:
            _active_frame_pacing_runs.discard(run_id)
        return

    results: list[dict] = []
    try:
        worker_count = min(_frame_pacing_analysis_concurrency(), len(file_ids)) or 1
        with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="frame_pacing_analysis") as executor:
            pending_file_ids = iter(file_ids)
            future_to_file_id = {}

            def submit_next() -> bool:
                if _frame_pacing_run_status(run_id) == "cancelled":
                    return False
                try:
                    file_id = next(pending_file_ids)
                except StopIteration:
                    return False
                future_to_file_id[executor.submit(_run_single_frame_pacing_analysis, run_id, file_id)] = file_id
                return True

            for _ in range(worker_count):
                if not submit_next():
                    break

            while future_to_file_id:
                completed, _ = wait(future_to_file_id.keys(), timeout=1.0, return_when=FIRST_COMPLETED)
                cancelled = _frame_pacing_run_status(run_id) == "cancelled"
                if not completed and not cancelled:
                    continue
                for future in completed:
                    file_id = future_to_file_id.pop(future)
                    if cancelled:
                        continue
                    try:
                        results.append(future.result())
                    except Exception as exc:
                        results.append({
                            **_frame_pacing_error_result(file_id, f"Analysis failed: {exc}").model_dump(),
                            "file": BookmarkMatchedFile(id=file_id, name=file_id, path="", size=0, file_type="video").model_dump(mode="json"),
                            "analysis_time_ms": 0,
                        })
                    results.sort(key=lambda item: (-int(item.get("score") or 0), (item.get("file") or {}).get("name") or ""))
                    _save_frame_pacing_run_progress(run_id, results, "running")
                if cancelled:
                    for future in future_to_file_id:
                        future.cancel()
                    _save_frame_pacing_run_progress(run_id, results, "cancelled")
                    return
                while len(future_to_file_id) < worker_count and submit_next():
                    pass
        _save_frame_pacing_run_progress(run_id, results, "completed")
    except Exception as exc:
        _save_frame_pacing_run_progress(run_id, results, "failed", str(exc))
    finally:
        with _frame_pacing_run_lock:
            _active_frame_pacing_runs.discard(run_id)


def _start_frame_pacing_run_worker(run_id: str) -> None:
    with _frame_pacing_run_lock:
        if run_id in _active_frame_pacing_runs:
            return
        _active_frame_pacing_runs.add(run_id)
    threading.Thread(target=_run_frame_pacing_analysis_job, args=(run_id,), daemon=True, name=f"frame-pacing-{run_id[:8]}").start()


def _analyze_frame_pacing(file_id: str) -> FramePacingAnalysis:
    db = get_db()
    try:
        record = db.query(FileRecord).filter(FileRecord.id == file_id).first()
        if not record or record.file_type != "video" or record.is_deleted:
            raise HTTPException(status_code=404, detail="Indexed video was not found")
        video_path = Path(record.path)
        if not video_path.is_file():
            raise HTTPException(status_code=404, detail="Video file is not available on disk")

        try:
            probe = subprocess.run(
                [
                    "ffprobe", "-v", "error", "-select_streams", "v:0",
                    "-show_entries", "stream=avg_frame_rate,r_frame_rate",
                    "-show_entries", "frame=best_effort_timestamp_time",
                    "-of", "json", str(video_path),
                ],
                capture_output=True,
                text=True,
                timeout=_frame_pacing_timeout_seconds(),
                check=False,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=503, detail="ffprobe is not installed") from exc
        except subprocess.TimeoutExpired as exc:
            return _frame_pacing_timeout_result(file_id, f"Frame pacing analysis timed out after {_frame_pacing_timeout_seconds() // 60} minutes")

        if probe.returncode != 0:
            detail = probe.stderr.strip().splitlines()[-1] if probe.stderr.strip() else "ffprobe failed"
            raise HTTPException(status_code=422, detail=detail)

        payload = json.loads(probe.stdout or "{}")
        streams = payload.get("streams") or []
        stream = streams[0] if streams else {}
        timestamps = []
        for frame in payload.get("frames") or []:
            try:
                timestamps.append(float(frame["best_effort_timestamp_time"]))
            except (KeyError, TypeError, ValueError):
                continue

        detected_fps = _rate_to_float(stream.get("avg_frame_rate")) or _rate_to_float(stream.get("r_frame_rate"))
        duration = timestamps[-1] - timestamps[0] if len(timestamps) >= 2 else None
        repeated_detection = _detect_repeated_visual_frames(video_path, _frame_pacing_timeout_seconds(), duration)
        if repeated_detection.timed_out:
            return _frame_pacing_repeat_timeout_result(file_id, timestamps, detected_fps)
        return _frame_pacing_result(file_id, timestamps, detected_fps, repeated_detection.count)
    finally:
        close_db(db)


def _stream_frame_pacing_analysis(file_id: str) -> Iterator[bytes]:
    video_path = _frame_pacing_video_path(file_id)
    if not video_path.is_file():
        raise HTTPException(status_code=404, detail="Video file is not available on disk")

    try:
        metadata_probe = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=avg_frame_rate,r_frame_rate",
                "-show_entries", "format=duration",
                "-of", "json", str(video_path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="ffprobe is not installed") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Video metadata probe timed out") from exc

    if metadata_probe.returncode != 0:
        detail = metadata_probe.stderr.strip().splitlines()[-1] if metadata_probe.stderr.strip() else "ffprobe failed"
        raise HTTPException(status_code=422, detail=detail)

    metadata = json.loads(metadata_probe.stdout or "{}")
    streams = metadata.get("streams") or []
    stream = streams[0] if streams else {}
    detected_fps = _rate_to_float(stream.get("avg_frame_rate")) or _rate_to_float(stream.get("r_frame_rate"))
    try:
        duration = float((metadata.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0

    return _stream_frame_timestamp_events(file_id, video_path, duration, detected_fps, _frame_pacing_timeout_seconds())


def _stream_frame_timestamp_events(
    file_id: str,
    video_path: Path,
    duration: float,
    detected_fps: float | None,
    timeout_seconds: int = DEFAULT_FRAME_PACING_ANALYZER_TIMEOUT_SECONDS,
) -> Iterator[bytes]:
    yield _ndjson_event("progress", {"file_id": file_id, "progress": 0, "frames_analyzed": 0})

    timestamps: list[float] = []
    process: subprocess.Popen[str] | None = None
    try:
        process = subprocess.Popen(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "frame=best_effort_timestamp_time",
                "-of", "csv=p=0", str(video_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as exc:
        yield _ndjson_event("result", _frame_pacing_error_result(file_id, "ffprobe is not installed").model_dump())
        return
    started_at = time.monotonic()
    last_progress_at = 0.0
    last_progress = 0
    last_timestamp_at = started_at
    reached_99_at: float | None = None
    finalized_after_99 = False
    stdout_lines: Queue[str | None] = Queue()

    def read_stdout() -> None:
        try:
            assert process is not None and process.stdout is not None
            for stdout_line in process.stdout:
                stdout_lines.put(stdout_line)
        finally:
            stdout_lines.put(None)

    threading.Thread(target=read_stdout, daemon=True, name=f"frame-pacing-ffprobe-{file_id[:8]}").start()
    try:
        while True:
            now = time.monotonic()
            if now - started_at > timeout_seconds:
                process.kill()
                yield _ndjson_event(
                    "result",
                    _frame_pacing_timeout_result(
                        file_id,
                        f"Frame pacing analysis timed out after {timeout_seconds // 60} minutes",
                        timestamps,
                        detected_fps,
                    ).model_dump(),
                )
                return
            if not timestamps and now - last_timestamp_at > FRAME_PACING_TIMESTAMP_IDLE_TIMEOUT_SECONDS:
                process.kill()
                yield _ndjson_event(
                    "result",
                    _frame_pacing_timeout_result(
                        file_id,
                        f"Frame timestamp scan did not start after {FRAME_PACING_TIMESTAMP_IDLE_TIMEOUT_SECONDS // 60} minutes",
                        timestamps,
                        detected_fps,
                    ).model_dump(),
                )
                return
            if timestamps and now - last_timestamp_at > FRAME_PACING_TIMESTAMP_IDLE_TIMEOUT_SECONDS:
                process.kill()
                yield _ndjson_event(
                    "result",
                    _frame_pacing_timeout_result(
                        file_id,
                        f"Frame timestamp scan stalled after {FRAME_PACING_TIMESTAMP_IDLE_TIMEOUT_SECONDS // 60} minutes",
                        timestamps,
                        detected_fps,
                    ).model_dump(),
                )
                return
            if reached_99_at is not None and now - reached_99_at > FRAME_PACING_TIMESTAMP_FINALIZE_TIMEOUT_SECONDS:
                process.kill()
                finalized_after_99 = True
                break

            try:
                line = stdout_lines.get(timeout=0.25)
            except Empty:
                if process.poll() is not None:
                    break
                continue
            if line is None:
                break

            value = line.strip().split(",", 1)[0]
            try:
                timestamp = float(value)
            except (TypeError, ValueError):
                continue
            timestamps.append(timestamp)
            last_timestamp_at = time.monotonic()

            if duration > 0:
                progress = min(99, max(last_progress, round(timestamp / duration * 100)))
            else:
                progress = 0
            now = time.monotonic()
            if progress > last_progress and (now - last_progress_at >= 0.4 or progress >= 99):
                last_progress = progress
                last_progress_at = now
                if progress >= 99 and reached_99_at is None:
                    reached_99_at = now
                yield _ndjson_event("progress", {"file_id": file_id, "progress": progress, "frames_analyzed": len(timestamps)})

        stderr = process.stderr.read() if process.stderr else ""
        returncode = process.wait(timeout=5)
        if returncode != 0 and not (finalized_after_99 and timestamps):
            detail = stderr.strip().splitlines()[-1] if stderr.strip() else "ffprobe failed"
            raise HTTPException(status_code=422, detail=detail)
    except HTTPException as exc:
        message = str(exc.detail) if exc.detail else "Frame pacing analysis failed"
        yield _ndjson_event("result", _frame_pacing_error_result(file_id, message).model_dump())
        return
    except Exception as exc:
        yield _ndjson_event("result", _frame_pacing_error_result(file_id, f"Frame pacing analysis failed: {exc}").model_dump())
        return
    finally:
        if process and process.poll() is None:
            process.kill()

    repeat_windows = _repeated_frame_scan_windows(duration)
    repeat_timeout_seconds = _repeated_frame_timeout_seconds(timeout_seconds, len(repeat_windows))
    sampled_seconds = sum(window_duration or duration for _, window_duration in repeat_windows)
    yield _ndjson_event("progress", {
        "file_id": file_id,
        "progress": 99,
        "frames_analyzed": len(timestamps),
        "message": f"Checking repeated frames, sampling {sampled_seconds:.0f}s, max {repeat_timeout_seconds}s",
    })
    repeated_detection = _detect_repeated_visual_frames(video_path, timeout_seconds, duration)
    if repeated_detection.timed_out:
        result = _frame_pacing_repeat_timeout_result(file_id, timestamps, detected_fps)
    else:
        result = _frame_pacing_result(file_id, timestamps, detected_fps, repeated_detection.count)
    yield _ndjson_event("progress", {"file_id": file_id, "progress": 100, "frames_analyzed": len(timestamps)})
    yield _ndjson_event("result", result.model_dump())


def _bookmark_matched_files(db, codes: list[str], directory_ids: list[str] | None = None) -> dict[str, list[BookmarkMatchedFile]]:
    normalized_codes = [code.upper() for code in dict.fromkeys(codes) if code]
    if not normalized_codes:
        return {}

    filters = [FileRecord.name.ilike(f"%{code}%") for code in normalized_codes]
    query = db.query(FileRecord).filter(FileRecord.file_type == "video", or_(*filters))
    normalized_directory_ids = [directory_id for directory_id in dict.fromkeys(directory_ids or []) if directory_id]
    if normalized_directory_ids:
        query = query.filter(FileRecord.directory_id.in_(normalized_directory_ids))
    rows = query.order_by(FileRecord.name.asc()).all()

    matches: dict[str, list[BookmarkMatchedFile]] = {code: [] for code in normalized_codes}
    for row in rows:
        name_lower = (row.name or "").lower()
        if row.is_deleted and not (row.path and Path(row.path).exists()):
            continue

        matched_file = BookmarkMatchedFile(
            id=row.id,
            name=row.name,
            path=row.path,
            size=row.size,
            created_at=row.created_at,
            modified_at=row.modified_at,
            duration=row.duration,
            format=row.format,
            file_type=row.file_type,
            width=row.width,
            height=row.height,
            fps=row.fps,
            codec=row.codec,
            bitrate=row.bitrate,
            is_deleted=row.is_deleted,
        )
        for code in normalized_codes:
            if code.lower() in name_lower:
                matches[code].append(matched_file)
    return matches


def _check_bookmark_video_codes(body: BookmarkVideoCheckRequest) -> BookmarkVideoCheckResponse:
    db = get_db()
    try:
        traits = [
            (item.video_code.upper(), False, None)
            for item in body.items
            if item.video_code.strip()
        ]
        matched_files_by_code = _bookmark_matched_files(db, [code for code, _, _ in traits], body.directory_ids)
        checked_items = [
            item.model_copy(
                update={
                    "video_code": item.video_code.upper(),
                    "file_exists": bool(matched_files_by_code.get(item.video_code.upper())),
                    "matched_files": matched_files_by_code.get(item.video_code.upper(), []),
                }
            )
            for item in body.items
        ]
        return BookmarkVideoCheckResponse(
            items=checked_items,
            total=len(checked_items),
            existing=sum(1 for item in checked_items if item.file_exists),
        )
    finally:
        close_db(db)


@router.post("/bookmarks/check", response_model=BookmarkVideoCheckResponse)
async def check_bookmark_video_codes(body: BookmarkVideoCheckRequest):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _check_bookmark_video_codes, body)


@router.get("/subtitles/health", response_model=SubtitleHealthResponse)
async def scan_subtitle_health():
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _scan_subtitle_health)


@router.post("/subtitles/orphaned/delete", response_model=DeleteOrphanedSubtitlesResponse)
async def delete_orphaned_subtitles(body: DeleteOrphanedSubtitlesRequest):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _delete_orphaned_subtitles, body.file_ids)


@router.post("/subtitles/health/delete-srt", response_model=DeleteSubtitleHealthFilesResponse)
async def delete_subtitle_health_srt_files(body: DeleteSubtitleHealthFilesRequest):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _delete_subtitle_health_files, body)


@router.post("/frame-pacing/analyze", response_model=FramePacingAnalysis)
async def analyze_frame_pacing(body: FramePacingAnalyzeRequest):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _analyze_frame_pacing, body.file_id)


@router.post("/frame-pacing/analyze/stream")
async def analyze_frame_pacing_stream(body: FramePacingAnalyzeRequest):
    return StreamingResponse(
        _stream_frame_pacing_analysis(body.file_id),
        media_type="application/x-ndjson",
    )


@router.post("/frame-pacing/runs", response_model=FramePacingRunResponse)
async def start_frame_pacing_run(body: FramePacingRunRequest):
    file_ids = list(dict.fromkeys(file_id for file_id in body.file_ids if file_id))
    if not file_ids:
        raise HTTPException(status_code=400, detail="Select at least one video to analyze")

    db = get_db()
    try:
        active = _active_frame_pacing_run(db)
        if active:
            _start_frame_pacing_run_worker(active.id)
            return _frame_pacing_run_response(active)

        records = (
            db.query(FileRecord)
            .filter(FileRecord.id.in_(file_ids), FileRecord.file_type == "video", FileRecord.is_deleted.is_(False))
            .all()
        )
        found_ids = {record.id for record in records}
        missing = [file_id for file_id in file_ids if file_id not in found_ids]
        if missing:
            raise HTTPException(status_code=404, detail=f"{len(missing)} selected video(s) were not found")

        db.query(FramePacingAnalysisRunRecord).delete()
        run = FramePacingAnalysisRunRecord(
            id=str(uuid.uuid4()),
            status="queued",
            file_ids_json=json.dumps(file_ids),
            results_json="[]",
            total=len(file_ids),
            done=0,
            created_at=datetime.utcnow(),
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        response = _frame_pacing_run_response(run)
    finally:
        close_db(db)

    _start_frame_pacing_run_worker(response.id)
    return response


@router.get("/frame-pacing/runs/latest", response_model=FramePacingRunResponse | None)
async def get_latest_frame_pacing_run():
    db = get_db()
    try:
        run = _latest_frame_pacing_run(db)
        if not run:
            return None
        response = _frame_pacing_run_response(run)
    finally:
        close_db(db)

    if response.status in {"queued", "running"}:
        _start_frame_pacing_run_worker(response.id)
    return response


@router.get("/frame-pacing/runs/{run_id}", response_model=FramePacingRunResponse)
async def get_frame_pacing_run(run_id: str):
    db = get_db()
    try:
        run = db.query(FramePacingAnalysisRunRecord).filter(FramePacingAnalysisRunRecord.id == run_id).first()
        if not run:
            raise HTTPException(status_code=404, detail="Analysis run was not found")
        response = _frame_pacing_run_response(run)
    finally:
        close_db(db)

    if response.status in {"queued", "running"}:
        _start_frame_pacing_run_worker(response.id)
    return response


@router.post("/frame-pacing/runs/{run_id}/cancel", response_model=FramePacingRunResponse)
async def cancel_frame_pacing_run(run_id: str):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _cancel_frame_pacing_run, run_id)
