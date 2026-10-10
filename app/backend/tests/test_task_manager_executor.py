import ast
import asyncio
import inspect
import textwrap
import uuid
from types import SimpleNamespace
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from src.models.models import File, Task, TaskStatus, TaskType
from src.task_manager import TaskManager, _should_delete_failed_task
from src.utils import utc_isoformat


def _make_task(path: str = "/videos/video.mp4") -> Task:
    return Task(
        id=str(uuid.uuid4()),
        file=File(
            id="file-1",
            name="video.mp4",
            path=path,
            size=0,
            duration=None,
            format="mp4",
        ),
        type=TaskType.SUBTITLE,
        subtitleLanguage="en",
        status=TaskStatus.QUEUED,
        createdAt=utc_isoformat(datetime.utcnow()),
    )


@pytest.mark.asyncio
async def test_add_task_uses_dedicated_executor_for_db_create():
    """Bulk monitor runs must not queue DB writes onto asyncio's default executor."""
    manager = TaskManager()
    task = _make_task()
    loop = asyncio.get_running_loop()
    original_run_in_executor = loop.run_in_executor
    executors = []

    def recording_run_in_executor(executor, func, *args):
        executors.append(executor)
        return original_run_in_executor(executor, func, *args)

    with (
        patch.object(loop, "run_in_executor", side_effect=recording_run_in_executor),
        patch("src.task_manager.create_task", return_value=task),
        patch("src.task_manager.get_settings", return_value=SimpleNamespace(task_type_priority=None)),
        patch.object(manager, "_emit_notification_tracked", new=AsyncMock()),
    ):
        queued, existing = await manager.add_task(task)

    assert queued is True
    assert existing is None
    assert executors
    assert executors[0] is not None


def test_no_scenes_error_is_deleted_from_failed_tasks():
    assert _should_delete_failed_task("Scene detection returned no scenes") is True
    assert _should_delete_failed_task("Scene detection returned no scenes.") is False
    assert _should_delete_failed_task("Source file not found") is True
    assert _should_delete_failed_task("Source File Not Found") is True
    assert _should_delete_failed_task("Source file not found.") is False
    assert _should_delete_failed_task("Scene detection failed") is False
    assert _should_delete_failed_task(None) is False


@pytest.mark.asyncio
async def test_missing_source_file_task_is_deleted_after_failure(tmp_path):
    manager = TaskManager()
    task = _make_task(str(tmp_path / "missing.mp4"))
    manager.tasks_db[task.id] = task

    with (
        patch("src.task_manager.update_task", return_value=task) as update_mock,
        patch("src.task_manager.delete_task", return_value=True) as delete_mock,
    ):
        await manager.process_video(task.id)

    update_mock.assert_called_once()
    persisted_task = update_mock.call_args.args[0]
    assert persisted_task.status == TaskStatus.FAILED
    assert persisted_task.error == "Source file not found"
    delete_mock.assert_called_once_with(task.id)
    assert task.id not in manager.tasks_db


def test_process_video_does_not_shadow_module_json_import():
    """Frame pacing progress callbacks use json from the enclosing method scope."""
    source = inspect.getsource(TaskManager.process_video)
    tree = ast.parse(textwrap.dedent(source))

    json_imports = [
        node
        for node in tree.body[0].body
        if isinstance(node, ast.Import) and any(alias.name == "json" for alias in node.names)
    ]

    assert json_imports == []
