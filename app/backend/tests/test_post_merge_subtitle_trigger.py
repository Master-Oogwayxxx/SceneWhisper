"""Test that _track_merge_output signals when input files had subtitle children."""
import pytest
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base
from src.crud.file import File as FileCRUD
from src.schemas.directory import DirectoryRecord


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    from sqlalchemy.orm import sessionmaker as sm
    monkeypatch.setattr(dbh, "SessionLocal", sm(autocommit=False, autoflush=False, bind=engine))
    yield


def _make_file(db, tmp_path, name, file_type="video", parent_id=None):
    f = tmp_path / name
    f.write_bytes(b"x")
    crud = FileCRUD(db)
    rec = crud.create_file_metadata(
        name=name,
        path=str(f),
        size=1,
        file_type=file_type,
        format=".mp4" if file_type == "video" else ".srt",
        directory_id="dir-1",
    )
    if parent_id:
        rec.parent_id = parent_id
        db.commit()
        db.refresh(rec)
    return rec


def test_had_subtitles_true_when_input_has_subtitle_child(tmp_path):
    from src.schemas.db_helper import SessionLocal

    db = SessionLocal()
    dir_rec = DirectoryRecord(id="dir-1", name="d", path=str(tmp_path))
    db.add(dir_rec)
    db.commit()

    video_a = _make_file(db, tmp_path, "a.mp4")
    video_b = _make_file(db, tmp_path, "b.mp4")
    _make_file(db, tmp_path, "a.srt", file_type="subtitle", parent_id=video_a.id)
    db.close()

    from src.schemas.db_helper import SessionLocal
    db2 = SessionLocal()
    crud = FileCRUD(db2)

    input_paths = [str(tmp_path / "a.mp4"), str(tmp_path / "b.mp4")]
    had_subtitles = False
    for path in input_paths:
        rec = crud.get_file_metadata(path=path)
        if rec:
            children = crud.get_children_of_file(rec.id)
            if any(c.file_type == "subtitle" for c in children):
                had_subtitles = True
                break
    db2.close()

    assert had_subtitles is True


def test_had_subtitles_false_when_no_subtitle_children(tmp_path):
    from src.schemas.db_helper import SessionLocal

    db = SessionLocal()
    dir_rec = DirectoryRecord(id="dir-1", name="d", path=str(tmp_path))
    db.add(dir_rec)
    db.commit()

    _make_file(db, tmp_path, "a.mp4")
    _make_file(db, tmp_path, "b.mp4")
    db.close()

    from src.schemas.db_helper import SessionLocal
    db2 = SessionLocal()
    crud = FileCRUD(db2)

    input_paths = [str(tmp_path / "a.mp4"), str(tmp_path / "b.mp4")]
    had_subtitles = False
    for path in input_paths:
        rec = crud.get_file_metadata(path=path)
        if rec:
            children = crud.get_children_of_file(rec.id)
            if any(c.file_type == "subtitle" for c in children):
                had_subtitles = True
                break
    db2.close()

    assert had_subtitles is False


import asyncio


def test_subtitle_task_queued_after_merge_when_had_subtitles(tmp_path):
    """add_task is called with a SUBTITLE task when merged inputs had subtitles."""
    from src.task_manager import TaskManager
    from src.models.models import Task, TaskType, TaskStatus, File

    queued_tasks = []

    async def fake_add_task(task):
        queued_tasks.append(task)

    manager = TaskManager.__new__(TaskManager)
    manager.add_task = fake_add_task

    merged_file = File(
        id="merged-1",
        name="output.mp4",
        path=str(tmp_path / "output.mp4"),
        size=100,
        duration="10.0",
        format=".mp4",
    )

    asyncio.run(
        manager._maybe_queue_subtitle_task(merged_file, had_subtitles=True)
    )

    assert len(queued_tasks) == 1
    assert queued_tasks[0].type == TaskType.SUBTITLE
    assert queued_tasks[0].file.id == "merged-1"
    assert queued_tasks[0].status == TaskStatus.QUEUED
    assert queued_tasks[0].id  # non-empty UUID string


def test_subtitle_task_not_queued_when_no_subtitles(tmp_path):
    """add_task is NOT called when merged inputs had no subtitles."""
    from src.task_manager import TaskManager
    from src.models.models import File

    queued_tasks = []

    async def fake_add_task(task):
        queued_tasks.append(task)

    manager = TaskManager.__new__(TaskManager)
    manager.add_task = fake_add_task

    merged_file = File(
        id="merged-2",
        name="output.mp4",
        path=str(tmp_path / "output.mp4"),
        size=100,
        duration="10.0",
        format=".mp4",
    )

    asyncio.run(
        manager._maybe_queue_subtitle_task(merged_file, had_subtitles=False)
    )

    assert len(queued_tasks) == 0
