"""Tests for monitor_scheduler public API."""
import inspect
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.crud.task import create_task
from src.models.models import File as FileModel, Schedule, ScheduleInterval, TaskType
from src.schemas import db_helper as dbh
from src.schemas.db_helper import close_db
from src.schemas.file import FileRecord
from src.schemas.task import TaskRecord
from src.workers.monitor_scheduler import _fill_missing_subtitles, _load_video_candidates, _matches_split_scope, _monitor_task_types, run_monitor


@pytest.mark.parametrize(
    ("filename", "scope", "expected"),
    [
        ("ABC-123.mp4", "both", True),
        ("ABC-123.mp4", "censored", True),
        ("ABC-123.mp4", "uncensored", False),
        ("ABC-123-RM.mp4", "uncensored", True),
        ("ABC-123_UN.mkv", "uncensored", True),
        ("ABC-123 reduced mosaic.mp4", "uncensored", True),
        ("ABC-123-RM.mp4", "censored", False),
    ],
)
def test_matches_split_scope(filename, scope, expected):
    assert _matches_split_scope(filename, scope) is expected


@pytest.mark.parametrize("task_type", [TaskType.ANALYZE_FRAME_PACING, TaskType.NVENC_FRAME_PACING])
def test_load_video_candidates_filters_frame_pacing_to_split_videos(tmp_path, monkeypatch, task_type):
    db_path = tmp_path / "frame-pacing-scope.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    dbh.init_db()

    original = tmp_path / "ABC-123.mp4"
    split = tmp_path / "ABC-123-001.mp4"
    original.write_bytes(b"video")
    split.write_bytes(b"video")

    to_queue, skipped_paths, skip_reasons = _load_video_candidates(
        str(tmp_path),
        task_type,
        frame_pacing_scope="split",
    )

    assert to_queue == [str(split)]
    assert skipped_paths == [str(original)]
    assert skip_reasons == ["not a split video"]


@pytest.mark.parametrize("task_type", [TaskType.ANALYZE_FRAME_PACING, TaskType.NVENC_FRAME_PACING])
def test_load_video_candidates_uses_file_parent_for_frame_pacing_split_scope(tmp_path, monkeypatch, task_type):
    db_path = tmp_path / "frame-pacing-db-split-scope.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    dbh.init_db()

    original = tmp_path / "ABC-123.mp4"
    split = tmp_path / "ABC-123-part-a.mp4"
    original.write_bytes(b"video")
    split.write_bytes(b"video")

    ids_by_name = {
        original.name: "original-file",
        split.name: "split-file",
    }
    db = dbh.SessionLocal()
    try:
        db.add_all(
            [
                FileRecord(
                    id="original-file",
                    name=original.name,
                    path=str(original),
                    size=123,
                    file_type="video",
                    format="mp4",
                    directory_id="dir-1",
                ),
                FileRecord(
                    id="split-file",
                    parent_id="original-file",
                    name=split.name,
                    path=str(split),
                    size=123,
                    file_type="video",
                    format="mp4",
                    directory_id="dir-1",
                ),
            ]
        )
        db.commit()
    finally:
        close_db(db)

    def fake_generate_filename_id(filename, _path):
        return ids_by_name[filename]

    with patch("src.workers.monitor_scheduler.generate_filename_id", side_effect=fake_generate_filename_id):
        to_queue, skipped_paths, skip_reasons = _load_video_candidates(
            str(tmp_path),
            task_type,
            frame_pacing_scope="split",
        )

    assert to_queue == [str(split)]
    assert skipped_paths == [str(original)]
    assert skip_reasons == ["not a split video"]


