from fastapi import APIRouter, HTTPException, Header
from app.database import get_db
from app.config import settings
from app.ws.manager import ws_manager
from app.ws import events
from datetime import datetime, timezone
import uuid
from bson import ObjectId

router = APIRouter()

ONGOING_SESSION_STATUSES = {"waiting", "active", "paused"}


async def _get_authenticated_player(token: str):
    """Lookup registered_players by current_token, return the account doc."""
    db = get_db()
    account = await db.registered_players.find_one({"current_token": token})
    if not account:
        raise HTTPException(401, "Invalid or expired player token. Please log in again.")
    return account


async def _get_player_by_token(token: str):
    db = get_db()
    player = await db.players.find_one({"token": token})
    if not player:
        raise HTTPException(401, "Invalid or expired player token. You may have logged in from another device.")
    return player


async def _find_ongoing_player_for_account(account: dict, requested_session_id: str | None = None):
    """Find ongoing player for this account in requested session or latest session."""
    db = get_db()

    target_session = None
    target_session_id = requested_session_id

    if target_session_id:
        try:
            target_session = await db.game_sessions.find_one({"_id": ObjectId(target_session_id)})
        except Exception:
            return None, None
    else:
        target_session = await db.game_sessions.find_one({}, sort=[("created_at", -1)])
        if target_session:
            target_session_id = str(target_session["_id"])

    if not target_session or target_session.get("status") not in ONGOING_SESSION_STATUSES:
        return None, None

    player = await db.players.find_one(
        {
            "registered_username": account["username"],
            "session_id": str(target_session_id),
        },
        sort=[("updated_at", -1), ("created_at", -1)],
    )
    if not player:
        return None, None

    return player, target_session


