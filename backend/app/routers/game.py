from fastapi import APIRouter, HTTPException
from app.database import get_db
from app.config import settings
from app.ws.manager import ws_manager
from app.ws import events
from datetime import datetime, timezone
import uuid

router = APIRouter()


@router.post("/join")
async def join_game(data: dict):
    """Join an existing session or create one. Returns player credentials."""
    db = get_db()
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(400, "Name is required")
    if len(name) > 20:
        raise HTTPException(400, "Name must be 20 chars or less")

    session_id = data.get("session_id")
    now = datetime.now(timezone.utc)

    if session_id:
        from bson import ObjectId
        session = await db.game_sessions.find_one({"_id": ObjectId(session_id)})
        if not session:
            raise HTTPException(404, "Session not found")
    else:
        # Find most recent waiting/active/paused session
        session = await db.game_sessions.find_one(
            {"status": {"$in": ["waiting", "active", "paused"]}},
            sort=[("created_at", -1)]
        )
        if not session:
            # Create new session
            result = await db.game_sessions.insert_one({
                "status": "waiting",
                "timer_started_at": None,
                "created_at": now,
                "updated_at": now,
            })
            session = await db.game_sessions.find_one({"_id": result.inserted_id})

    session_id_str = str(session["_id"])

    # Prevent duplicate names in the same session
    existing_player = await db.players.find_one({
        "session_id": session_id_str,
        "name": {"$regex": f"^{name}$", "$options": "i"}
    })
    if existing_player:
        raise HTTPException(400, "Name already taken in this session")

    player_token = str(uuid.uuid4())

    # Insert player
    player_doc = {
        "session_id": session_id_str,
        "name": name,
        "score": 0,
        "current_question_index": 0,
        "is_frozen": False,
        "frozen_until": None,
        "has_shield": False,
        "freeze_used_at": None,
        "shield_used_at": None,
        "skip_count": 0,
        "token": player_token,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.players.insert_one(player_doc)
    player_id = str(result.inserted_id)

    # Broadcast player joined
    await ws_manager.broadcast_to_session(session_id_str, {
        "type": events.PLAYER_JOINED,
        "data": {"player_id": player_id, "name": name},
    })

    # Also broadcast updated leaderboard
    await _broadcast_leaderboard(session_id_str)

    return {
        "player_id": player_id,
        "player_token": player_token,
        "session_id": session_id_str,
        "session_status": session["status"],
    }


@router.get("/session/{session_id}")
async def get_session(session_id: str):
    """Public session info — no sensitive data."""
    db = get_db()
    from bson import ObjectId
    try:
        session = await db.game_sessions.find_one({"_id": ObjectId(session_id)})
    except Exception:
        raise HTTPException(404, "Invalid session ID")
    if not session:
        raise HTTPException(404, "Session not found")

    player_count = await db.players.count_documents({"session_id": session_id})

    return {
        "id": str(session["_id"]),
        "status": session["status"],
        "timer_started_at": session.get("timer_started_at"),
        "player_count": player_count,
    }


@router.get("/leaderboard/{session_id}")
async def get_leaderboard(session_id: str):
    """Sorted player list — no sensitive data."""
    db = get_db()
    cursor = db.players.find(
        {"session_id": session_id},
        {"name": 1, "score": 1, "is_frozen": 1, "has_shield": 1}
    ).sort("score", -1)
    players = []
    async for p in cursor:
        players.append({
            "id": str(p["_id"]),
            "name": p["name"],
            "score": p["score"],
            "is_frozen": p.get("is_frozen", False),
            "has_shield": p.get("has_shield", False),
        })
    return players


@router.get("/constants")
async def get_constants():
    """Return game constants for frontend sync."""
    return {
        "timer_duration": settings.timer_duration,
        "points_correct": settings.points_correct,
        "points_wrong": settings.points_wrong,
        "cost_freeze": settings.cost_freeze,
        "cost_shield": settings.cost_shield,
        "max_skips": settings.max_skips,
        "freeze_duration_seconds": settings.freeze_duration_seconds,
        "freeze_cooldown_seconds": settings.freeze_cooldown_seconds,
        "shield_duration_seconds": settings.shield_duration_seconds,
        "shield_cooldown_seconds": settings.shield_cooldown_seconds,
    }


async def _broadcast_leaderboard(session_id: str):
    """Helper to broadcast leaderboard update to all players in session."""
    db = get_db()
    cursor = db.players.find(
        {"session_id": session_id},
        {"name": 1, "score": 1, "is_frozen": 1, "has_shield": 1}
    ).sort("score", -1)
    players = []
    async for p in cursor:
        players.append({
            "id": str(p["_id"]),
            "name": p["name"],
            "score": p["score"],
            "is_frozen": p.get("is_frozen", False),
            "has_shield": p.get("has_shield", False),
        })
    await ws_manager.broadcast_to_session(session_id, {
        "type": events.LEADERBOARD_UPDATE,
        "data": {"players": players},
    })