@pytest.mark.parametrize("task_type", [TaskType.ANALYZE_FRAME_PACING, TaskType.NVENC_FRAME_PACING])
def test_load_video_candidates_skips_completed_frame_pacing_tasks(tmp_path, monkeypatch, task_type):
    db_path = tmp_path / "frame-pacing-completed.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    dbh.init_db()

    video_path = tmp_path / "already-done.mp4"
    video_path.write_bytes(b"video")

    file_id = "already-done-file"
    db = dbh.SessionLocal()
    try:
        db.add(
            FileRecord(
                id=file_id,
                name=video_path.name,
                path=str(video_path),
                size=123,
                file_type="video",
                format="mp4",
                directory_id="dir-1",
            )
        )
        db.add(
            TaskRecord(
                id="completed-frame-pacing-task",
                file_id=file_id,
                type=task_type,
                status="completed",
                created_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
    finally:
        close_db(db)

    with patch("src.workers.monitor_scheduler.generate_filename_id", return_value=file_id):
        to_queue, skipped_paths, skip_reasons = _load_video_candidates(str(tmp_path), task_type)

    assert to_queue == []
    assert skipped_paths == [str(video_path)]
    assert skip_reasons == ["frame pacing already completed"]


@pytest.mark.parametrize("frame_pacing_resolutions", [None, ["4k"]])
def test_load_video_candidates_excludes_4k_frame_pacing_repair(tmp_path, monkeypatch, frame_pacing_resolutions):
    db_path = tmp_path / "frame-pacing-4k.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    dbh.init_db()

    hd_path = tmp_path / "hd.mp4"
    four_k_path = tmp_path / "four-k.mp4"
    hd_path.write_bytes(b"video")
    four_k_path.write_bytes(b"video")

    ids_by_name = {
        hd_path.name: "hd-file",
        four_k_path.name: "four-k-file",
    }
    db = dbh.SessionLocal()
    try:
        db.add_all(
            [
                FileRecord(
                    id="hd-file",
                    name=hd_path.name,
                    path=str(hd_path),
                    size=123,
                    file_type="video",
                    format="mp4",
                    directory_id="dir-1",
                    height=1080,
                ),
                FileRecord(
                    id="four-k-file",
                    name=four_k_path.name,
                    path=str(four_k_path),
                    size=123,
                    file_type="video",
                    format="mp4",
                    directory_id="dir-1",
                    width=4096,
                    height=2048,
                ),
            ]
        )
        db.commit()
    finally:
        close_db(db)

    def fake_generate_filename_id(filename, _path):
        return ids_by_name[filename]

    with patch("src.workers.monitor_scheduler.generate_filename_id", side_effect=fake_generate_filename_id):
        to_queue, skipped_paths, skip_reasons = _load_video_candidates(
            str(tmp_path),
            TaskType.NVENC_FRAME_PACING,
            frame_pacing_resolutions=frame_pacing_resolutions,
        )

    assert to_queue == [str(hd_path)]
    assert skipped_paths == [str(four_k_path)]
    assert skip_reasons == ["4K videos are not eligible for frame pacing repair"]


@pytest.mark.parametrize(
    ("task_type", "expected_completed_type"),
    [
        (TaskType.SCENE, TaskType.SCENE),
        (TaskType.SPLIT, TaskType.SPLIT),
        (TaskType.ALL, TaskType.SPLIT),
    ],
)
def test_load_video_candidates_marks_short_scene_split_videos_completed(tmp_path, monkeypatch, task_type, expected_completed_type):
    db_path = tmp_path / "short-scene-split.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    dbh.init_db()

    video_path = tmp_path / "short.mp4"
    renamed_path = tmp_path / "short-001.mp4"
    video_path.write_bytes(b"video")

    file_id = "short-file-id"
    db = dbh.SessionLocal()
    try:
        db.add(
            FileRecord(
                id=file_id,
                name=video_path.name,
                path=str(video_path),
                size=123,
                file_type="video",
                format="mp4",
                directory_id="dir-1",
                duration="01:00:00",
                status="unprocessed",
            )
        )
        db.commit()
    finally:
        close_db(db)

    with patch("src.workers.monitor_scheduler.generate_filename_id", return_value=file_id):
        to_queue, skipped_paths, skip_reasons = _load_video_candidates(str(tmp_path), task_type)

    assert to_queue == []
    assert skipped_paths == [str(video_path)]
    assert skip_reasons == ["short video marked completed and renamed with -001 suffix"]
    assert not video_path.exists()
    assert renamed_path.exists()

    db = dbh.SessionLocal()
    try:
        file_record = db.query(FileRecord).filter(FileRecord.id == file_id).one()
        task_record = db.query(TaskRecord).filter(TaskRecord.file_id == file_id).one()
        assert file_record.name == renamed_path.name
        assert file_record.path == str(renamed_path)
        assert file_record.status == "done"
        assert task_record.type == expected_completed_type
        assert task_record.status == "completed"
        assert task_record.completed_at is not None
        if expected_completed_type == TaskType.SPLIT:
            assert task_record.split_count == 1
        else:
            assert task_record.scene_count == 1
    finally:
        close_db(db)


def test_load_video_candidates_queues_scene_split_videos_over_short_limit(tmp_path, monkeypatch):
    db_path = tmp_path / "long-scene-split.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    dbh.init_db()

    video_path = tmp_path / "long.mp4"
    video_path.write_bytes(b"video")

    file_id = "long-file-id"
    db = dbh.SessionLocal()
    try:
        db.add(
            FileRecord(
                id=file_id,
                name=video_path.name,
                path=str(video_path),
                size=123,
                file_type="video",
                format="mp4",
                directory_id="dir-1",
                duration="01:00:01",
                status="unprocessed",
            )
        )
        db.commit()
    finally:
        close_db(db)

    with patch("src.workers.monitor_scheduler.generate_filename_id", return_value=file_id):
        to_queue, skipped_paths, skip_reasons = _load_video_candidates(str(tmp_path), TaskType.SPLIT)

    assert to_queue == [str(video_path)]
    assert skipped_paths == []
    assert skip_reasons == []
    assert video_path.exists()
    assert not (tmp_path / "long-001.mp4").exists()


def test_run_monitor_is_public_and_callable():
    """run_monitor must be importable as a public name (no underscore prefix)."""
    from src.workers.monitor_scheduler import run_monitor

    assert callable(run_monitor), "run_monitor must be callable"
    assert inspect.iscoroutinefunction(run_monitor), "run_monitor must be async"


def test_run_monitor_not_private():
    """_run_monitor private name should not exist after refactor."""
    import src.workers.monitor_scheduler as mod

    assert not hasattr(mod, "_run_monitor"), "_run_monitor should be removed; use run_monitor instead"


def test_monitor_task_types_use_required_execution_order():
    monitor = MagicMock()
    monitor.taskType = TaskType.REMUX
    monitor.taskTypes = [
        TaskType.NVENC_FRAME_PACING,
        TaskType.REMUX,
        TaskType.SUBTITLE,
        TaskType.SPLIT,
    ]

    assert _monitor_task_types(monitor) == [
        TaskType.SPLIT,
        TaskType.SUBTITLE,
        TaskType.REMUX,
        TaskType.NVENC_FRAME_PACING,
    ]


@pytest.mark.asyncio
async def test_run_monitor_returns_queued_skipped_counts():
    """run_monitor should return (queued, skipped) tuple."""
    schedule = Schedule(interval=ScheduleInterval.DAILY, time="00:00")

    monitor = MagicMock()
    monitor.id = "monitor-1"
    monitor.directoryId = "dir-1"
    monitor.directoryName = "TestDir"
    monitor.directoryPath = "/fake/path"
    monitor.taskType = "scene"
    monitor.subtitleLanguage = None
    monitor.deleteVideoAfterCompletion = False
    monitor.fillMissingSubtitles = False
    monitor.isActive = True
    monitor.createdAt = "2026-05-19T00:00:00Z"
    monitor.schedule = schedule

    task_manager = MagicMock()
    task_manager.add_task = AsyncMock(return_value=(True, None))

    loop = MagicMock()
    # First run_in_executor call is _load_video_candidates (returns the scan tuple).
    # Second call is update_directory_monitor.
    loop.run_in_executor = AsyncMock(side_effect=[
        (["/fake/path/video.mp4"], [], []),
        None,
    ])

    fake_file = FileModel(id="file-1", name="video.mp4", path="/fake/path/video.mp4", size=1, format="mp4")

    with patch("src.workers.monitor_scheduler._ensure_file_record", return_value=fake_file), \
         patch("src.workers.monitor_scheduler._is_monitor_task_disabled", return_value=None), \
         patch("src.workers.monitor_scheduler._mark_short_scene_split_completed", return_value=None), \
         patch("src.workers.monitor_scheduler.update_directory_monitor"), \
         patch("src.workers.monitor_scheduler.calculate_next_run",
               return_value=datetime.now(timezone.utc)):
        result = await run_monitor(task_manager, monitor, loop)

    assert isinstance(result, tuple), "run_monitor should return a tuple"
    assert len(result) == 2, "run_monitor should return (queued, skipped)"
    queued, skipped = result
    assert isinstance(queued, int), "queued should be an int"
    assert isinstance(skipped, int), "skipped should be an int"
    assert queued == 1, "should have queued 1 task"
    assert skipped == 0, "should have skipped 0 files"


@pytest.mark.asyncio
async def test_run_monitor_seeds_file_metadata_before_queueing(tmp_path, monkeypatch):
    """run_monitor should create a file row before inserting the task row."""
    db_path = tmp_path / "monitor.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    dbh.init_db()

    video_path = tmp_path / "ZMAR-163.mp4"
    video_path.write_bytes(b"video-bytes")

    schedule = Schedule(interval=ScheduleInterval.DAILY, time="00:00")
    monitor = MagicMock()
    monitor.id = "monitor-1"
    monitor.directoryId = "dir-1"
    monitor.directoryName = "Aika"
    monitor.directoryPath = str(tmp_path)
    monitor.taskType = TaskType.SCENE
    monitor.subtitleLanguage = None
    monitor.deleteVideoAfterCompletion = False
    monitor.fillMissingSubtitles = False
    monitor.isActive = True
    monitor.createdAt = "2026-05-19T00:00:00Z"
    monitor.schedule = schedule

    queued_task_ids: list[str] = []

    async def fake_add_task(task):
        db = dbh.SessionLocal()
        try:
            assert db.query(FileRecord).filter(FileRecord.id == task.file.id).first() is not None
        finally:
            close_db(db)
        saved_task = create_task(task)
        queued_task_ids.append(saved_task.id)
        return saved_task.id == task.id, None

    task_manager = MagicMock()
    task_manager.add_task = AsyncMock(side_effect=fake_add_task)

    loop = MagicMock()
    loop.run_in_executor = AsyncMock(side_effect=[
        ([str(video_path)], [], []),
        None,
    ])

    with patch("src.workers.monitor_scheduler.update_directory_monitor"), \
         patch("src.workers.monitor_scheduler.calculate_next_run",
               return_value=datetime.now(timezone.utc)):
        queued, skipped = await run_monitor(task_manager, monitor, loop)

    assert queued == 1
    assert skipped == 0

    db = dbh.SessionLocal()
    try:
        assert db.query(FileRecord).filter(FileRecord.path == str(video_path)).count() == 1
        assert db.query(TaskRecord).filter(TaskRecord.id == queued_task_ids[0]).count() == 1
        assert db.query(TaskRecord).filter(TaskRecord.file_id == db.query(FileRecord.id).filter(FileRecord.path == str(video_path)).scalar()).count() == 1
    finally:
        close_db(db)


@pytest.mark.asyncio
async def test_run_monitor_marks_new_short_scene_video_completed_before_queueing(tmp_path, monkeypatch):
    db_path = tmp_path / "monitor-short.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    dbh.init_db()

    video_path = tmp_path / "new-short.mp4"
    renamed_path = tmp_path / "new-short-001.mp4"
    video_path.write_bytes(b"video-bytes")

    schedule = Schedule(interval=ScheduleInterval.DAILY, time="00:00")
    monitor = MagicMock()
    monitor.id = "monitor-1"
    monitor.directoryId = "dir-1"
    monitor.directoryName = "Shorts"
    monitor.directoryPath = str(tmp_path)
    monitor.taskType = TaskType.SCENE
    monitor.taskTypes = [TaskType.SCENE]
    monitor.subtitleLanguage = None
    monitor.deleteVideoAfterCompletion = False
    monitor.fillMissingSubtitles = False
    monitor.isActive = True
    monitor.createdAt = "2026-05-19T00:00:00Z"
    monitor.schedule = schedule

    task_manager = MagicMock()
    task_manager.add_task = AsyncMock(return_value=(True, None))

    loop = MagicMock()
    loop.run_in_executor = AsyncMock(side_effect=[
        ([str(video_path)], [], []),
        None,
    ])

    with patch("src.workers.monitor_scheduler.get_video_duration", return_value="00:59:59"), \
         patch("src.workers.monitor_scheduler.update_directory_monitor"), \
         patch("src.workers.monitor_scheduler.calculate_next_run",
               return_value=datetime.now(timezone.utc)):
        queued, skipped = await run_monitor(task_manager, monitor, loop)

    assert queued == 0
    assert skipped == 1
    task_manager.add_task.assert_not_called()
    assert not video_path.exists()
    assert renamed_path.exists()

    db = dbh.SessionLocal()
    try:
        file_record = db.query(FileRecord).filter(FileRecord.path == str(renamed_path)).one()
        task_record = db.query(TaskRecord).filter(TaskRecord.file_id == file_record.id).one()
        assert file_record.name == renamed_path.name
        assert file_record.duration == "00:59:59"
        assert file_record.status == "done"
        assert task_record.type == TaskType.SCENE
        assert task_record.status == "completed"
        assert task_record.scene_count == 1
    finally:
        close_db(db)


@pytest.mark.asyncio
async def test_run_monitor_applies_nvenc_overwrite_original_to_frame_pacing_tasks():
    schedule = Schedule(interval=ScheduleInterval.DAILY, time="00:00")

    monitor = MagicMock()
    monitor.id = "monitor-1"
    monitor.directoryId = "dir-1"
    monitor.directoryName = "FramePacing"
    monitor.directoryPath = "/fake/path"
    monitor.taskType = TaskType.NVENC_FRAME_PACING
    monitor.taskTypes = [TaskType.NVENC_FRAME_PACING]
    monitor.subtitleLanguage = None
    monitor.deleteVideoAfterCompletion = False
    monitor.fillMissingSubtitles = False
    monitor.nvencOverwriteOriginal = True
    monitor.isActive = True
    monitor.createdAt = "2026-05-19T00:00:00Z"
    monitor.schedule = schedule

    captured_tasks = []

    async def fake_add_task(task):
        captured_tasks.append(task)
        return True, None

    task_manager = MagicMock()
    task_manager.add_task = AsyncMock(side_effect=fake_add_task)

    loop = MagicMock()
    loop.run_in_executor = AsyncMock(side_effect=[
        (["/fake/path/video.mp4"], [], []),
        None,
    ])

    fake_file = FileModel(id="file-1", name="video.mp4", path="/fake/path/video.mp4", size=1, format="mp4")

    with patch("src.workers.monitor_scheduler._ensure_file_record", return_value=fake_file), \
         patch("src.workers.monitor_scheduler._is_monitor_task_disabled", return_value=None), \
         patch("src.workers.monitor_scheduler._mark_short_scene_split_completed", return_value=None), \
         patch("src.workers.monitor_scheduler.update_directory_monitor"), \
         patch("src.workers.monitor_scheduler.calculate_next_run",
               return_value=datetime.now(timezone.utc)):
        queued, skipped = await run_monitor(task_manager, monitor, loop)

    assert queued == 1
    assert skipped == 0
    assert captured_tasks[0].nvenc_overwrite_original is True


@pytest.mark.asyncio
async def test_run_monitor_queues_multiple_task_types_in_required_order():
    schedule = Schedule(interval=ScheduleInterval.DAILY, time="00:00")

    monitor = MagicMock()
    monitor.id = "monitor-1"
    monitor.directoryId = "dir-1"
    monitor.directoryName = "Ordered"
    monitor.directoryPath = "/fake/path"
    monitor.taskType = TaskType.NVENC_FRAME_PACING
    monitor.taskTypes = [
        TaskType.NVENC_FRAME_PACING,
        TaskType.REMUX,
        TaskType.SUBTITLE,
        TaskType.SPLIT,
    ]
    monitor.subtitleLanguage = "en"
    monitor.deleteVideoAfterCompletion = False
    monitor.fillMissingSubtitles = False
    monitor.nvencOverwriteOriginal = False
    monitor.isActive = True
    monitor.createdAt = "2026-05-19T00:00:00Z"
    monitor.schedule = schedule

    captured_types: list[TaskType] = []

    async def fake_add_task(task):
        captured_types.append(task.type)
        return True, None

    task_manager = MagicMock()
    task_manager.add_task = AsyncMock(side_effect=fake_add_task)

    loop = MagicMock()
    loop.run_in_executor = AsyncMock(side_effect=[
        (["/fake/path/video.mp4"], [], []),
        (["/fake/path/video.mp4"], [], []),
        (["/fake/path/video.mp4"], [], []),
        (["/fake/path/video.mp4"], [], []),
        None,
    ])

    fake_file = FileModel(id="file-1", name="video.mp4", path="/fake/path/video.mp4", size=1, format="mp4")

    with patch("src.workers.monitor_scheduler._ensure_file_record", return_value=fake_file), \
         patch("src.workers.monitor_scheduler._is_monitor_task_disabled", return_value=None), \
         patch("src.workers.monitor_scheduler._mark_short_scene_split_completed", return_value=None), \
         patch("src.workers.monitor_scheduler.update_directory_monitor"), \
         patch("src.workers.monitor_scheduler.calculate_next_run",
               return_value=datetime.now(timezone.utc)):
        queued, skipped = await run_monitor(task_manager, monitor, loop)

    assert queued == 4
    assert skipped == 0
    assert captured_types == [
        TaskType.SPLIT,
        TaskType.SUBTITLE,
        TaskType.REMUX,
        TaskType.NVENC_FRAME_PACING,
    ]


@pytest.mark.asyncio
async def test_run_monitor_skips_split_disabled_after_resolving_file_record(tmp_path, monkeypatch):
    """A monitor must honor split_disabled on the actual DB file row it resolves."""
    db_path = tmp_path / "monitor-disabled.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    dbh.init_db()

    video_path = tmp_path / "disabled.mp4"
    video_path.write_bytes(b"video-bytes")

    db = dbh.SessionLocal()
    try:
        db.add(
            FileRecord(
                id="existing-file-id",
                name=video_path.name,
                path=str(video_path),
                size=123,
                file_type="video",
                format="mp4",
                directory_id="dir-1",
                split_disabled=True,
            )
        )
        db.commit()
    finally:
        close_db(db)

    schedule = Schedule(interval=ScheduleInterval.DAILY, time="00:00")
    monitor = MagicMock()
    monitor.id = "monitor-1"
    monitor.directoryId = "dir-1"
    monitor.directoryName = "Aika"
    monitor.directoryPath = str(tmp_path)
    monitor.taskType = TaskType.ALL
    monitor.subtitleLanguage = "en"
    monitor.deleteVideoAfterCompletion = False
    monitor.fillMissingSubtitles = False
    monitor.isActive = True
    monitor.createdAt = "2026-05-19T00:00:00Z"
    monitor.schedule = schedule

    task_manager = MagicMock()
    task_manager.add_task = AsyncMock(return_value=(True, None))

    loop = MagicMock()
    loop.run_in_executor = AsyncMock(side_effect=[
        ([str(video_path)], [], []),
        None,
    ])

    with patch("src.workers.monitor_scheduler.update_directory_monitor"), \
         patch("src.workers.monitor_scheduler.calculate_next_run",
               return_value=datetime.now(timezone.utc)):
        queued, skipped = await run_monitor(task_manager, monitor, loop)

    assert queued == 0
    assert skipped == 1
    task_manager.add_task.assert_not_called()


@pytest.mark.asyncio
async def test_fill_missing_subtitles_skips_split_disabled_records(tmp_path, monkeypatch):
    """Directory monitors should not queue fill-missing work for split-disabled videos."""
    db_path = tmp_path / "fill-missing-disabled.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    dbh.init_db()

    video_path = tmp_path / "disabled-001.mp4"
    video_path.write_bytes(b"video-bytes")

    db = dbh.SessionLocal()
    try:
        db.add(
            FileRecord(
                id="split-file-id",
                name=video_path.name,
                path=str(video_path),
                size=123,
                file_type="video",
                format="mp4",
                directory_id="dir-1",
                parent_id="parent-file-id",
                split_disabled=True,
            )
        )
        db.commit()
    finally:
        close_db(db)

    monitor = MagicMock()
    monitor.directoryId = "dir-1"
    monitor.directoryName = "Aika"
    monitor.subtitleLanguage = "en"

    task_manager = MagicMock()
    task_manager.add_task = AsyncMock(return_value=(True, None))

    queued, skipped = await _fill_missing_subtitles(task_manager, monitor)

    assert queued == 0
    assert skipped == 0
    task_manager.add_task.assert_not_called()
