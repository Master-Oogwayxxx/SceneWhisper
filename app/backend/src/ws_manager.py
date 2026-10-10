import asyncio
import logging
from fastapi import WebSocket


class ConnectionManager:
    """Manages WebSocket connections and broadcasts messages to all connected clients."""

    def __init__(self):
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        """Accept and add a new WebSocket connection."""
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)
        logging.info(f"WebSocket connected. Total connections: {len(self._connections)}")

    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove a disconnected WebSocket."""
        async with self._lock:
            self._connections.discard(websocket)
        logging.info(f"WebSocket disconnected. Total connections: {len(self._connections)}")

    async def cleanup_dead_connections(self) -> int:
        """Proactively check and remove dead connections. Returns count removed."""
        async with self._lock:
            connections_copy = set(self._connections)

        dead_count = 0
        for connection in connections_copy:
            # Check if connection is closed
            if connection.client_state.name == 'DISCONNECTED' or connection.application_state.name == 'DISCONNECTED':
                async with self._lock:
                    self._connections.discard(connection)
                dead_count += 1
                try:
                    await connection.close()
                except Exception:
                    pass

        if dead_count > 0:
            logging.info(f"Cleaned up {dead_count} dead WebSocket connections. Total connections: {len(self._connections)}")

        return dead_count

    async def broadcast(self, message: dict) -> None:
        """Send a message to all connected clients, removing dead connections."""
        async with self._lock:
            connections_copy = set(self._connections)

        dead_connections = set()
        for connection in connections_copy:
            try:
                await asyncio.wait_for(connection.send_json(message), timeout=5.0)
            except (asyncio.TimeoutError, Exception) as e:
                logging.warning(f"Failed to send message to WebSocket: {e}")
                dead_connections.add(connection)
                # Try to close the dead connection
                try:
                    await connection.close()
                except Exception:
                    pass

        if dead_connections:
            async with self._lock:
                self._connections.difference_update(dead_connections)


ws_manager = ConnectionManager()
