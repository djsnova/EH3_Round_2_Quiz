from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import asyncio
import json
import logging
import time

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.database import close_db, connect_db, get_db
from app.rate_limiter import limiter
from app.routers import admin, auth, game, powerups, questions
from app.ws import events
from app.ws.manager import ws_manager


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("api")


def _ensure_tz_aware(dt):
    """Coerce a naive datetime to UTC (handles pre-tz-aware codec data)."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def _restore_background_tasks():
    """Restore in-flight freeze and shield timers for active sessions only."""
    try:
        from app.routers.powerups import _auto_remove_shield, _auto_unfreeze

        db = get_db()
        now = datetime.now(timezone.utc)
        active_session_ids = [
            str(session_id)
            for session_id in await db.game_sessions.distinct("_id", {"status": "active"})
        ]

        if active_session_ids:
            await db.players.update_many(
                {
                    "session_id": {"$nin": active_session_ids},
                    "$or": [{"is_frozen": True}, {"has_shield": True}],
                },
                {
                    "$set": {
                        "is_frozen": False,
                        "frozen_until": None,
                        "has_shield": False,
                        "updated_at": now,
                    }
                },
            )
        else:
            await db.players.update_many(
                {"$or": [{"is_frozen": True}, {"has_shield": True}]},
                {
                    "$set": {
                        "is_frozen": False,
                        "frozen_until": None,
                        "has_shield": False,
                        "updated_at": now,
                    }
                },
            )
            logger.info("No active sessions found during startup recovery")
            return

        session_filter = {"session_id": {"$in": active_session_ids}}

        async for player in db.players.find(
            {
                **session_filter,
                "is_frozen": True,
                "frozen_until": {"$gt": now},
            }
        ):
            player_id = str(player["_id"])
            session_id = player["session_id"]
            frozen_until = _ensure_tz_aware(player["frozen_until"])
            remaining = (frozen_until - now).total_seconds()
            if remaining > 0:
                asyncio.create_task(_auto_unfreeze(player_id, session_id, remaining))
                logger.info("Restored freeze timer for player %s (%.1fs remaining)", player_id, remaining)

        async for player in db.players.find(
            {
                **session_filter,
                "has_shield": True,
                "shield_used_at": {"$ne": None},
            }
        ):
            player_id = str(player["_id"])
            session_id = player["session_id"]
            shield_used_at = _ensure_tz_aware(player["shield_used_at"])
            expiry = shield_used_at + timedelta(seconds=settings.shield_duration_seconds)
            if expiry > now:
                remaining = (expiry - now).total_seconds()
                asyncio.create_task(_auto_remove_shield(player_id, session_id, remaining))
                logger.info("Restored shield timer for player %s (%.1fs remaining)", player_id, remaining)

        await db.players.update_many(
            {
                **session_filter,
                "is_frozen": True,
                "frozen_until": {"$lte": now},
            },
            {"$set": {"is_frozen": False, "frozen_until": None, "updated_at": now}},
        )
        await db.players.update_many(
            {
                **session_filter,
                "has_shield": True,
                "shield_used_at": {"$ne": None},
                "$expr": {
                    "$lte": [
                        {"$add": ["$shield_used_at", settings.shield_duration_seconds * 1000]},
                        {"$toLong": "$$NOW"},
                    ]
                },
            },
            {"$set": {"has_shield": False, "updated_at": now}},
        )
        logger.info("Background tasks restored successfully")
    except Exception:
        logger.exception("Failed to restore background tasks; skipping recovery")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application startup initiated")
    try:
        await connect_db()
        await _restore_background_tasks()
        logger.info("Application startup complete")
    except Exception:
        logger.exception(
            "Application startup failed; server will start but may not function "
            "correctly until the database connection is restored."
        )
    yield
    await close_db()
    logger.info("Application shutdown complete")


app = FastAPI(
    title="Event Horizon Quiz API",
    version="3.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

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
    except Exception as exc:
        logger.error(f"Error handling request {request.url.path}: {exc}")
        raise


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


PING_INTERVAL = 25


@app.websocket("/ws/{session_id}/{player_id}")
async def websocket_player(
    websocket: WebSocket,
    session_id: str,
    player_id: str,
    token: str = Query(...),
):
    """Player WebSocket connection; validates token and session ownership."""
    db = get_db()
    player = await db.players.find_one({"token": token})
    if not player or str(player["_id"]) != player_id:
        await websocket.close(code=4001, reason="Invalid token")
        return

    if player.get("session_id") != session_id:
        await websocket.close(code=4003, reason="Session mismatch")
        return

    await ws_manager.connect(websocket, session_id, player_id)

    try:
        from bson import ObjectId

        session = await db.game_sessions.find_one({"_id": ObjectId(session_id)})
        if session:
            await websocket.send_text(
                json.dumps(
                    {
                        "type": events.SESSION_UPDATED,
                        "data": {
                            "session_id": session_id,
                            "status": session["status"],
                        },
                    },
                    default=str,
                )
            )

        cursor = db.players.find(
            {"session_id": session_id},
            {"name": 1, "score": 1, "is_frozen": 1, "has_shield": 1, "consecutive_correct": 1},
        ).sort("score", -1)
        players_list = []
        async for p in cursor:
            players_list.append(
                {
                    "id": str(p["_id"]),
                    "name": p["name"],
                    "score": p["score"],
                    "is_frozen": p.get("is_frozen", False),
                    "has_shield": p.get("has_shield", False),
                    "streak": p.get("consecutive_correct", 0),
                }
            )
        await websocket.send_text(
            json.dumps(
                {
                    "type": events.LEADERBOARD_UPDATE,
                    "data": {"players": players_list},
                },
                default=str,
            )
        )

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
                    continue
        except WebSocketDisconnect:
            pass
        finally:
            ping_task.cancel()
            ws_manager.disconnect(session_id, player_id)
            try:
                await game._broadcast_leaderboard(session_id)
            except Exception:
                logger.exception("Failed to broadcast leaderboard after disconnect")

    except WebSocketDisconnect:
        pass


@app.websocket("/ws/admin/{session_id}")
async def websocket_admin(
    websocket: WebSocket,
    session_id: str,
    token: str = Query(...),
):
    """Admin WebSocket receives all events for a session."""
    if token != settings.admin_secret_token:
        await websocket.close(code=4001, reason="Invalid admin token")
        return

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
        ws_manager.disconnect_admin(session_id, websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)
