from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.database import connect_db, close_db, get_db
from app.config import settings
from app.routers import admin, game, questions, powerups, auth
from app.ws.manager import ws_manager
from app.ws import events
import json
import logging
import time
import asyncio
from datetime import datetime, timezone, timedelta

# FIX 5: Rate limiting
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("api")


async def _restore_background_tasks():
    """FIX 4: On startup, recreate any in-flight freeze/shield timers that survived a restart."""
    from app.routers.powerups import _auto_unfreeze, _auto_remove_shield
    db = get_db()
    now = datetime.now(timezone.utc)

    # Restore frozen players
    async for p in db.players.find({"is_frozen": True, "frozen_until": {"$gt": now}}):
        player_id = str(p["_id"])
        session_id = p["session_id"]
        remaining = (p["frozen_until"] - now).total_seconds()
        asyncio.create_task(_auto_unfreeze(player_id, session_id, remaining))
        print(f"  Restored freeze timer for player {player_id} ({remaining:.1f}s remaining)")

    # Restore shielded players — shield_used_at + shield_duration tells us expiry
    async for p in db.players.find({"has_shield": True, "shield_used_at": {"$ne": None}}):
        player_id = str(p["_id"])
        session_id = p["session_id"]
        expiry = p["shield_used_at"] + timedelta(seconds=settings.shield_duration_seconds)
        if expiry > now:
            remaining = (expiry - now).total_seconds()
            asyncio.create_task(_auto_remove_shield(player_id, session_id, remaining))
            print(f"  Restored shield timer for player {player_id} ({remaining:.1f}s remaining)")

    # Clear any that have already expired (orphaned by a crash)
    await db.players.update_many(
        {"is_frozen": True, "frozen_until": {"$lte": now}},
        {"$set": {"is_frozen": False, "frozen_until": None}}
    )
    await db.players.update_many(
        {
            "has_shield": True,
            "shield_used_at": {"$ne": None},
            "$expr": {
                "$lte": [
                    {"$add": ["$shield_used_at", settings.shield_duration_seconds * 1000]},
                    {"$toLong": "$$NOW"}
                ]
            }
        },
        {"$set": {"has_shield": False}}
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    await _restore_background_tasks()  # FIX 4
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

# FIX 5: Initialize rate limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.middleware("http")
async def log_requests(request, call_next):
    logger.info(f"Incoming Request: {request.method} {request.url}")
    start_time = time.time()
    try:
        response = await call_next(request)
        process_time = (time.time() - start_time) * 1000
        logger.info(f"Response: {response.status_code} ({process_time:.2f}ms) for {request.url.path}")
        return response
    except Exception as e:
        logger.error(f"Error handling request {request.url.path}: {e}")
        raise

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
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


# FIX 10: WebSocket keepalive ping/pong constants
PING_INTERVAL = 25  # seconds


@app.websocket("/ws/{session_id}/{player_id}")
async def websocket_player(
    websocket: WebSocket,
    session_id: str,
    player_id: str,
    token: str = Query(...),
):
    """Player WebSocket connection — validates token AND session ownership."""
    db = get_db()
    player = await db.players.find_one({"token": token})
    if not player or str(player["_id"]) != player_id:
        await websocket.close(code=4001, reason="Invalid token")
        return

    # FIX #1: Enforce session ownership — player cannot eavesdrop on other sessions
    if player.get("session_id") != session_id:
        await websocket.close(code=4003, reason="Session mismatch")
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
            {"name": 1, "score": 1, "is_frozen": 1, "has_shield": 1, "consecutive_correct": 1}
        ).sort("score", -1)
        players_list = []
        async for p in cursor:
            players_list.append({
                "id": str(p["_id"]),
                "name": p["name"],
                "score": p["score"],
                "is_frozen": p.get("is_frozen", False),
                "has_shield": p.get("has_shield", False),
                "streak": p.get("consecutive_correct", 0),
            })
        await websocket.send_text(json.dumps({
            "type": events.LEADERBOARD_UPDATE,
            "data": {"players": players_list},
        }, default=str))

        # FIX 10: Keep alive with server-side ping
        async def _sender():
            while True:
                await asyncio.sleep(PING_INTERVAL)
                try:
                    await websocket.send_text('{"type":"ping"}')
                except Exception:
                    break

        ping_task = asyncio.create_task(_sender())
        try:
            while True:
                data = await websocket.receive_text()
                if data == "pong" or data == '{"type":"pong"}':
                    continue  # ignore client pong
        except WebSocketDisconnect:
            pass
        finally:
            ping_task.cancel()
            ws_manager.disconnect(session_id, player_id)

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

    # FIX 7: Validate admin WebSocket session_id against database
    from bson import ObjectId
    from bson.errors import InvalidId
    db = get_db()
    try:
        session = await db.game_sessions.find_one({"_id": ObjectId(session_id)})
    except InvalidId:
        await websocket.close(code=4004, reason="Invalid session ID format")
        return
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return

    await ws_manager.connect_admin(websocket, session_id)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        # FIX 8: Pass websocket to disconnect_admin for list-based tracking
        ws_manager.disconnect_admin(session_id, websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
