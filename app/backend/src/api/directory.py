import asyncio
import json
import logging
import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from ..crud.deleted_file import record_deleted_file
from ..crud.directory import Directory
from ..crud.file import File
from ..crud.setting import get_settings
from ..models.models import Directory as DirectoryModel
from ..models.models import File as FileModel
from ..models.notification import NotificationType
from ..notification_service import emit_notification
from ..schemas.db_helper import db_session
from ..schemas.directory import DirectoryRecord
from ..schemas.directory_monitor import DirectoryMonitorRecord
from ..schemas.file import FileRecord
from ..utils import generate_filename_id, get_video_metadata, is_ignored

router = APIRouter(prefix="/api/directory")


def find_folder_path(start_dir, folder_name):
    # Search recursively for the folder name
    for path in Path(start_dir).rglob(folder_name):
        if path.is_dir():
            return path.absolute()
    return None


_VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv"}
_MEDIA_EXTENSIONS = _VIDEO_EXTENSIONS | {".srt", ".vtt"}


class RenameDirectoryRequest(BaseModel):
    new_name: str

    @field_validator("new_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("new_name cannot be empty")
        if "/" in value or "\\" in value:
            raise ValueError("new_name cannot contain path separators")
        return value


class MoveDirectoryRequest(BaseModel):
    destination_directory_id: str

    @field_validator("destination_directory_id")
    @classmethod
    def validate_destination_directory_id(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("destination_directory_id cannot be empty")
        return value


def _is_same_or_descendant_path(path: str, root_path: str) -> bool:
    normalized_path = path.rstrip("/")
    normalized_root = root_path.rstrip("/")
    return normalized_path == normalized_root or normalized_path.startswith(normalized_root + "/")


def _replace_path_prefix(path: str, old_prefix: str, new_prefix: str) -> str:
    if path == old_prefix:
        return new_prefix
    return new_prefix + path[len(old_prefix):]


def _apply_directory_path_change(
    db: Session,
    directory_record: DirectoryRecord,
    new_path: str,
    *,
    new_name: str,
    new_parent_id: str | None,
):
    old_path = directory_record.path
    affected_directories = [
        record for record in db.query(DirectoryRecord).all()
        if _is_same_or_descendant_path(record.path, old_path)
    ]
    affected_files = [
        record for record in db.query(FileRecord).all()
        if _is_same_or_descendant_path(record.path, old_path)
    ]
    affected_monitors = db.query(DirectoryMonitorRecord).filter(DirectoryMonitorRecord.directory_id == directory_record.id).all()

    directory_record.name = new_name
    directory_record.path = new_path
    directory_record.parent_id = new_parent_id

    for child_directory in affected_directories:
        if child_directory.id == directory_record.id:
            continue
        child_directory.path = _replace_path_prefix(child_directory.path, old_path, new_path)

    for file_record in affected_files:
        file_record.path = _replace_path_prefix(file_record.path, old_path, new_path)

    for monitor_record in affected_monitors:
        monitor_record.directory_name = new_name
        monitor_record.directory_path = new_path

    db.commit()
    db.refresh(directory_record)
    return directory_record


def _process_file(entry, known_files: dict[str, dict] = {}) -> tuple[Optional[FileModel], bool]:
    """Returns (FileModel, is_cache_hit). is_cache_hit=True means DB already has current metadata."""
    try:
        stats = entry.stat()
        suffix = Path(entry.name).suffix.lower()
        path_str = str(entry.path)

        # Skip get_video_metadata when DB already has current metadata for this file.
        cached = known_files.get(path_str)
        if cached is not None and cached["size"] == stats.st_size:
            disk_mtime = datetime.utcfromtimestamp(int(stats.st_mtime))
            cached_mtime = cached["modified_at"]
            if not cached_mtime or abs((cached_mtime - disk_mtime).total_seconds()) <= 1:
                return FileModel(
                    id=generate_filename_id(entry.name, path_str),
                    name=entry.name,
                    path=path_str,
                    size=stats.st_size,
                    format=cached["format"] or suffix.lstrip("."),
                    duration=cached["duration"],
                    width=cached["width"],
                    height=cached["height"],
                    fps=cached["fps"],
                    codec=cached["codec"],
                    bitrate=cached["bitrate"],
                ), True

        meta = get_video_metadata(path_str) if suffix in _VIDEO_EXTENSIONS else {}
        return FileModel(
            id=generate_filename_id(entry.name, path_str),
            name=entry.name,
            path=path_str,
            size=stats.st_size,
            duration=meta.get("duration", "00:00:00"),
            format=suffix,
            width=meta.get("width"),
            height=meta.get("height"),
            fps=meta.get("fps"),
            codec=meta.get("codec"),
            bitrate=meta.get("bitrate"),
        ), False
    except Exception as e:
        logging.error(f"Failed processing file {entry.path}: {e}")
        return None, False


_FILE_PROCESS_TIMEOUT = 30.0  # seconds before a hung stat/av.open is abandoned


async def stream_directory_contents(target_path: Path, ignore_patterns: list[str] = [], known_files: dict[str, dict] = {}):
    """Async generator yielding (FileModel | None, subdirectories, is_cache_hit) as each file resolves."""
    entries = list(os.scandir(target_path))
    files_to_process = []
    subdirectories = []

    for entry in entries:
        full_path = str(entry.path)
        if entry.is_dir() and entry.name != "scenes":
            subdirectories.append(DirectoryModel(id=generate_filename_id(entry.name, full_path), name=entry.name, path=full_path, files=[], subdirectories=[]))
        elif (
            entry.is_file()
            and Path(entry.name).suffix.lower() in _MEDIA_EXTENSIONS
            and not is_ignored(entry.name, ignore_patterns)
        ):
            files_to_process.append(entry)

    subdirectories.sort(key=lambda d: d.name.lower())

    # Always yield subdirectories first so callers can recurse even when no files exist.
    yield None, subdirectories, False

    if not files_to_process:
        return

    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor(max_workers=os.cpu_count() * 5) as executor:
        # known_files (plain dict, no ORM objects) is safe to read from threads via GIL.
        # _process_file handles the cache check and get_video_metadata call internally.
        raw_futures = [loop.run_in_executor(executor, _process_file, entry, known_files) for entry in files_to_process]
        # Wrap each future with a timeout so a hung stat/open can't stall the entire scan.
        async def _with_timeout(fut, path):
            try:
                return await asyncio.wait_for(asyncio.shield(fut), timeout=_FILE_PROCESS_TIMEOUT)
            except asyncio.TimeoutError:
                logging.warning(f"File processing timed out after {_FILE_PROCESS_TIMEOUT}s, skipping: {path}")
                return None, False
        timeout_tasks = [asyncio.ensure_future(_with_timeout(f, files_to_process[i].path)) for i, f in enumerate(raw_futures)]
        for coro in asyncio.as_completed(timeout_tasks):
            file_model, is_cache_hit = await coro
            if file_model:
                yield file_model, subdirectories, is_cache_hit


def get_directory_contents(target_path: Path, ignore_patterns: list[str] = []):
    """Synchronous version used by non-streaming endpoints."""
    entries = list(os.scandir(target_path))
    files_to_process = []
    subdirectories = []

    for entry in entries:
        full_path = str(entry.path)
        if entry.is_dir() and entry.name != "scenes":
            subdirectories.append(DirectoryModel(id=generate_filename_id(entry.name, full_path), name=entry.name, path=full_path, files=[], subdirectories=[]))
        elif (
            entry.is_file()
            and Path(entry.name).suffix.lower() in _MEDIA_EXTENSIONS
            and not is_ignored(entry.name, ignore_patterns)
        ):
            files_to_process.append(entry)

    with ThreadPoolExecutor(max_workers=os.cpu_count() * 5) as executor:
        files = [f for f in executor.map(_process_file, files_to_process) if f]

    return DirectoryModel(
        id=generate_filename_id(target_path.name or str(target_path), str(target_path)),
        name=target_path.name or str(target_path),
        path=str(target_path),
        files=sorted(files, key=lambda f: f.name.lower()) if files else [],
        subdirectories=sorted(subdirectories, key=lambda d: d.name.lower()) if subdirectories else [],
    )


@router.get("")
async def list_directories(db: Session = Depends(db_session)):
    """Return all tracked directories (id, name, path, parent_id) for filter dropdowns."""
    directory_crud = Directory(db)
    all_dirs = directory_crud.get_directory_hierarchy()
    return [{"id": d.id, "name": d.name, "path": d.path, "parent_id": d.parent_id} for d in sorted(all_dirs, key=lambda d: d.path.lower())]


@router.get("/top_level")
def get_top_level_directories():
    """List immediate subdirectories of VIDEO_STORAGE_PATH (excludes 'scenes' dirs)."""
    base_path = Path(os.getenv("VIDEO_STORAGE_PATH", "/videos"))
    if not base_path.exists():
        return []
    dirs = [
        {"name": entry.name, "path": str(entry.path)}
        for entry in os.scandir(base_path)
        if entry.is_dir() and entry.name != "scenes"
    ]
    return sorted(dirs, key=lambda d: d["name"].lower())


@router.get("/scan_all/stream")
async def scan_all_directories_stream(
    request: Request,
    directories: Optional[str] = Query(None, description="Comma-separated list of top-level dir names to scan"),
    db: Session = Depends(db_session),
):

    async def event_generator():
        base_path_str = os.getenv("VIDEO_STORAGE_PATH", "/videos")
        videos_path = Path(base_path_str)

        if not videos_path.exists():
            yield {"event": "error", "data": "Path not found"}
            return

        yield {
            "event": "progress",
            "data": json.dumps(
                {"current_file": "Preparing scan...", "processed": 0, "total": 0, "percentage": 0, "skipped": 0, "eta_seconds": None}
            ),
        }

        try:
            # Load ignore patterns from settings once for this scan
            _settings = get_settings()
            _raw = _settings.ignore_patterns
            patterns: list[str] = json.loads(_raw) if isinstance(_raw, str) else (_raw or [])

            allowed_dirs: Optional[set[str]] = {d.strip() for d in directories.split(",") if d.strip()} if directories else None

            # Bulk-load all known file records once; use plain dicts so ORM objects
            # are never accessed from ThreadPoolExecutor workers (Session is not thread-safe).
            known_files: dict[str, dict] = {
                r.path: {
                    "size": r.size,
                    "modified_at": r.modified_at,
                    "format": r.format,
                    "duration": r.duration,
                    "width": r.width,
                    "height": r.height,
                    "fps": r.fps,
                    "codec": r.codec,
                    "bitrate": r.bitrate,
                }
                for r in db.query(FileRecord).all()
            }

            # Estimate total from DB — avoids a full pre-scan filesystem walk.
            # Accurate for rescans; adjusts dynamically as new files are discovered.
            base_prefix = base_path_str.rstrip("/") + "/"
            if allowed_dirs is None:
                total_files = sum(1 for p in known_files if p.startswith(base_prefix))
            else:
                total_files = sum(
                    1 for p in known_files
                    if any(p.startswith(base_prefix + d + "/") for d in allowed_dirs)
                )

            processed_files = 0
            skipped_files = 0
            start_time = time.monotonic()

            async def scan_recursive(current_path: Path, parent_id: Optional[str] = None):
                nonlocal processed_files, skipped_files, total_files

                directory_crud = Directory(db)
                directory_record = directory_crud.get_or_create_directory(current_path.name or str(current_path), str(current_path), parent_id)

                file_crud = File(db)
                cached_paths: list[str] = []  # unchanged files — batch-committed after directory
                subdirectories = []

                async for file_entry, subdirs, is_cache_hit in stream_directory_contents(current_path, patterns, known_files):
                    subdirectories = subdirs
                    # At root level, restrict recursion to allowed_dirs
                    if allowed_dirs is not None and str(current_path) == str(videos_path):
                        subdirectories = [s for s in subdirectories if Path(s.path).name in allowed_dirs]
                    if file_entry is None:
                        continue  # header yield carrying subdirectories only

                    if await request.is_disconnected():
                        return

                    try:
                        if is_cache_hit:
                            # File is unchanged — defer last_scanned_at to batch update below.
                            cached_paths.append(file_entry.path)
                            was_skipped = True
                        else:
                            # New or changed file — full sync (rare during rescans).
                            if file_entry.path not in known_files:
                                total_files += 1  # first-scan: adjust estimate as new files appear
                            file_extension = Path(file_entry.name).suffix.lower()
                            file_type = "subtitle" if file_extension in {".srt", ".vtt"} else "video"
                            _, was_skipped = file_crud.sync_file_metadata(
                                name=file_entry.name,
                                path=file_entry.path,
                                size=file_entry.size,
                                file_type=file_type,
                                format=file_entry.format,
                                duration=file_entry.duration,
                                directory_id=directory_record.id,
                                width=file_entry.width,
                                height=file_entry.height,
                                fps=file_entry.fps,
                                codec=file_entry.codec,
                                bitrate=file_entry.bitrate,
                            )

                        processed_files += 1
                        if was_skipped:
                            skipped_files += 1

                        if processed_files % 5 == 0 or processed_files == total_files:
                            progress = min(round((processed_files / total_files) * 100, 2), 99) if total_files > 0 else 99
                            elapsed = time.monotonic() - start_time
                            rate = processed_files / elapsed if elapsed > 0 else 0
                            remaining = total_files - processed_files
                            eta_seconds = round(remaining / rate) if rate > 0 else None
                            yield {
                                "event": "progress",
                                "data": json.dumps(
                                    {"current_file": file_entry.name, "processed": processed_files, "total": total_files, "percentage": progress, "skipped": skipped_files, "eta_seconds": eta_seconds}
                                ),
                            }
                    except Exception as e:
                        db.rollback()
                        logging.error(f"Error processing file {file_entry.name}: {e}")

                # Single bulk UPDATE for all unchanged files in this directory — replaces N individual queries+commits.
                if cached_paths:
                    file_crud.batch_update_scanned_at(cached_paths)

                for subdirectory in subdirectories:
                    sub_path = Path(subdirectory.path)
                    if sub_path.exists():
                        async for progress_update in scan_recursive(sub_path, directory_record.id):
                            yield progress_update

            # Emit SCAN_STARTED notification
            await emit_notification(
                NotificationType.SCAN_STARTED,
                "Directory Scan Started",
                "Scanning for new and modified files",
            )

            files_found_batch = 0
            last_files_found_count = 0

            # START: Iterate through the top-level generator
            async for update in scan_recursive(videos_path):
                # Track new files for batch notification
                if update.get("event") == "progress":
                    try:
                        data = json.loads(update.get("data", "{}"))
                        current_processed = data.get("processed", 0)
                        if current_processed > last_files_found_count + 9:
                            files_found_batch = current_processed - last_files_found_count
                            last_files_found_count = current_processed
                            await emit_notification(
                                NotificationType.FILES_FOUND,
                                "Files Processed",
                                f"{files_found_batch} files processed ({current_processed} total)",
                            )
                    except (json.JSONDecodeError, KeyError):
                        pass
                yield update

            # Emit SCAN_COMPLETED notification
            await emit_notification(
                NotificationType.SCAN_COMPLETED,
                "Directory Scan Completed",
                f"Processed {processed_files} files ({skipped_files} skipped)",
            )

            yield {"event": "done", "data": json.dumps({"current_file": "No more files to process", "processed": processed_files, "total": total_files, "percentage": 100, "skipped": skipped_files})}
        except Exception as exc:
            logging.exception("Directory scan stream failed")
            yield {"event": "scan_error", "data": f"Scan failed: {exc}"}

    return EventSourceResponse(event_generator(), ping=15)


@router.get("/scan/{directory_path}")
async def scan_directory(directory_path: str, db: Session = Depends(db_session)):
    """Scan a specific directory by path"""

    try:
        # Emit SCAN_STARTED notification
        await emit_notification(
            NotificationType.SCAN_STARTED,
            "Directory Scan Started",
            f"Scanning directory: {directory_path}",
        )

        # Use the provided directory_path directly
        full_path = Path(directory_path)

        if not full_path.exists():
            raise HTTPException(status_code=404, detail="Directory not found")

        loop = asyncio.get_running_loop()
        _s = await loop.run_in_executor(None, get_settings)
        _raw = _s.ignore_patterns
        _patterns: list[str] = json.loads(_raw) if isinstance(_raw, str) else (_raw or [])
        directory_contents = await loop.run_in_executor(None, get_directory_contents, full_path, _patterns)
        # Create directory record in database for this specific scan
        directory_crud = Directory(db)
        directory_record = directory_crud.get_or_create_directory(full_path.name or str(full_path), str(full_path))

        # Process files in this directory to create metadata records
        files_processed = 0
        for file_entry in directory_contents.files:
            try:
                # Determine file type based on extension
                file_extension = Path(file_entry.name).suffix.lower()
                if file_extension in {".srt", ".vtt"}:
                    file_type = "subtitle"
                else:
                    file_type = "video"

                # Create file metadata record
                file_crud = File(db)
                file_crud.create_file_metadata(
                    name=file_entry.name,
                    path=file_entry.path,
                    size=file_entry.size,
                    file_type=file_type,
                    format=file_entry.format,
                    duration=file_entry.duration,
                    directory_id=directory_record.id,
                    width=file_entry.width,
                    height=file_entry.height,
                    fps=file_entry.fps,
                    codec=file_entry.codec,
                    bitrate=file_entry.bitrate,
                )
                files_processed += 1
            except Exception as e:
                logging.error(f"Error creating file metadata for {file_entry.name}: {e}")

        # Emit FILES_FOUND and SCAN_COMPLETED notifications
        if files_processed > 0:
            await emit_notification(
                NotificationType.FILES_FOUND,
                "Files Found",
                f"{files_processed} files found in directory",
            )

        await emit_notification(
            NotificationType.SCAN_COMPLETED,
            "Directory Scan Completed",
            f"Scan completed: {files_processed} files processed",
        )

        return [directory_contents]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error scanning directory: {str(e)}")


@router.get("/files")
async def get_files_in_directory(path: str, db: Session = Depends(db_session)):
    """Return all files in the given directory path from the database."""
    directory_crud = Directory(db)
    all_dirs = directory_crud.get_directory_hierarchy()
    dir_record = next((d for d in all_dirs if d.path == path), None)
    if not dir_record:
        raise HTTPException(status_code=404, detail="Directory not found")

    file_records = directory_crud.get_directory_files(directory_id=dir_record.id)
    return [
        FileModel(
            id=f.id,
            name=f.name,
            path=f.path,
            size=f.size,
            duration=f.duration or "00:00:00",
            format=f.format or "",
            parent_id=f.parent_id,
            width=f.width,
            height=f.height,
            fps=f.fps,
            codec=f.codec,
            bitrate=f.bitrate,
            file_type=f.file_type,
            status=f.status,
        )
        for f in sorted(file_records, key=lambda f: f.name.lower())
    ]


@router.delete("/delete/{directory_id}")
async def delete_directory(
    directory_id: str,
    delete_from_disk: bool = Query(True),
    delete_from_database: bool = Query(True),
    db: Session = Depends(db_session),
):
    """Delete a directory record and its associated files"""
    if not delete_from_disk and not delete_from_database:
        raise HTTPException(status_code=400, detail="Choose at least one delete target")

    directory_crud = Directory(db)

    # First get the directory to verify it exists
    directories = directory_crud.get_directory_hierarchy(directory_id=directory_id)
    if not directories:
        raise HTTPException(status_code=404, detail="Directory not found")

    directory_record = directories[0]
    descendant_directories = [
        record for record in directory_crud.get_directory_hierarchy()
        if _is_same_or_descendant_path(record.path, directory_record.path)
    ]
    descendant_directory_ids = {record.id for record in descendant_directories}

    if delete_from_database:
        for file_record in directory_crud.get_file_metadata():
            if file_record.directory_id in descendant_directory_ids or _is_same_or_descendant_path(file_record.path, directory_record.path):
                record_deleted_file(db, file_record, reason="directory_delete", source="directory_api")
                db.delete(file_record)

        db.query(DirectoryMonitorRecord).filter(DirectoryMonitorRecord.directory_id.in_(descendant_directory_ids)).delete(synchronize_session=False)

        for descendant_directory in sorted(descendant_directories, key=lambda record: len(record.path), reverse=True):
            db.delete(descendant_directory)

    if delete_from_disk:
        try:
            shutil.rmtree(directory_record.path)
        except FileNotFoundError:
            pass
        except NotADirectoryError:
            try:
                os.remove(directory_record.path)
            except FileNotFoundError:
                pass

    db.commit()

    return {"message": f"Successfully deleted directory {directory_id}"}


@router.patch("/{directory_id}/rename")
async def rename_directory(directory_id: str, body: RenameDirectoryRequest, db: Session = Depends(db_session)):
    """Rename a directory on disk and in the DB, cascading to descendants."""
    directory_record = db.query(DirectoryRecord).filter(DirectoryRecord.id == directory_id).first()
    if directory_record is None:
        raise HTTPException(status_code=404, detail="Directory not found")

    old_path = directory_record.path
    if not os.path.isdir(old_path):
        raise HTTPException(status_code=404, detail="Directory path does not exist on disk")

    new_path = str(Path(old_path).parent / body.new_name)
    if new_path != old_path and os.path.exists(new_path):
        raise HTTPException(status_code=409, detail="A directory with that name already exists")

    try:
        os.rename(old_path, new_path)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to rename directory on disk: {exc}")

    updated_record = _apply_directory_path_change(
        db,
        directory_record,
        new_path,
        new_name=body.new_name,
        new_parent_id=directory_record.parent_id,
    )

    return {
        "id": updated_record.id,
        "name": updated_record.name,
        "path": updated_record.path,
        "parent_id": updated_record.parent_id,
    }


@router.patch("/{directory_id}/move")
async def move_directory(directory_id: str, body: MoveDirectoryRequest, db: Session = Depends(db_session)):
    """Move a directory on disk and in the DB, cascading to descendants."""
    directory_record = db.query(DirectoryRecord).filter(DirectoryRecord.id == directory_id).first()
    if directory_record is None:
        raise HTTPException(status_code=404, detail="Directory not found")

    destination_record = db.query(DirectoryRecord).filter(DirectoryRecord.id == body.destination_directory_id).first()
    if destination_record is None:
        raise HTTPException(status_code=404, detail="Destination directory not found")

    if directory_record.id == destination_record.id:
        raise HTTPException(status_code=422, detail="Cannot move a directory into itself")

    if _is_same_or_descendant_path(destination_record.path, directory_record.path):
        raise HTTPException(status_code=422, detail="Cannot move a directory into itself or one of its descendants")

    old_path = directory_record.path
    if not os.path.isdir(old_path):
        raise HTTPException(status_code=404, detail="Directory path does not exist on disk")
    if not os.path.isdir(destination_record.path):
        raise HTTPException(status_code=404, detail="Destination directory path does not exist on disk")

    new_path = str(Path(destination_record.path) / directory_record.name)
    if new_path != old_path and os.path.exists(new_path):
        raise HTTPException(status_code=409, detail="A directory with that name already exists in the destination")

    try:
        shutil.move(old_path, new_path)
    except (OSError, shutil.Error) as exc:
        raise HTTPException(status_code=500, detail=f"Failed to move directory on disk: {exc}")

    updated_record = _apply_directory_path_change(
        db,
        directory_record,
        new_path,
        new_name=directory_record.name,
        new_parent_id=destination_record.id,
    )

    return {
        "id": updated_record.id,
        "name": updated_record.name,
        "path": updated_record.path,
        "parent_id": updated_record.parent_id,
    }


@router.get("/tree")
async def get_directory_tree(path: str, db: Session = Depends(db_session)):
    """Retrieve the entire directory tree from the database efficiently"""
    directory_crud = Directory(db)

    # Resolve the physical path
    full_path = Path(path)
    if full_path == Path("/videos"):
        full_path = Path(os.getenv("VIDEO_STORAGE_PATH", "/videos"))

    # 1. Fetch all directory records in a single query to avoid N+1 issues
    all_directories = directory_crud.get_directory_hierarchy()
    if not all_directories:
        raise HTTPException(status_code=404, detail="No directories found in database.")

    # 2. Find the starting root record in the list
    root_record = next((d for d in all_directories if d.path == str(full_path)), None)
    if not root_record:
        raise HTTPException(status_code=404, detail="Starting directory not found. Please scan first.")

    # 3. Create a mapping of parent_id -> list of child directories for O(1) lookups
    children_map = {}
    for d in all_directories:
        if d.parent_id not in children_map:
            children_map[d.parent_id] = []
        children_map[d.parent_id].append(d)

    def build_tree(current_record):
        direct_children = children_map.get(current_record.id, [])
        direct_children.sort(key=lambda x: x.name.lower())

        return DirectoryModel(
            id=current_record.id, name=current_record.name, path=current_record.path, files=[], subdirectories=[build_tree(child) for child in direct_children]
        )

    try:
        return build_tree(root_record)
    except Exception as e:
        logging.error(f"Error building tree: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _cleanup_missing_files_blocking(db: Session, directory_path: str | None = None):
    """Blocking cleanup logic — run in executor to avoid blocking event loop."""
    if directory_path is not None:
        directory_path = directory_path.rstrip("/")

    directory_crud = Directory(db)

    all_files = directory_crud.get_file_metadata()
    if directory_path is not None:
        all_files = [
            f for f in all_files
            if f.path == directory_path or f.path.startswith(directory_path + "/")
        ]

    deleted_files = []
    for file_record in all_files:
        if not Path(file_record.path).exists():
            record_deleted_file(db, file_record, reason="missing_file_cleanup", source="directory_cleanup")
            db.delete(file_record)
            deleted_files.append(file_record.path)

    all_directories = directory_crud.get_directory_hierarchy()
    if directory_path is not None:
        all_directories = [
            d for d in all_directories
            if d.path == directory_path or d.path.startswith(directory_path + "/")
        ]

    deleted_dirs = []
    for dir_record in all_directories:
        if not Path(dir_record.path).exists():
            db.delete(dir_record)
            deleted_dirs.append(dir_record.path)

    db.commit()

    return deleted_files, deleted_dirs


@router.delete("/cleanup")
async def cleanup_missing_files(
    directory_path: str | None = Query(None),
    db: Session = Depends(db_session),
):
    """Delete DB records for files and directories that no longer exist on disk"""
    loop = asyncio.get_event_loop()
    deleted_files, deleted_dirs = await loop.run_in_executor(
        None, _cleanup_missing_files_blocking, db, directory_path
    )

    return {
        "deleted_files": deleted_files,
        "deleted_directories": deleted_dirs,
        "total_deleted": len(deleted_files) + len(deleted_dirs),
    }


@router.get("/cleanup/stream")
async def cleanup_missing_files_stream(
    directories: Optional[str] = Query(None, description="Comma-separated top-level dir names to scope cleanup"),
    db: Session = Depends(db_session),
):
    """SSE stream: check each DB record, delete missing, emit progress events."""

    async def event_generator():
        directory_crud = Directory(db)
        all_files = directory_crud.get_file_metadata()
        all_dirs = directory_crud.get_directory_hierarchy()

        if directories:
            base = Path(os.getenv("VIDEO_STORAGE_PATH", "/videos"))
            dir_names = [d.strip() for d in directories.split(",") if d.strip()]
            allowed_prefixes = [str(base / name).rstrip("/") + "/" for name in dir_names]
            all_files = [
                f for f in all_files
                if any(f.path.startswith(prefix) for prefix in allowed_prefixes)
            ]
            all_dirs = [
                d for d in all_dirs
                if any(d.path.startswith(prefix) for prefix in allowed_prefixes)
            ]

        total = len(all_files) + len(all_dirs)
        processed = 0
        deleted = 0

        BATCH = 10

        for file_record in all_files:
            if not Path(file_record.path).exists():
                record_deleted_file(db, file_record, reason="missing_file_cleanup_stream", source="directory_cleanup")
                db.delete(file_record)
                deleted += 1
            processed += 1

            if processed % BATCH == 0 or processed == len(all_files):
                pct = int(processed / total * 100) if total else 100
                yield {
                    "event": "progress",
                    "data": json.dumps({
                        "percentage": pct,
                        "current_file": file_record.path,
                        "processed": processed,
                        "total": total,
                        "deleted": deleted,
                    }),
                }
                await asyncio.sleep(0)

        for dir_record in all_dirs:
            if not Path(dir_record.path).exists():
                db.delete(dir_record)
                deleted += 1
            processed += 1

            if processed % BATCH == 0 or processed == total:
                pct = int(processed / total * 100) if total else 100
                yield {
                    "event": "progress",
                    "data": json.dumps({
                        "percentage": pct,
                        "current_file": dir_record.path,
                        "processed": processed,
                        "total": total,
                        "deleted": deleted,
                    }),
                }
                await asyncio.sleep(0)

        db.commit()

        yield {
            "event": "done",
            "data": json.dumps({
                "percentage": 100,
                "current_file": "",
                "processed": processed,
                "total": total,
                "deleted": deleted,
            }),
        }

    return EventSourceResponse(event_generator())


def _cleanup_unused_subtitles_blocking(db: Session):
    """Blocking cleanup logic for unused SRT files — run in executor to avoid blocking event loop."""
    directory_crud = Directory(db)

    all_files = directory_crud.get_file_metadata()

    deleted_count = 0
    for file_record in all_files:
        if file_record.file_type != "subtitle":
            continue

        should_delete = False
        if file_record.parent_id is not None:
            parent_record = db.query(FileRecord).filter(FileRecord.id == file_record.parent_id).first()
            if parent_record is None or not Path(parent_record.path).exists():
                should_delete = True
        else:
            srt_path = Path(file_record.path)
            has_video = any(
                (srt_path.parent / (srt_path.stem + ext)).exists()
                for ext in _VIDEO_EXTENSIONS
            )
            if not has_video:
                should_delete = True

        if should_delete:
            if Path(file_record.path).exists():
                os.remove(file_record.path)
            record_deleted_file(db, file_record, reason="unused_subtitle_cleanup", source="directory_cleanup")
            db.delete(file_record)
            deleted_count += 1

    db.commit()
    return deleted_count


@router.delete("/cleanup-subtitles")
async def cleanup_unused_subtitles(db: Session = Depends(db_session)):
    """Delete DB records and disk files for SRTs whose parent video no longer exists"""
    loop = asyncio.get_event_loop()
    deleted = await loop.run_in_executor(None, _cleanup_unused_subtitles_blocking, db)
    return {"deleted": deleted}


@router.get("/cleanup-subtitles/stream")
async def cleanup_unused_subtitles_stream(
    directories: Optional[str] = Query(None, description="Comma-separated top-level dir names to scope deletion"),
    db: Session = Depends(db_session),
):
    """SSE stream: check each subtitle, delete orphaned ones, emit progress events."""

    async def event_generator():
        directory_crud = Directory(db)
        all_files = directory_crud.get_file_metadata()

        subtitle_files = [f for f in all_files if f.file_type == "subtitle"]

        if directories:
            base = Path(os.getenv("VIDEO_STORAGE_PATH", "/videos"))
            dir_names = [d.strip() for d in directories.split(",") if d.strip()]
            allowed_prefixes = [str(base / name).rstrip("/") + "/" for name in dir_names]
            subtitle_files = [
                f for f in subtitle_files
                if any(f.path.startswith(prefix) for prefix in allowed_prefixes)
            ]

        total = len(subtitle_files)
        processed = 0
        deleted = 0

        BATCH = 10

        for file_record in subtitle_files:
            should_delete = False
            if file_record.parent_id is not None:
                parent_record = db.query(FileRecord).filter(FileRecord.id == file_record.parent_id).first()
                if parent_record is None or not Path(parent_record.path).exists():
                    should_delete = True
            else:
                srt_path = Path(file_record.path)
                has_video = any(
                    (srt_path.parent / (srt_path.stem + ext)).exists()
                    for ext in _VIDEO_EXTENSIONS
                )
                if not has_video:
                    should_delete = True

            if should_delete:
                if Path(file_record.path).exists():
                    os.remove(file_record.path)
                record_deleted_file(db, file_record, reason="unused_subtitle_cleanup_stream", source="directory_cleanup")
                db.delete(file_record)
                deleted += 1
            processed += 1

            if processed % BATCH == 0 or processed == total:
                pct = int(processed / total * 100) if total else 100
                yield {
                    "event": "progress",
                    "data": json.dumps({
                        "percentage": pct,
                        "current_file": file_record.path,
                        "processed": processed,
                        "total": total,
                        "deleted": deleted,
                    }),
                }
                await asyncio.sleep(0)

        db.commit()

        yield {
            "event": "done",
            "data": json.dumps({
                "percentage": 100,
                "current_file": "",
                "processed": processed,
                "total": total,
                "deleted": deleted,
            }),
        }

    return EventSourceResponse(event_generator())


@router.get("/info/{directory_id}")
async def get_directory_info(directory_id: str, db: Session = Depends(db_session)):
    """Get detailed information about a specific directory by ID"""

    try:
        # Get the directory from database
        directory_crud = Directory(db)
        directories = directory_crud.get_directory_hierarchy(directory_id=directory_id)

        if not directories:
            raise HTTPException(status_code=404, detail="Directory not found")

        directory_record = directories[0]

        # Get files associated with this directory
        file_records = directory_crud.get_directory_files(directory_id=directory_id)

        # Convert file records to File objects
        files = []
        for file_record in file_records:
            files.append(
                FileModel(
                    id=file_record.id,
                    name=file_record.name,
                    path=file_record.path,
                    size=file_record.size,
                    duration=file_record.duration or "00:00:00",
                    format=file_record.format or "",
                    parent_id=file_record.parent_id,
                    width=file_record.width,
                    height=file_record.height,
                    fps=file_record.fps,
                    codec=file_record.codec,
                    bitrate=file_record.bitrate,
                    file_type=file_record.file_type,
                    last_scanned_at=file_record.last_scanned_at.isoformat() if file_record.last_scanned_at else None,
                    child_ids=file_record.child_ids,
                    queue_disabled=file_record.queue_disabled,
                    split_disabled=file_record.split_disabled,
                    subtitle_disabled=file_record.subtitle_disabled,
                    is_deleted=file_record.is_deleted,
                )
            )

        # Create directory entry with files
        directory_info = DirectoryModel(
            id=directory_record.id, name=directory_record.name, path=directory_record.path, files=sorted(files, key=lambda f: f.name.lower()) if files else [], subdirectories=[]
        )

        return directory_info

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving directory info: {str(e)}")
