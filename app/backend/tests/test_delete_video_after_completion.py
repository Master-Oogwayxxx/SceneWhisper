"""Test that delete_video_after_completion removes the file but preserves the task."""
import pytest
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base
from src.crud.file import File as FileCRUD
from src.crud.task import get_task, update_task
from src.models.models import Task, TaskStatus, TaskType, ProcessingStage
from src.schemas.directory import DirectoryRecord
from src.schemas.deleted_file import DeletedFileRecord
from src.schemas.task import TaskRecord


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    yield


@pytest.fixture()
def test_setup(tmp_path, isolated_db):
    """Create a test directory, file, and task."""
    from src.schemas.db_helper import SessionLocal

    # Create a fake video file
    video_file = tmp_path / "test_video.mp4"
    video_file.write_bytes(b"fake video content")

    # Create directory and file records
    db = SessionLocal()
    try:
        dir_record = DirectoryRecord(id="test-dir-1", name="testdir", path=str(tmp_path))
        db.add(dir_record)
        db.flush()

        file_crud = FileCRUD(db)
        file_record = file_crud.create_file_metadata(
            name="test_video.mp4",
            path=str(video_file),
            size=video_file.stat().st_size,
            file_type="video",
            format=".mp4",
            directory_id=dir_record.id,
        )
        db.commit()
        db.refresh(file_record)
        file_id = file_record.id

        # Create a task for this file with delete_video_after_completion=True
        task_record = TaskRecord(
            id="test-task-1",
            file_id=file_id,
            type=TaskType.SPLIT,
            status=TaskStatus.PROCESSING,
            current_stage=ProcessingStage.VIDEO_SPLITTING,
            delete_video_after_completion=True,
        )
        db.add(task_record)
        db.commit()

        db.close()
        return {
            "file_id": file_id,
            "task_id": "test-task-1",
            "video_path": str(video_file),
        }
    except Exception:
        db.close()
        raise


def test_delete_video_preserves_completed_task(test_setup):
    """When delete_video_after_completion is true and task completes, file is deleted but task remains."""
    from src.schemas.db_helper import SessionLocal

    file_id = test_setup["file_id"]
    task_id = test_setup["task_id"]
    video_path = test_setup["video_path"]

    # Verify file and task exist before deletion
    db = SessionLocal()
    try:
        file_crud = FileCRUD(db)
        file_record = file_crud.get_file_metadata(file_id=file_id)
        assert file_record is not None, "File should exist before task completion"

        task_record = db.query(TaskRecord).filter(TaskRecord.id == task_id).first()
        assert task_record is not None, "Task should exist before completion"
        assert Path(video_path).exists(), "Video file should exist on disk"

        db.close()
    except Exception:
        db.close()
        raise

    # Simulate task completion with delete_video_after_completion
    # Step 1: Mark task as completed and remove from memory
    db = SessionLocal()
    try:
        task_record = db.query(TaskRecord).filter(TaskRecord.id == task_id).first()
        task_record.status = TaskStatus.COMPLETED
        db.commit()

        # Get task as a Task model
        task = get_task(task_id)
        assert task is not None

        # Step 2: Delete video file from disk
        Path(video_path).unlink(missing_ok=True)
        assert not Path(video_path).exists(), "Video file should be deleted from disk"

        # Step 3: Nullify file_id and delete file record (simulating _delete_source_file)
        task_record = db.query(TaskRecord).filter(TaskRecord.id == task_id).first()
        if task_record:
            task_record.file_id = None
            db.commit()

        # Now delete the file record
        file_crud = FileCRUD(db)
        file_crud.delete_by_id(file_id)

        db.close()
    except Exception:
        db.close()
        raise

    # Verify file is deleted but task still exists with COMPLETED status
    db = SessionLocal()
    try:
        file_crud = FileCRUD(db)
        file_record = file_crud.get_file_metadata(file_id=file_id)
        assert file_record is None, "File record should be deleted from DB"

        task_record = db.query(TaskRecord).filter(TaskRecord.id == task_id).first()
        assert task_record is not None, "Task should still exist in DB after file deletion"
        assert task_record.status == TaskStatus.COMPLETED, "Task should still be COMPLETED"
        assert task_record.file_id is None, "Task's file_id should be null"

        deleted_record = db.query(DeletedFileRecord).filter(DeletedFileRecord.file_record_id == file_id).first()
        assert deleted_record is not None, "Deleted file should be recorded"
        assert deleted_record.path == video_path
        assert deleted_record.name == "test_video.mp4"
        assert deleted_record.reason == "missing_on_delete_by_id"
        assert deleted_record.source == "file_crud"

        db.close()
    except Exception:
        db.close()
        raise
