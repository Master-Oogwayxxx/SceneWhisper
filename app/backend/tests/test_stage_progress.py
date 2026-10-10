from unittest.mock import MagicMock, patch

import pytest

from src.models.models import ProcessingStage, Task, TaskStatus, TaskType


def _make_task() -> Task:
    """Minimal Task object for testing."""
    from src.models.models import File
    f = File(id="f1", name="v.mp4", path="/v.mp4", size=1, duration="00:01:00", format=".mp4")
    return Task(
        id="t1",
        file=f,
        type=TaskType.ALL,
        status=TaskStatus.PROCESSING,
        createdAt="2026-01-01T00:00:00",
    )


class TestUpdateTaskProgressRouting:
    @pytest.mark.asyncio
    async def test_scene_stage_updates_scene_progress(self):
        from src.task_manager import TaskManager
        tm = TaskManager()
        task = _make_task()
        tm.tasks_db["t1"] = task

        with patch("src.task_manager.update_task"):
            await tm.update_task_progress("t1", 42.0, ProcessingStage.SCENE_DETECTION)

        assert task.scene_progress == 42.0
        assert task.split_progress == 0.0
        assert task.subtitle_progress == 0.0

    @pytest.mark.asyncio
    async def test_split_stage_updates_split_progress(self):
        from src.task_manager import TaskManager
        tm = TaskManager()
        task = _make_task()
        tm.tasks_db["t1"] = task

        with patch("src.task_manager.update_task"):
            await tm.update_task_progress("t1", 75.0, ProcessingStage.VIDEO_SPLITTING)

        assert task.split_progress == 75.0
        assert task.scene_progress == 0.0
        assert task.subtitle_progress == 0.0

    @pytest.mark.asyncio
    async def test_subtitle_stage_updates_subtitle_progress(self):
        from src.task_manager import TaskManager
        tm = TaskManager()
        task = _make_task()
        tm.tasks_db["t1"] = task

        with patch("src.task_manager.update_task"):
            await tm.update_task_progress("t1", 60.0, ProcessingStage.SUBTITLE_GENERATION)

        assert task.subtitle_progress == 60.0
        assert task.scene_progress == 0.0
        assert task.split_progress == 0.0

    @pytest.mark.asyncio
    async def test_small_progress_updates_are_persisted_at_most_once_per_interval(self):
        from src.task_manager import TaskManager
        tm = TaskManager()
        task = _make_task()
        tm.tasks_db["t1"] = task

        with patch("src.task_manager.update_task") as update_task:
            await tm.update_task_progress("t1", 10.0, ProcessingStage.SCENE_DETECTION)
            await tm.update_task_progress("t1", 10.2, ProcessingStage.SCENE_DETECTION)
            await tm.update_task_progress("t1", 10.4, ProcessingStage.SCENE_DETECTION)

        assert task.scene_progress == 10.4
        assert update_task.call_count == 1

    @pytest.mark.asyncio
    async def test_stage_change_and_completion_always_persist(self):
        from src.task_manager import TaskManager
        tm = TaskManager()
        task = _make_task()
        tm.tasks_db["t1"] = task

        with patch("src.task_manager.update_task") as update_task:
            await tm.update_task_progress("t1", 10.0, ProcessingStage.SCENE_DETECTION)
            await tm.update_task_progress("t1", 10.1, ProcessingStage.VIDEO_SPLITTING)
            await tm.update_task_progress("t1", 100.0, ProcessingStage.VIDEO_SPLITTING)

        assert update_task.call_count == 3


