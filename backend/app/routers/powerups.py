from fastapi import APIRouter, HTTPException, Header, Request
from app.database import get_db
from app.config import settings
from app.ws.manager import ws_manager
from app.ws import events
from app.routers.game import _broadcast_leaderboard
from bson import ObjectId
from datetime import datetime, timezone
import asyncio

router = APIRouter()

# Rate limiter — imported from main where it's initialized
from app.main import limiter


async def _get_player_by_token(token: str):
    db = get_db()
    player = await db.players.find_one({"token": token})
    if not player:
        raise HTTPException(401, "Invalid player token")
    return player


async def _assert_session_active(session_id: str):
    """FIX #3: Ensure the game session is active."""
    db = get_db()
    session = await db.game_sessions.find_one({"_id": ObjectId(session_id)})
    if not session or session["status"] != "active":
        raise HTTPException(403, "Game is not active")


def _get_powerup_discount(consecutive_correct: int) -> int:
    """Return powerup discount for current streak tier."""
    if consecutive_correct >= settings.streak_tier2_threshold:
        return settings.streak_tier2_powerup_discount
    elif consecutive_correct >= settings.streak_tier1_threshold:
        return settings.streak_tier1_powerup_discount
    return 0


async def _auto_unfreeze(player_id: str, session_id: str, delay: float):
    """Background task: unfreeze player after delay."""
    await asyncio.sleep(delay)
    db = get_db()
    await db.players.update_one(
        {"_id": ObjectId(player_id)},
        {"$set": {"is_frozen": False, "frozen_until": None, "updated_at": datetime.now(timezone.utc)}}
    )
    await ws_manager.broadcast_to_session(session_id, {
        "type": events.PLAYER_UNFROZEN,
        "data": {"player_id": player_id},
    })


async def _auto_remove_shield(player_id: str, session_id: str, delay: float):
    """Background task: remove shield after duration."""
    await asyncio.sleep(delay)
    db = get_db()
    await db.players.update_one(
        {"_id": ObjectId(player_id)},
        {"$set": {"has_shield": False, "updated_at": datetime.now(timezone.utc)}}
    )
    # FIX 9: Removed empty leaderboard broadcast — only keep the real one
    await _broadcast_leaderboard(session_id)


