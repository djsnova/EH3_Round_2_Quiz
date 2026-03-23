from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.database import connect_db, close_db, get_db
from app.config import settings
from app.routers import admin, game, questions, powerups
from app.ws.manager import ws_manager
from app.ws import events
import json


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await close_db()


app = FastAPI(
    title="Event Horizon Quiz API",
    version="3.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(game.router, prefix="/api/v1/game", tags=["Game"])
app.include_router(questions.router, prefix="/api/v1/questions", tags=["Questions"])
app.include_router(powerups.router, prefix="/api/v1/powerups", tags=["Powerups"])
app.include_router(admin.router, prefix="/api/v1/admin", tags=["Admin"])


@app.get("/")
async def root():
    return {"app": "Event Horizon 3.0", "status": "running"}


@app.post("/api/analyze-url")
async def analyze_url_dummy():
    """Dummy endpoint to absorb external security scans silently."""
    return {"status": "ok"}


@app.websocket("/ws/{session_id}/{player_id}")
async def websocket_player(
    websocket: WebSocket,
    session_id: str,
    player_id: str,
    token: str = Query(...),
):
    """Player WebSocket connection — validates token, sends live events."""
    db = get_db()
    player = await db.players.find_one({"token": token})
    if not player or str(player["_id"]) != player_id:
        await websocket.close(code=4001, reason="Invalid token")
        return

    await ws_manager.connect(websocket, session_id, player_id)

    try:
        # Send initial state
        from bson import ObjectId
        session = await db.game_sessions.find_one({"_id": ObjectId(session_id)})
        if session:
            await websocket.send_text(json.dumps({
                "type": events.SESSION_UPDATED,
                "data": {
                    "session_id": session_id,
                    "status": session["status"],
                },
            }, default=str))

        # Send leaderboard
        cursor = db.players.find(
            {"session_id": session_id},
            {"name": 1, "score": 1, "is_frozen": 1, "has_shield": 1}
        ).sort("score", -1)
        players_list = []
        async for p in cursor:
            players_list.append({
                "id": str(p["_id"]),
                "name": p["name"],
                "score": p["score"],
                "is_frozen": p.get("is_frozen", False),
                "has_shield": p.get("has_shield", False),
            })
        await websocket.send_text(json.dumps({
            "type": events.LEADERBOARD_UPDATE,
            "data": {"players": players_list},
        }, default=str))

        # Keep alive — listen for messages (just ping/pong)
        while True:
            data = await websocket.receive_text()
            # Client can send ping, we just ignore
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(session_id, player_id)


@app.websocket("/ws/admin/{session_id}")
async def websocket_admin(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(...),
):
    """Admin WebSocket — receives all events for a session."""
    if token != settings.admin_secret_token:
        await websocket.close(code=4001, reason="Invalid admin token")
        return

    await ws_manager.connect_admin(websocket, session_id)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect_admin(session_id)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
