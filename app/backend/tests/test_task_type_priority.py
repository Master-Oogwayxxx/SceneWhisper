import asyncio
import json
import pytest
from unittest.mock import MagicMock, patch

from src.models.models import Task, TaskStatus, TaskType
from src.task_manager import TaskManager


DEFAULT_ORDER = ["all", "merge", "subtitle", "split", "scene", "nvenc_frame_pacing"]


def _make_task(task_id: str, task_type: TaskType) -> Task:
    from datetime import datetime, timezone
    return Task(
        id=task_id,
        type=task_type,
        status=TaskStatus.QUEUED,
        createdAt=datetime.now(timezone.utc).isoformat(),
    )


def _make_settings(order=None):
    s = MagicMock()
    s.task_type_priority = json.dumps(order or DEFAULT_ORDER)
    return s


@pytest.mark.asyncio
async def test_rank_for_task_known_type():
    tm = TaskManager()
    tm.tasks_db["t1"] = _make_task("t1", TaskType.SUBTITLE)
    rank = tm._rank_for_task("t1", DEFAULT_ORDER)
    assert rank == 2  # "subtitle" is index 2 in DEFAULT_ORDER


@pytest.mark.asyncio
async def test_rank_for_task_unknown_task_id():
    tm = TaskManager()
    rank = tm._rank_for_task("missing", DEFAULT_ORDER)
    assert rank == len(DEFAULT_ORDER)  # fallback: lowest priority


@pytest.mark.asyncio
async def test_enqueue_with_priority_puts_tuple():
    tm = TaskManager()
    tm.tasks_db["t1"] = _make_task("t1", TaskType.ALL)
    mock_settings = _make_settings()
    with patch("src.task_manager.get_settings", return_value=mock_settings):
        await tm._enqueue_with_priority("t1")
    entry = tm.task_queue.get_nowait()
    assert isinstance(entry, tuple)
    assert len(entry) == 3
    rank, _, task_id = entry
    assert task_id == "t1"
    assert rank == 0  # "all" is index 0


@pytest.mark.asyncio
async def test_higher_priority_type_dequeued_first():
    tm = TaskManager()
    tm.tasks_db["scene1"] = _make_task("scene1", TaskType.SCENE)
    tm.tasks_db["all1"] = _make_task("all1", TaskType.ALL)
    mock_settings = _make_settings()
    with patch("src.task_manager.get_settings", return_value=mock_settings):
        await tm._enqueue_with_priority("scene1")
        await tm._enqueue_with_priority("all1")
    first = tm.task_queue.get_nowait()
    assert first[2] == "all1"  # ALL has lower rank index = higher priority


@pytest.mark.asyncio
async def test_rerank_queue_reorders_by_new_order():
    tm = TaskManager()
    tm.tasks_db["scene1"] = _make_task("scene1", TaskType.SCENE)
    tm.tasks_db["all1"] = _make_task("all1", TaskType.ALL)
    # Enqueue with default order
    mock_settings = _make_settings()
    with patch("src.task_manager.get_settings", return_value=mock_settings):
        await tm._enqueue_with_priority("all1")
        await tm._enqueue_with_priority("scene1")
    # Now rerank with scene first
    reversed_order = ["scene", "split", "subtitle", "merge", "all"]
    await tm.rerank_queue(reversed_order)
    first = tm.task_queue.get_nowait()
    assert first[2] == "scene1"