@router.post("/freeze")
@limiter.limit("20/minute")
async def use_freeze(request: Request, data: dict, x_player_token: str = Header(...)):
    """Freeze another player. Costs points (with streak discount), has cooldown, can be blocked by shield."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
    player_id = str(player["_id"])
    session_id = player["session_id"]
    now = datetime.now(timezone.utc)

    # FIX #3: Session must be active
    await _assert_session_active(session_id)

    # Check if currently frozen
    if player.get("is_frozen") and player.get("frozen_until"):
        if now < player["frozen_until"]:
            raise HTTPException(403, "You cannot use powerups while frozen")

    target_id = data.get("target_player_id")
    if not target_id:
        raise HTTPException(400, "target_player_id required")

    if target_id == player_id:
        raise HTTPException(400, "Cannot freeze yourself")

    # Apply streak discount
    discount = _get_powerup_discount(player.get("consecutive_correct", 0))
    effective_cost = max(0, settings.cost_freeze - discount)

    # FIX #4: Atomic check-and-deduct using conditional update
    # Build cooldown filter
    cooldown_threshold = datetime.fromtimestamp(
        now.timestamp() - settings.freeze_cooldown_seconds, tz=timezone.utc
    )

    result = await db.players.update_one(
        {
            "_id": player["_id"],
            "score": {"$gte": effective_cost},
            "$or": [
                {"freeze_used_at": None},
                {"freeze_used_at": {"$lte": cooldown_threshold}},
            ],
        },
        {
            "$inc": {"score": -effective_cost},
            "$set": {
                "freeze_used_at": now,
                "updated_at": now,
            },
        }
    )

    if result.matched_count == 0:
        # Determine reason for failure
        if player["score"] < effective_cost:
            raise HTTPException(400, f"Not enough score (need {effective_cost})")
        raise HTTPException(429, "Freeze on cooldown")

    # Get target
    try:
        target = await db.players.find_one({"_id": ObjectId(target_id), "session_id": session_id})
    except Exception:
        raise HTTPException(400, "Invalid target_player_id")

    if not target:
        raise HTTPException(404, "Target player not found in this session")

    target_shielded = False

    if target.get("has_shield"):
        # Shield absorbs the freeze
        target_shielded = True
        await db.players.update_one(
            {"_id": target["_id"]},
            {"$set": {"has_shield": False, "updated_at": now}}
        )
        await ws_manager.send_to_player(session_id, target_id, {
            "type": events.SHIELD_ACTIVATED,
            "data": {"message": "Your shield blocked a freeze!"},
        })
    else:
        # Apply freeze
        frozen_until = datetime.fromtimestamp(
            now.timestamp() + settings.freeze_duration_seconds, tz=timezone.utc
        )
        await db.players.update_one(
            {"_id": target["_id"]},
            {"$set": {
                "is_frozen": True,
                "frozen_until": frozen_until,
                "updated_at": now,
            }}
        )
        # Broadcast freeze to session
        await ws_manager.broadcast_to_session(session_id, {
            "type": events.PLAYER_FROZEN,
            "data": {
                "player_id": target_id,
                "frozen_by": player_id,
                "duration": settings.freeze_duration_seconds,
            },
        })
        # Schedule auto-unfreeze
        asyncio.create_task(_auto_unfreeze(target_id, session_id, settings.freeze_duration_seconds))

    # Save powerup event
    await db.powerup_events.insert_one({
        "session_id": session_id,
        "source_player_id": player_id,
        "target_player_id": target_id,
        "powerup_type": "freeze",
        "shielded": target_shielded,
        "created_at": now,
    })

    await _broadcast_leaderboard(session_id)

    return {"success": True, "target_shielded": target_shielded, "cost_paid": effective_cost}


@router.post("/shield")
@limiter.limit("20/minute")
async def use_shield(request: Request, x_player_token: str = Header(...)):
    """Activate shield. Costs points (with streak discount), has cooldown, auto-expires."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
    player_id = str(player["_id"])
    session_id = player["session_id"]
    now = datetime.now(timezone.utc)

    # FIX #3: Session must be active
    await _assert_session_active(session_id)

    # Check if currently frozen
    if player.get("is_frozen") and player.get("frozen_until"):
        if now < player["frozen_until"]:
            raise HTTPException(403, "You cannot use powerups while frozen")

    # Apply streak discount
    discount = _get_powerup_discount(player.get("consecutive_correct", 0))
    effective_cost = max(0, settings.cost_shield - discount)

    # FIX #4: Atomic check-and-deduct
    cooldown_threshold = datetime.fromtimestamp(
        now.timestamp() - settings.shield_cooldown_seconds, tz=timezone.utc
    )

    result = await db.players.update_one(
        {
            "_id": player["_id"],
            "score": {"$gte": effective_cost},
            "has_shield": False,
            "$or": [
                {"shield_used_at": None},
                {"shield_used_at": {"$lte": cooldown_threshold}},
            ],
        },
        {
            "$inc": {"score": -effective_cost},
            "$set": {
                "has_shield": True,
                "shield_used_at": now,
                "updated_at": now,
            },
        }
    )

    if result.matched_count == 0:
        if player.get("has_shield"):
            raise HTTPException(400, "Shield already active")
        if player["score"] < effective_cost:
            raise HTTPException(400, f"Not enough score (need {effective_cost})")
        raise HTTPException(429, "Shield on cooldown")

    # Schedule auto-remove
    asyncio.create_task(_auto_remove_shield(player_id, session_id, settings.shield_duration_seconds))

    await _broadcast_leaderboard(session_id)

    return {"success": True, "shield_duration_seconds": settings.shield_duration_seconds, "cost_paid": effective_cost}


@router.post("/skip")
@limiter.limit("30/minute")
async def use_skip(request: Request, data: dict, x_player_token: str = Header(...)):
    """Skip a question. Free but limited."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
    player_id = str(player["_id"])
    session_id = player["session_id"]
    idx = player.get("current_question_index", 0)
    now = datetime.now(timezone.utc)

    # FIX #3: Session must be active
    await _assert_session_active(session_id)

    # Check if currently frozen
    if player.get("is_frozen") and player.get("frozen_until"):
        if now < player["frozen_until"]:
            raise HTTPException(403, "You cannot use powerups while frozen")

    question_id = data.get("question_id")
    if not question_id:
        raise HTTPException(400, "question_id required")

    # Prevent double-answer
    existing = await db.player_answers.find_one({
        "player_id": player_id,
        "question_index": idx,
    })
    if existing:
        raise HTTPException(409, "Already answered this question")

    # Record skip (doesn't affect streak — keeps current streak intact)
    await db.player_answers.insert_one({
        "player_id": player_id,
        "question_id": question_id,
        "question_index": idx,
        "selected_option": None,
        "is_correct": None,
        "points_awarded": 0,
        "answered_at": now,
    })

    # FIX 3: Atomic skip count — prevent exceeding max_skips under concurrency
    skip_result = await db.players.update_one(
        {
            "_id": player["_id"],
            "skip_count": {"$lt": settings.max_skips},
        },
        {
            "$inc": {"skip_count": 1},
            "$set": {
                "current_question_index": idx + 1,
                "updated_at": now,
            },
        }
    )
    if skip_result.matched_count == 0:
        raise HTTPException(400, "No skips remaining")

    updated_player = await db.players.find_one({"_id": player["_id"]}, {"skip_count": 1})
    return {
        "success": True,
        "skips_remaining": settings.max_skips - updated_player["skip_count"],
    }
