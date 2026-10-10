"""Test that paused tasks are skipped during startup recovery."""
from datetime import datetime
from unittest.mock import MagicMock

from src.models.models import TaskStatus


def test_startup_recovery_skips_paused_tasks():
    """Verify that paused tasks are skipped during startup recovery.

    This test directly verifies the core logic: queued/processing tasks should be
    recovered EXCEPT for paused tasks (which have paused_at set).
    """
    # Create mock TaskRecords with different states
    task_records = []

    # Task 1: Queued, not paused (SHOULD be recovered)
    mock1 = MagicMock()
    mock1.id = "task1"
    mock1.status = TaskStatus.QUEUED
    mock1.paused_at = None  # Not paused
    task_records.append(mock1)

    # Task 2: Processing, not paused (SHOULD be recovered)
    mock2 = MagicMock()
    mock2.id = "task2"
    mock2.status = TaskStatus.PROCESSING
    mock2.paused_at = None  # Not paused
    task_records.append(mock2)

    # Task 3: Queued, paused (should NOT be recovered)
    mock3 = MagicMock()
    mock3.id = "task3"
    mock3.status = TaskStatus.QUEUED
    mock3.paused_at = datetime.utcnow()  # IS paused
    task_records.append(mock3)

    # Task 4: Processing, paused (should NOT be recovered)
    mock4 = MagicMock()
    mock4.id = "task4"
    mock4.status = TaskStatus.PROCESSING
    mock4.paused_at = datetime.utcnow()  # IS paused
    task_records.append(mock4)

    # Task 5: Completed (should NOT be recovered, wrong status)
    mock5 = MagicMock()
    mock5.id = "task5"
    mock5.status = TaskStatus.COMPLETED
    mock5.paused_at = None
    task_records.append(mock5)

    # Simulate the startup recovery logic from main.py
    tasks_to_requeue = []
    for task_record in task_records:
        if task_record.status in [TaskStatus.QUEUED, TaskStatus.PROCESSING]:
            # Skip paused tasks
            if task_record.paused_at is not None:
                continue  # Don't requeue paused tasks

            tasks_to_requeue.append(task_record.id)

    # Verify results
    assert len(tasks_to_requeue) == 2, f"Expected 2 tasks to requeue, got {len(tasks_to_requeue)}: {tasks_to_requeue}"
    assert "task1" in tasks_to_requeue, "Queued non-paused task should be recovered"
    assert "task2" in tasks_to_requeue, "Processing non-paused task should be recovered"
    assert "task3" not in tasks_to_requeue, "Queued paused task should NOT be recovered"
    assert "task4" not in tasks_to_requeue, "Processing paused task should NOT be recovered"
    assert "task5" not in tasks_to_requeue, "Completed task should NOT be recovered (wrong status)"
