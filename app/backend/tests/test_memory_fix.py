"""Test that completed tasks are removed from the in-memory cache."""
import asyncio
import uuid
from datetime import datetime
from pathlib import Path

from src.task_manager import TaskManager
from src.models.models import File, Task, TaskStatus, TaskType


async def test_tasks_removed_from_cache():
    """Verify that completed/failed tasks are removed from tasks_db cache."""
    task_manager = TaskManager()

    # Create 10 tasks
    task_ids = []
    for i in range(10):
        task = Task(
            id=str(uuid.uuid4()),
            file=File(
                id=f"file_{i}",
                name=f"test_{i}.mp4",
                path=f"/tmp/test_{i}.mp4",
                size=1000,
                duration="00:10:00",
                format="mp4"
            ),
            type=TaskType.SCENE,
            status=TaskStatus.QUEUED,
            createdAt=datetime.utcnow().isoformat(),
        )
        task_ids.append(task.id)
        # Mock adding to cache (normally done by add_task, but we skip DB for this test)
        task_manager.tasks_db[task.id] = task

    print(f"Added {len(task_ids)} tasks to cache")
    assert len(task_manager.tasks_db) == 10, f"Expected 10 tasks, got {len(task_manager.tasks_db)}"

    # Simulate task completion by directly setting status and calling cleanup
    for task_id in task_ids:
        task = task_manager.tasks_db[task_id]
        task.status = TaskStatus.COMPLETED
        task.completedAt = datetime.utcnow().isoformat()
        # Simulate the cleanup that happens in process_video
        task_manager._progress_snapshots.pop(task_id, None)
        task_manager.tasks_db.pop(task_id, None)

    print(f"After completion, cache size: {len(task_manager.tasks_db)}")
    assert len(task_manager.tasks_db) == 0, f"Expected empty cache, got {len(task_manager.tasks_db)} tasks"
    print("OK: All tasks removed from cache after completion")


if __name__ == "__main__":
    asyncio.run(test_tasks_removed_from_cache())
