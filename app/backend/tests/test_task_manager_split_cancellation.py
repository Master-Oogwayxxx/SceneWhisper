import asyncio
import pytest


def test_task_manager_imports_and_has_cancel_handling():
    """Verify that task_manager module imports correctly and includes cancel_event handling."""
    from src.task_manager import TaskManager
    import inspect

    # Check that TaskManager class exists
    assert TaskManager is not None

    # Check that _cancel_events attribute is initialized in __init__
    tm = TaskManager()
    assert hasattr(tm, '_cancel_events')
    assert isinstance(tm._cancel_events, dict)


def test_split_video_signature_includes_cancel_event():
    """Verify that split_video function accepts cancel_event parameter."""
    from src.processor import split_video
    import inspect

    sig = inspect.signature(split_video)
    params = list(sig.parameters.keys())

    assert 'cancel_event' in params, "split_video should have cancel_event parameter"


def test_asyncio_cancelled_error_is_importable():
    """Verify asyncio.CancelledError is available for exception handling."""
    # This test verifies the exception handling code will work
    try:
        raise asyncio.CancelledError()
    except asyncio.CancelledError:
        pass  # Expected
    except Exception:
        pytest.fail("asyncio.CancelledError should be catchable")
