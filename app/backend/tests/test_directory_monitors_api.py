"""Tests for directory_monitors API endpoints (server-side scheduling)."""
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app
from src.api.directory_monitors import get_task_manager

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

MONITOR_PAYLOAD = {
    "id": "mon-1",
    "directoryId": "dir-1",
    "directoryName": "Test Dir",
    "directoryPath": "/tmp/videos",
    "taskType": "scene",
    "schedule": {"interval": "hourly"},
    "isActive": True,
    "deleteVideoAfterCompletion": False,
    "createdAt": "2026-05-19T00:00:00Z",
}


def _make_client():
    """Return a TestClient with task_manager dependency overridden."""
    mock_tm = MagicMock()
    app.dependency_overrides[get_task_manager] = lambda: mock_tm
    return TestClient(app), mock_tm


# ---------------------------------------------------------------------------
# POST /api/directory-monitors
# ---------------------------------------------------------------------------


def test_post_computes_next_run_server_side():
    """nextRun returned by POST must be ~1 hour from now, ignoring any client value."""
    client, _ = _make_client()

    # Client supplies a bogus nextRun that should be ignored
    payload = {**MONITOR_PAYLOAD, "nextRun": "2000-01-01T00:00:00Z"}

    with patch("src.api.directory_monitors.create_directory_monitor") as mock_create, \
         patch("src.api.directory_monitors.calculate_next_run") as mock_calc:

        expected_next = datetime(2026, 5, 19, 1, 0, 0, tzinfo=timezone.utc)
        mock_calc.return_value = expected_next

        # Return whatever was passed in so we can inspect it
        mock_create.side_effect = lambda m: m

        resp = client.post("/api/directory-monitors", json=payload)

    assert resp.status_code == 200
    data = resp.json()

    # Verify calculate_next_run was called with the schedule dict
    mock_calc.assert_called_once()
    called_schedule = mock_calc.call_args[0][0]
    assert called_schedule["interval"] == "hourly"

    # nextRun must equal the server-computed value, not the client-supplied one
    assert data["nextRun"] == "2026-05-19T01:00:00Z"


def test_post_next_run_is_timezone_aware():
    """nextRun from POST must be timezone-aware (contains offset info)."""
    client, _ = _make_client()

    with patch("src.api.directory_monitors.create_directory_monitor") as mock_create, \
         patch("src.api.directory_monitors.calculate_next_run") as mock_calc:

        expected_next = datetime(2026, 5, 19, 1, 0, 0, tzinfo=timezone.utc)
        mock_calc.return_value = expected_next
        mock_create.side_effect = lambda m: m

        resp = client.post("/api/directory-monitors", json=MONITOR_PAYLOAD)

    assert resp.status_code == 200
    next_run_str = resp.json()["nextRun"]
    # isoformat of a timezone-aware datetime contains '+' or 'Z'
    assert "+" in next_run_str or next_run_str.endswith("Z")


# ---------------------------------------------------------------------------
# PUT /api/directory-monitors/{monitor_id}
# ---------------------------------------------------------------------------


def test_put_recomputes_next_run():
    """PUT must recompute nextRun server-side regardless of client payload."""
    client, _ = _make_client()

    updated_payload = {**MONITOR_PAYLOAD, "schedule": {"interval": "daily", "time": "03:00", "timeZone": "America/Los_Angeles"}}

    with patch("src.api.directory_monitors.update_directory_monitor") as mock_update, \
         patch("src.api.directory_monitors.calculate_next_run") as mock_calc:

        expected_next = datetime(2026, 5, 20, 3, 0, 0, tzinfo=timezone.utc)
        mock_calc.return_value = expected_next
        mock_update.side_effect = lambda m: m

        resp = client.put("/api/directory-monitors/mon-1", json=updated_payload)

    assert resp.status_code == 200
    data = resp.json()

    mock_calc.assert_called_once()
    called_schedule = mock_calc.call_args[0][0]
    assert called_schedule["interval"] == "daily"
    assert called_schedule["time"] == "03:00"
    assert called_schedule["timeZone"] == "America/Los_Angeles"

    assert data["nextRun"] == "2026-05-20T03:00:00Z"


def test_put_legacy_schedule_without_timezone_uses_utc_default():
    client, _ = _make_client()
    updated_payload = {**MONITOR_PAYLOAD, "schedule": {"interval": "daily", "time": "08:00"}}

    with patch("src.api.directory_monitors.update_directory_monitor") as mock_update, \
         patch("src.api.directory_monitors.calculate_next_run") as mock_calc:

        expected_next = datetime(2026, 5, 20, 8, 0, 0, tzinfo=timezone.utc)
        mock_calc.return_value = expected_next
        mock_update.side_effect = lambda m: m

        resp = client.put("/api/directory-monitors/mon-1", json=updated_payload)

    assert resp.status_code == 200
    mock_calc.assert_called_once()
    assert mock_calc.call_args.kwargs["default_timezone"] == "UTC"


def test_put_id_mismatch_returns_400():
    """PUT with mismatched path/payload IDs must return 400."""
    client, _ = _make_client()
    payload = {**MONITOR_PAYLOAD, "id": "wrong-id"}

    with patch("src.api.directory_monitors.calculate_next_run"):
        resp = client.put("/api/directory-monitors/mon-1", json=payload)

    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/directory-monitors/{monitor_id}/run
# ---------------------------------------------------------------------------


def test_run_now_returns_202():
    """POST /run must return 202 and {status: queued, queued, skipped}."""
    client, mock_tm = _make_client()

    mock_monitor = MagicMock()

    with patch("src.api.directory_monitors.get_directory_monitor", return_value=mock_monitor), \
         patch("src.api.directory_monitors.run_monitor", new_callable=AsyncMock, return_value=(0, 0)) as mock_run:

        resp = client.post("/api/directory-monitors/mon-1/run")

    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "queued"
    assert body["queued"] == 0
    assert body["skipped"] == 0
    mock_run.assert_awaited_once()


def test_run_now_404_on_missing_monitor():
    """POST /run must return 404 when monitor does not exist."""
    client, _ = _make_client()

    with patch("src.api.directory_monitors.get_directory_monitor", return_value=None):
        resp = client.post("/api/directory-monitors/nonexistent/run")

    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_run_now_rejects_disabled_monitor():
    client, _ = _make_client()
    mock_monitor = MagicMock()
    mock_monitor.isActive = False

    with patch("src.api.directory_monitors.get_directory_monitor", return_value=mock_monitor), \
         patch("src.api.directory_monitors.run_monitor", new_callable=AsyncMock) as mock_run:
        resp = client.post("/api/directory-monitors/mon-1/run")

    assert resp.status_code == 409
    assert "disabled" in resp.json()["detail"].lower()
    mock_run.assert_not_awaited()


def test_run_monitor_now_returns_counts():
    """POST /directory-monitors/{id}/run should return queued and skipped counts."""
    client, _ = _make_client()

    mock_monitor = MagicMock()

    with patch("src.api.directory_monitors.get_directory_monitor", return_value=mock_monitor), \
         patch("src.api.directory_monitors.run_monitor", new_callable=AsyncMock, return_value=(3, 2)):

        resp = client.post("/api/directory-monitors/mon-1/run")

    assert resp.status_code == 202
    body = resp.json()
    assert body["status"] == "queued"
    assert body["queued"] == 3
    assert body["skipped"] == 2
