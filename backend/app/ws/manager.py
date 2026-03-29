from fastapi import WebSocket
from typing import Dict, List
import asyncio
import json
from datetime import datetime, timezone


class ConnectionManager:
    def __init__(self):
        # { session_id: { player_id: WebSocket } }
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
        # FIX 8: { session_id: [WebSocket, ...] } — supports multiple admin tabs
        self.admin_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, session_id: str, player_id: str):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = {}

        previous_ws = self.active_connections[session_id].get(player_id)
        if previous_ws and previous_ws is not websocket:
            try:
                await previous_ws.close(code=4008, reason="Logged in from another device")
            except Exception:
                pass

        self.active_connections[session_id][player_id] = websocket

    async def connect_admin(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        if session_id not in self.admin_connections:
            self.admin_connections[session_id] = []
        self.admin_connections[session_id].append(websocket)

    def disconnect(self, session_id: str, player_id: str, websocket: WebSocket | None = None):
        if session_id in self.active_connections:
            if websocket is not None:
                current_ws = self.active_connections[session_id].get(player_id)
                if current_ws is not websocket:
                    return
            self.active_connections[session_id].pop(player_id, None)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]

    def disconnect_admin(self, session_id: str, websocket: WebSocket):
        connections = self.admin_connections.get(session_id, [])
        if websocket in connections:
            connections.remove(websocket)
        if not connections:
            self.admin_connections.pop(session_id, None)

    async def broadcast_to_session(self, session_id: str, message: dict):
        """Send message to all players in a session + admin if connected."""
        if "timestamp" not in message:
            message["timestamp"] = datetime.now(timezone.utc).isoformat()

        connections = self.active_connections.get(session_id, {})
        stale = []
        tasks = []
        for pid, ws in connections.items():
            tasks.append(self._safe_send(ws, message, session_id, pid, stale))

        # FIX 8: Also send to all admin monitors for this session
        for admin_ws in self.admin_connections.get(session_id, []):
            tasks.append(self._safe_send_admin(admin_ws, message, session_id))

        if tasks:
            await asyncio.gather(*tasks)

        # Clean up stale connections
        for sid, pid in stale:
            self.disconnect(sid, pid)

    async def send_to_player(self, session_id: str, player_id: str, message: dict):
        """Send message to a specific player only."""
        if "timestamp" not in message:
            message["timestamp"] = datetime.now(timezone.utc).isoformat()

        connections = self.active_connections.get(session_id, {})
        ws = connections.get(player_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message, default=str))
            except Exception:
                self.disconnect(session_id, player_id)

    async def _safe_send(self, ws: WebSocket, message: dict, session_id: str, player_id: str, stale: list):
        try:
            await ws.send_text(json.dumps(message, default=str))
        except Exception:
            stale.append((session_id, player_id))

    async def _safe_send_admin(self, ws: WebSocket, message: dict, session_id: str):
        try:
            await ws.send_text(json.dumps(message, default=str))
        except Exception:
            self.disconnect_admin(session_id, ws)


ws_manager = ConnectionManager()