class TestRecordToTask:
    def test_maps_stage_progress_fields(self):
        from src.crud.task import record_to_task
        from src.schemas.task import TaskRecord
        from src.models.models import TaskStatus, TaskType

        record = MagicMock(spec=TaskRecord)
        record.id = "t1"
        record.file_id = "f1"
        record.type = TaskType.ALL
        record.status = TaskStatus.PROCESSING
        record.current_stage = None
        record.scene_progress = 50.0
        record.split_progress = 25.0
        record.subtitle_progress = 0.0
        record.merge_progress = 0.0
        record.subtitle_language = None
        record.scheduled_for = None
        record.scene_detector = None
        record.created_at = MagicMock()
        record.created_at.isoformat.return_value = "2026-01-01T00:00:00"
        record.started_at = None
        record.stage_started_at = None
        record.completed_at = None
        record.paused_at = None
        record.progress = 0.0
        record.elapsed_seconds = None
        record.scene_elapsed_seconds = None
        record.split_elapsed_seconds = None
        record.subtitle_elapsed_seconds = None
        record.error = None
        record.scene_count = 0
        record.split_count = 0
        record.delete_video_after_completion = False
        record.overwrite_scenes = False
        record.overwrite_split = False
        record.overwrite_subtitles = False
        record.merge_input_paths = None

        with patch("src.crud.task.get_db"), patch("src.crud.task.close_db"), \
             patch("src.crud.task.FileRecord") as MockFileRecord:
            MockFileRecord.__class__ = MagicMock
            # Patch query chain to return a mock file record
            mock_db = MagicMock()
            mock_file_record = MagicMock()
            mock_file_record.id = "f1"
            mock_file_record.name = "v.mp4"
            mock_file_record.path = "/v.mp4"
            mock_file_record.size = 1
            mock_file_record.duration = "00:01:00"
            mock_file_record.format = ".mp4"
            mock_file_record.parent_id = None
            mock_file_record.width = None
            mock_file_record.height = None
            mock_file_record.fps = None
            mock_file_record.codec = None
            mock_file_record.bitrate = None
            mock_file_record.file_type = None
            mock_file_record.last_scanned_at = None
            mock_db.query.return_value.filter.return_value.first.return_value = mock_file_record

            with patch("src.crud.task.get_db", return_value=mock_db):
                task = record_to_task(record)

        assert task.scene_progress == 50.0
        assert task.split_progress == 25.0
        assert task.subtitle_progress == 0.0


class TestRecordToTaskElapsedSeconds:
    def test_maps_stage_elapsed_fields(self):
        from src.crud.task import record_to_task
        from src.schemas.task import TaskRecord
        from src.models.models import TaskStatus, TaskType

        record = MagicMock(spec=TaskRecord)
        record.id = "t1"
        record.file_id = "f1"
        record.type = TaskType.ALL
        record.status = TaskStatus.COMPLETED
        record.current_stage = None
        record.scene_progress = 100.0
        record.split_progress = 100.0
        record.subtitle_progress = 100.0
        record.merge_progress = 0.0
        record.subtitle_language = None
        record.scheduled_for = None
        record.scene_detector = None
        record.created_at = MagicMock()
        record.created_at.isoformat.return_value = "2026-01-01T00:00:00"
        record.started_at = None
        record.stage_started_at = None
        record.completed_at = None
        record.paused_at = None
        record.progress = 0.0
        record.elapsed_seconds = 120
        record.scene_elapsed_seconds = 30
        record.split_elapsed_seconds = 60
        record.subtitle_elapsed_seconds = 20
        record.error = None
        record.scene_count = 5
        record.split_count = 5
        record.delete_video_after_completion = False
        record.overwrite_scenes = False
        record.overwrite_split = False
        record.overwrite_subtitles = False
        record.merge_input_paths = None

        mock_db = MagicMock()
        mock_file_record = MagicMock()
        mock_file_record.id = "f1"
        mock_file_record.name = "v.mp4"
        mock_file_record.path = "/v.mp4"
        mock_file_record.size = 1
        mock_file_record.duration = "00:01:00"
        mock_file_record.format = ".mp4"
        mock_file_record.parent_id = None
        mock_file_record.width = None
        mock_file_record.height = None
        mock_file_record.fps = None
        mock_file_record.codec = None
        mock_file_record.bitrate = None
        mock_file_record.file_type = None
        mock_file_record.last_scanned_at = None
        mock_db.query.return_value.filter.return_value.first.return_value = mock_file_record

        with patch("src.crud.task.get_db", return_value=mock_db):
            task = record_to_task(record)

        assert task.scene_elapsed_seconds == 30
        assert task.split_elapsed_seconds == 60
        assert task.subtitle_elapsed_seconds == 20

    def test_maps_null_stage_elapsed_fields(self):
        from src.crud.task import record_to_task
        from src.schemas.task import TaskRecord
        from src.models.models import TaskStatus, TaskType

        record = MagicMock(spec=TaskRecord)
        record.id = "t1"
        record.file_id = "f1"
        record.type = TaskType.ALL
        record.status = TaskStatus.PROCESSING
        record.current_stage = None
        record.scene_progress = 0.0
        record.split_progress = 0.0
        record.subtitle_progress = 0.0
        record.merge_progress = 0.0
        record.subtitle_language = None
        record.scheduled_for = None
        record.scene_detector = None
        record.created_at = MagicMock()
        record.created_at.isoformat.return_value = "2026-01-01T00:00:00"
        record.started_at = None
        record.stage_started_at = None
        record.completed_at = None
        record.paused_at = None
        record.progress = 0.0
        record.elapsed_seconds = None
        record.scene_elapsed_seconds = None
        record.split_elapsed_seconds = None
        record.subtitle_elapsed_seconds = None
        record.error = None
        record.scene_count = 0
        record.split_count = 0
        record.delete_video_after_completion = False
        record.overwrite_scenes = False
        record.overwrite_split = False
        record.overwrite_subtitles = False
        record.merge_input_paths = None

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None

        with patch("src.crud.task.get_db", return_value=mock_db):
            task = record_to_task(record)

        assert task.scene_elapsed_seconds is None
        assert task.split_elapsed_seconds is None
        assert task.subtitle_elapsed_seconds is None


