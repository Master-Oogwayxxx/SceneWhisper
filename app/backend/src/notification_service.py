import asyncio
import logging

from .crud.notification import create_notification
from .models.notification import NotificationType
from .ws_manager import ws_manager

_main_loop: asyncio.AbstractEventLoop | None = None


def set_notification_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Register the FastAPI event loop for thread-safe notification broadcasts."""
    global _main_loop
    _main_loop = loop


async def emit_notification(
    type: NotificationType,
    title: str,
    message: str,
    task_id: str | None = None,
    file_id: str | None = None,
) -> None:
    """Create a notification in the database and broadcast it to all connected WebSocket clients.

    Never raises. DB errors are logged but do not prevent broadcast attempts.
    """
    try:
        loop = asyncio.get_running_loop()
        notif = await loop.run_in_executor(None, create_notification, type, title, message, task_id, file_id)
        await ws_manager.broadcast({"event": "notification", "data": notif.model_dump()})
    except Exception as e:
        logging.error(f"Error emitting notification: {e}")


def emit_notification_sync(
    type: NotificationType,
    title: str,
    message: str,
    task_id: str | None = None,
    file_id: str | None = None,
) -> None:
    """Create and broadcast a notification from a background thread. Never raises."""
    try:
        notif = create_notification(type, title, message, task_id, file_id)
        loop = _main_loop
        if loop is None or not loop.is_running():
            logging.warning("Notification loop unavailable; stored notification in DB only")
            return
        future = asyncio.run_coroutine_threadsafe(
            ws_manager.broadcast({"event": "notification", "data": notif.model_dump()}),
            loop,
        )
        future.result(timeout=10)
    except Exception as e:
        logging.error(f"Error emitting sync notification: {e}")