@router.post("/join")
async def join_game(data: dict, x_player_token: str = Header(...)):
    """Join an existing session. Requires a valid login token."""
    db = get_db()

    # Authenticate via registered_players token
    account = await _get_authenticated_player(x_player_token)
    display_name = account.get("display_name") or account["username"]

    session_id = data.get("session_id")
    now = datetime.now(timezone.utc)

    # Reuse an ongoing player session for this account and rotate token for takeover.
    ongoing_player, ongoing_session = await _find_ongoing_player_for_account(account, session_id)
    if ongoing_player and ongoing_session:
        rotated_token = str(uuid.uuid4())
        update_doc = {
            "token": rotated_token,
            "updated_at": now,
        }
        if display_name and ongoing_player.get("name") != display_name:
            update_doc["name"] = display_name

        await db.players.update_one(
            {"_id": ongoing_player["_id"]},
            {"$set": update_doc},
        )

        ongoing_session_id = str(ongoing_session["_id"])
        if "name" in update_doc:
            await _broadcast_leaderboard(ongoing_session_id)

        return {
            "player_id": str(ongoing_player["_id"]),
            "player_token": rotated_token,
            "session_id": ongoing_session_id,
            "session_status": ongoing_session["status"],
        }

    if session_id:
        from bson import ObjectId
        try:
            session = await db.game_sessions.find_one({"_id": ObjectId(session_id)})
        except Exception:
            raise HTTPException(400, "Invalid session ID format")
        if not session:
            raise HTTPException(404, "Session not found")
        # FIX #5: Only allow joining sessions that are waiting
        if session["status"] != "waiting":
            raise HTTPException(403, "Session is not accepting new players")
    else:
        # Find most recent waiting session only
        session = await db.game_sessions.find_one(
            {"status": "waiting"},
            sort=[("created_at", -1)]
        )
        if not session:
            # Create new session
            result = await db.game_sessions.insert_one({
                "status": "waiting",
                "timer_started_at": None,
                "timer_ended_at": None,
                "created_at": now,
                "updated_at": now,
            })
            session = await db.game_sessions.find_one({"_id": result.inserted_id})

    session_id_str = str(session["_id"])

    # Prevent duplicate names in the same session
    existing_player = await db.players.find_one({
        "session_id": session_id_str,
        "name": {"$regex": f"^{display_name}$", "$options": "i"}
    })
    if existing_player:
        # If the same registered user is re-joining, return their existing credentials
        if existing_player.get("registered_username") == account["username"]:
            return {
                "player_id": str(existing_player["_id"]),
                "player_token": existing_player["token"],
                "session_id": session_id_str,
                "session_status": session["status"],
            }
        raise HTTPException(400, "Name already taken in this session")

    player_token = str(uuid.uuid4())

    # Insert player
    player_doc = {
        "session_id": session_id_str,
        "name": display_name,
        "registered_username": account["username"],
        "score": 0,
        "attempted_count": 0,
        "final_formula_score": 0.0,
        "completed_at": None,
        "elapsed_seconds": None,
        "sort_elapsed_seconds": 10**12,
        "current_question_index": 0,
        "consecutive_correct": 0,
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
        "data": {"player_id": player_id, "name": display_name},
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


@router.get("/player/session")
async def get_player_session(x_player_token: str = Header(...)):
    db = get_db()
    player = await _get_player_by_token(x_player_token)

    try:
        session = await db.game_sessions.find_one({"_id": ObjectId(player["session_id"])})
    except Exception:
        raise HTTPException(404, "Session not found")

    if not session:
        raise HTTPException(404, "Session not found")

    # Reject stale sessions only when this account has moved to a newer ongoing player session.
    registered_username = player.get("registered_username")
    player_created_at = player.get("created_at")
    if registered_username and player_created_at:
        newer_player = await db.players.find_one(
            {
                "registered_username": registered_username,
                "created_at": {"$gt": player_created_at},
            },
            sort=[("created_at", -1)],
        )
        if newer_player and newer_player.get("session_id"):
            try:
                newer_session = await db.game_sessions.find_one(
                    {"_id": ObjectId(newer_player["session_id"])}
                )
                if newer_session and newer_session.get("status") in ONGOING_SESSION_STATUSES:
                    raise HTTPException(401, "Session expired — a newer game session exists. Please log in again.")
            except HTTPException:
                raise
            except Exception:
                pass

    return {
        "player_id": str(player["_id"]),
        "session_id": player["session_id"],
        "session_status": session["status"],
        "name": player["name"],
        "score": player.get("score", 0),
        "attempted_count": player.get("attempted_count", 0),
        "final_formula_score": player.get("final_formula_score", 0.0),
        "elapsed_seconds": player.get("elapsed_seconds"),
        "is_frozen": player.get("is_frozen", False),
        "frozen_until": player.get("frozen_until"),
        "has_shield": player.get("has_shield", False),
        "skip_count": player.get("skip_count", 0),
        "current_question_index": player.get("current_question_index", 0),
        "consecutive_correct": player.get("consecutive_correct", 0),
    }


@router.get("/leaderboard/{session_id}")
async def get_leaderboard(session_id: str, x_player_token: str | None = Header(default=None)):
    """Sorted player list for an authenticated player in the same session."""
    if not x_player_token:
        raise HTTPException(401, "Missing player token")

    player = await _get_player_by_token(x_player_token)
    if player.get("session_id") != session_id:
        raise HTTPException(403, "You are not allowed to view this leaderboard")

    db = get_db()
    cursor = db.players.find(
        {"session_id": session_id},
        {
            "name": 1,
            "score": 1,
            "attempted_count": 1,
            "final_formula_score": 1,
            "elapsed_seconds": 1,
            "sort_elapsed_seconds": 1,
            "is_frozen": 1,
            "has_shield": 1,
            "consecutive_correct": 1,
        }
    ).sort([("score", -1), ("sort_elapsed_seconds", 1)])
    players = []
    async for p in cursor:
        players.append({
            "id": str(p["_id"]),
            "name": p["name"],
            "score": p["score"],
            "attempted_count": p.get("attempted_count", 0),
            "final_formula_score": p.get("final_formula_score", 0.0),
            "elapsed_seconds": p.get("elapsed_seconds"),
            "is_frozen": p.get("is_frozen", False),
            "has_shield": p.get("has_shield", False),
            "streak": p.get("consecutive_correct", 0),
        })
    return players


@router.get("/constants")
async def get_constants():
    """Return game constants including streak tiers for frontend sync."""
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
        # Streak tier info
        "streak_tiers": [
            {"threshold": 0, "points_correct": settings.points_correct, "points_wrong": settings.points_wrong, "powerup_discount": 0},
            {"threshold": settings.streak_tier1_threshold, "points_correct": settings.streak_tier1_points_correct, "points_wrong": settings.streak_tier1_points_wrong, "powerup_discount": settings.streak_tier1_powerup_discount},
            {"threshold": settings.streak_tier2_threshold, "points_correct": settings.streak_tier2_points_correct, "points_wrong": settings.streak_tier2_points_wrong, "powerup_discount": settings.streak_tier2_powerup_discount},
        ],
    }


async def _broadcast_leaderboard(session_id: str):
    """Helper to broadcast leaderboard update to all players in session."""
    db = get_db()
    cursor = db.players.find(
        {"session_id": session_id},
        {
            "name": 1,
            "score": 1,
            "attempted_count": 1,
            "final_formula_score": 1,
            "elapsed_seconds": 1,
            "sort_elapsed_seconds": 1,
            "is_frozen": 1,
            "has_shield": 1,
            "consecutive_correct": 1,
        }
    ).sort([("score", -1), ("sort_elapsed_seconds", 1)])
    players = []
    async for p in cursor:
        players.append({
            "id": str(p["_id"]),
            "name": p["name"],
            "score": p["score"],
            "attempted_count": p.get("attempted_count", 0),
            "final_formula_score": p.get("final_formula_score", 0.0),
            "elapsed_seconds": p.get("elapsed_seconds"),
            "is_frozen": p.get("is_frozen", False),
            "has_shield": p.get("has_shield", False),
            "streak": p.get("consecutive_correct", 0),
        })
    await ws_manager.broadcast_to_session(session_id, {
        "type": events.LEADERBOARD_UPDATE,
        "data": {"players": players},
    })