class TestStageElapsedInUpdateTaskProgress:
    @pytest.mark.asyncio
    async def test_scene_elapsed_set_when_stage_reaches_100(self):
        from datetime import datetime, timedelta
        from src.task_manager import TaskManager
        tm = TaskManager()
        task = _make_task()
        task.stageStartedAt = (datetime.utcnow() - timedelta(seconds=5)).isoformat()
        tm.tasks_db["t1"] = task

        with patch("src.task_manager.update_task"):
            await tm.update_task_progress("t1", 100.0, ProcessingStage.SCENE_DETECTION)

        assert task.scene_elapsed_seconds is not None
        assert task.scene_elapsed_seconds >= 5
        assert task.split_elapsed_seconds is None
        assert task.subtitle_elapsed_seconds is None

    @pytest.mark.asyncio
    async def test_split_elapsed_set_when_stage_reaches_100(self):
        from datetime import datetime, timedelta
        from src.task_manager import TaskManager
        tm = TaskManager()
        task = _make_task()
        task.stageStartedAt = (datetime.utcnow() - timedelta(seconds=5)).isoformat()
        tm.tasks_db["t1"] = task

        with patch("src.task_manager.update_task"):
            await tm.update_task_progress("t1", 100.0, ProcessingStage.VIDEO_SPLITTING)

        assert task.split_elapsed_seconds is not None
        assert task.split_elapsed_seconds >= 5
        assert task.scene_elapsed_seconds is None
        assert task.subtitle_elapsed_seconds is None

    @pytest.mark.asyncio
    async def test_subtitle_elapsed_set_when_stage_reaches_100(self):
        from datetime import datetime, timedelta
        from src.task_manager import TaskManager
        tm = TaskManager()
        task = _make_task()
        task.stageStartedAt = (datetime.utcnow() - timedelta(seconds=5)).isoformat()
        tm.tasks_db["t1"] = task

        with patch("src.task_manager.update_task"):
            await tm.update_task_progress("t1", 100.0, ProcessingStage.SUBTITLE_GENERATION)

        assert task.subtitle_elapsed_seconds is not None
        assert task.subtitle_elapsed_seconds >= 5
        assert task.scene_elapsed_seconds is None
        assert task.split_elapsed_seconds is None

    @pytest.mark.asyncio
    async def test_elapsed_not_set_for_non_100_progress(self):
        from datetime import datetime, timedelta
        from src.task_manager import TaskManager
        tm = TaskManager()
        task = _make_task()
        task.stageStartedAt = (datetime.utcnow() - timedelta(seconds=5)).isoformat()
        tm.tasks_db["t1"] = task

        with patch("src.task_manager.update_task"):
            await tm.update_task_progress("t1", 50.0, ProcessingStage.SCENE_DETECTION)

        assert task.scene_elapsed_seconds is None
