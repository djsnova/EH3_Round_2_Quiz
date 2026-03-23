from fastapi import APIRouter, HTTPException, Header
from app.database import get_db
from app.config import settings
from app.ws.manager import ws_manager
from app.ws import events
from app.routers.game import _broadcast_leaderboard
from bson import ObjectId
from datetime import datetime, timezone
import asyncio

router = APIRouter()


async def _get_player_by_token(token: str):
    db = get_db()
    player = await db.players.find_one({"token": token})
    if not player:
        raise HTTPException(401, "Invalid player token")
    return player


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
    await ws_manager.broadcast_to_session(session_id, {
        "type": events.LEADERBOARD_UPDATE,
        "data": {},
    })
    await _broadcast_leaderboard(session_id)


@router.post("/freeze")
async def use_freeze(data: dict, x_player_token: str = Header(...)):
    """Freeze another player. Costs points, has cooldown, can be blocked by shield."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
    player_id = str(player["_id"])
    session_id = player["session_id"]
    now = datetime.now(timezone.utc)

    # Check if currently frozen
    if player.get("is_frozen") and player.get("frozen_until"):
        if now < player["frozen_until"]:
            raise HTTPException(403, "You cannot use powerups while frozen")

    target_id = data.get("target_player_id")
    if not target_id:
        raise HTTPException(400, "target_player_id required")

    if target_id == player_id:
        raise HTTPException(400, "Cannot freeze yourself")

    # Check cost
    if player["score"] < settings.cost_freeze:
        raise HTTPException(400, f"Not enough score (need {settings.cost_freeze})")

    # Check cooldown
    freeze_used_at = player.get("freeze_used_at")
    if freeze_used_at:
        elapsed = (now - freeze_used_at).total_seconds()
        if elapsed < settings.freeze_cooldown_seconds:
            remaining = int(settings.freeze_cooldown_seconds - elapsed)
            raise HTTPException(429, f"Freeze on cooldown ({remaining}s remaining)")

    # Get target
    try:
        target = await db.players.find_one({"_id": ObjectId(target_id), "session_id": session_id})
    except Exception:
        raise HTTPException(400, "Invalid target_player_id")

    if not target:
        raise HTTPException(404, "Target player not found in this session")

    # Deduct cost, set cooldown
    await db.players.update_one(
        {"_id": player["_id"]},
        {"$set": {
            "score": player["score"] - settings.cost_freeze,
            "freeze_used_at": now,
            "updated_at": now,
        }}
    )

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

    return {"success": True, "target_shielded": target_shielded}


@router.post("/shield")
async def use_shield(x_player_token: str = Header(...)):
    """Activate shield. Costs points, has cooldown, auto-expires."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
    player_id = str(player["_id"])
    session_id = player["session_id"]
    now = datetime.now(timezone.utc)

    # Check if currently frozen
    if player.get("is_frozen") and player.get("frozen_until"):
        if now < player["frozen_until"]:
            raise HTTPException(403, "You cannot use powerups while frozen")

    if player["score"] < settings.cost_shield:
        raise HTTPException(400, f"Not enough score (need {settings.cost_shield})")

    if player.get("has_shield"):
        raise HTTPException(400, "Shield already active")

    # Check cooldown
    shield_used_at = player.get("shield_used_at")
    if shield_used_at:
        elapsed = (now - shield_used_at).total_seconds()
        if elapsed < settings.shield_cooldown_seconds:
            remaining = int(settings.shield_cooldown_seconds - elapsed)
            raise HTTPException(429, f"Shield on cooldown ({remaining}s remaining)")

    # Apply shield
    await db.players.update_one(
        {"_id": player["_id"]},
        {"$set": {
            "score": player["score"] - settings.cost_shield,
            "has_shield": True,
            "shield_used_at": now,
            "updated_at": now,
        }}
    )

    # Schedule auto-remove
    asyncio.create_task(_auto_remove_shield(player_id, session_id, settings.shield_duration_seconds))

    await _broadcast_leaderboard(session_id)

    return {"success": True, "shield_duration_seconds": settings.shield_duration_seconds}


@router.post("/skip")
async def use_skip(data: dict, x_player_token: str = Header(...)):
    """Skip a question. Free but limited."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
    player_id = str(player["_id"])
    session_id = player["session_id"]
    idx = player.get("current_question_index", 0)
    now = datetime.now(timezone.utc)

    # Check if currently frozen
    if player.get("is_frozen") and player.get("frozen_until"):
        if now < player["frozen_until"]:
            raise HTTPException(403, "You cannot use powerups while frozen")

    question_id = data.get("question_id")
    if not question_id:
        raise HTTPException(400, "question_id required")

    if player["skip_count"] >= settings.max_skips:
        raise HTTPException(400, "No skips remaining")

    # Prevent double-answer
    existing = await db.player_answers.find_one({
        "player_id": player_id,
        "question_index": idx,
    })
    if existing:
        raise HTTPException(409, "Already answered this question")

    # Record skip
    await db.player_answers.insert_one({
        "player_id": player_id,
        "question_id": question_id,
        "question_index": idx,
        "selected_option": None,
        "is_correct": None,
        "points_awarded": 0,
        "answered_at": now,
    })

    # Advance player
    await db.players.update_one(
        {"_id": player["_id"]},
        {"$set": {
            "skip_count": player["skip_count"] + 1,
            "current_question_index": idx + 1,
            "updated_at": now,
        }}
    )

    return {
        "success": True,
        "skips_remaining": settings.max_skips - player["skip_count"] - 1,
    }
