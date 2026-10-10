import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..crud.notification import delete_all_notifications, get_notifications, mark_all_notifications_read, mark_notification_read
from ..models.notification import NotificationsResponse
from ..ws_manager import ws_manager

router = APIRouter(prefix="/api")


@router.get("/notifications", response_model=NotificationsResponse)
def list_notifications(page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200)):
    """Get paginated notifications, newest first."""
    return get_notifications(page, limit)


@router.patch("/notifications/{notification_id}/read")
def read_notification(notification_id: str):
    """Mark a notification as read."""
    success = mark_notification_read(notification_id)
    if not success:
        return {"error": "Notification not found"}, 404
    return {"success": True}


@router.post("/notifications/read-all")
def read_all_notifications():
    """Mark all notifications as read."""
    count = mark_all_notifications_read()
    return {"success": True, "count": count}


@router.delete("/notifications")
def clear_notifications():
    """Delete all notifications."""
    count = delete_all_notifications()
    return {"success": True, "count": count}


@router.websocket("/ws/notifications")
async def websocket_notifications(websocket: WebSocket):
    """WebSocket endpoint for real-time notifications.

    Clients connect and receive notifications as they are broadcast.
    The connection is kept alive by the receive_text() loop.
    """
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception as e:
        logging.error(f"WebSocket error: {e}")
        await ws_manager.disconnect(websocket)
