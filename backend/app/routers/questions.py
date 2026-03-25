from fastapi import APIRouter, HTTPException, Header, Request
from app.database import get_db
from app.config import settings
from app.ws.manager import ws_manager
from app.ws import events
from app.routers.game import _broadcast_leaderboard
from bson import ObjectId
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError as MongoDuplicateKeyError

router = APIRouter()

# Rate limiter — imported from main where it's initialized
from app.main import limiter


async def _get_player_by_token(token: str):
    """Validate player token and return player doc."""
    db = get_db()
    player = await db.players.find_one({"token": token})
    if not player:
        raise HTTPException(401, "Invalid player token")
    return player


async def _assert_session_active(session_id: str):
    """FIX #3: Ensure the game session is active before allowing game actions."""
    db = get_db()
    session = await db.game_sessions.find_one({"_id": ObjectId(session_id)})
    if not session or session["status"] != "active":
        raise HTTPException(403, "Game is not active. Please wait for the game to start.")


def _get_streak_tier(consecutive_correct: int):
    """Return (points_correct, points_wrong, powerup_discount) for current streak."""
    if consecutive_correct >= settings.streak_tier2_threshold:
        return (settings.streak_tier2_points_correct, settings.streak_tier2_points_wrong, settings.streak_tier2_powerup_discount)
    elif consecutive_correct >= settings.streak_tier1_threshold:
        return (settings.streak_tier1_points_correct, settings.streak_tier1_points_wrong, settings.streak_tier1_powerup_discount)
    else:
        return (settings.points_correct, settings.points_wrong, 0)


@router.get("/current")
async def get_current_question(x_player_token: str = Header(...)):
    """Fetch the current question for this player. No 'correct' field."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)

    # FIX 6: Check session status before allowing question read
    session = await db.game_sessions.find_one({"_id": ObjectId(player["session_id"])})
    if not session or session["status"] == "waiting":
        raise HTTPException(403, "Game has not started yet")
    if session["status"] == "finished":
        raise HTTPException(403, "Game has ended")
    # "paused" is deliberately allowed — player can see their current question
    # but cannot answer it (submit_answer/_timeout check status == "active")

    idx = player.get("current_question_index", 0)

    # Check if already answered this question
    existing = await db.player_answers.find_one({
        "player_id": str(player["_id"]),
        "question_index": idx,
    })

    # Get total active questions
    total = await db.questions.count_documents({"active": True})

    if idx >= total:
        return {"completed": True, "final_score": player["score"]}

    if existing:
        has_next = idx + 1 < total
        return {"already_answered": True, "next_available": has_next}

    # Fetch question at this index (sorted by order)
    question = await db.questions.find({"active": True}).sort("order", 1).skip(idx).limit(1).to_list(1)
    if not question:
        return {"completed": True, "final_score": player["score"]}

    q = question[0]

    # FIX 1b: Record delivery timestamp (idempotent)
    now = datetime.now(timezone.utc)
    try:
        await db.question_deliveries.insert_one({
            "player_id": str(player["_id"]),
            "question_index": idx,
            "delivered_at": now,
        })
    except Exception:
        pass  # already delivered — idempotent

    streak = player.get("consecutive_correct", 0)
    pts_correct, pts_wrong, _ = _get_streak_tier(streak)

    return {
        "id": str(q["_id"]),
        "question": q["question"],
        "options": q["options"],
        "category": q.get("category"),
        "difficulty": q.get("difficulty"),
        "question_index": idx,
        "total_questions": total,
        "streak": streak,
        "streak_points_correct": pts_correct,
        "streak_points_wrong": pts_wrong,
    }


@router.post("/answer")
@limiter.limit("60/minute")
async def submit_answer(request: Request, data: dict, x_player_token: str = Header(...)):
    """Submit an answer. Returns correctness and points."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
    player_id = str(player["_id"])
    session_id = player["session_id"]
    idx = player.get("current_question_index", 0)
    streak = player.get("consecutive_correct", 0)

    # FIX #3: Session must be active
    await _assert_session_active(session_id)

    question_id = data.get("question_id")
    selected_option = data.get("selected_option")

    if question_id is None or selected_option is None:
        raise HTTPException(400, "question_id and selected_option required")

    # FIX #2: Fetch the REAL current question server-side, validate client-provided id
    expected_question = await db.questions.find({"active": True}).sort("order", 1).skip(idx).limit(1).to_list(1)
    if not expected_question:
        raise HTTPException(400, "No question at current index")

    expected_q = expected_question[0]
    if question_id != str(expected_q["_id"]):
        raise HTTPException(400, "question_id does not match current question")

    # Prevent double-answer
    existing = await db.player_answers.find_one({
        "player_id": player_id,
        "question_index": idx,
    })
    if existing:
        raise HTTPException(409, "Already answered this question")

    # FIX 1c: Server-side timer enforcement
    GRACE_SECONDS = 5  # network buffer

    delivery = await db.question_deliveries.find_one({
        "player_id": player_id,
        "question_index": idx,
    })
    if delivery:
        elapsed = (datetime.now(timezone.utc) - delivery["delivered_at"]).total_seconds()
        if elapsed > (settings.timer_duration + GRACE_SECONDS):
            # Time expired server-side — treat as timeout
            timeout_points = settings.points_wrong
            new_score_timeout = player["score"] + timeout_points
            await db.player_answers.insert_one({
                "player_id": player_id,
                "question_id": question_id,
                "question_index": idx,
                "selected_option": None,
                "is_correct": False,
                "points_awarded": timeout_points,
                "answered_at": datetime.now(timezone.utc),
                "timed_out_server": True,
            })
            await db.players.update_one(
                {"_id": player["_id"]},
                {"$set": {
                    "score": new_score_timeout,
                    "current_question_index": idx + 1,
                    "consecutive_correct": 0,
                    "updated_at": datetime.now(timezone.utc),
                }}
            )
            await _broadcast_leaderboard(session_id)
            raise HTTPException(403, "Time expired for this question")

    # Check frozen
    if player.get("is_frozen") and player.get("frozen_until"):
        if datetime.now(timezone.utc) < player["frozen_until"]:
            raise HTTPException(403, "You are frozen")

    # Evaluate answer with streak-based scoring
    is_correct = selected_option == expected_q["correct"]
    pts_correct, pts_wrong, _ = _get_streak_tier(streak)

    if is_correct:
        points = pts_correct
        new_streak = streak + 1
    else:
        points = pts_wrong
        new_streak = 0

    now = datetime.now(timezone.utc)

    # FIX 2: Save answer with DuplicateKeyError handling
    try:
        await db.player_answers.insert_one({
            "player_id": player_id,
            "question_id": question_id,
            "question_index": idx,
            "selected_option": selected_option,
            "is_correct": is_correct,
            "points_awarded": points,
            "answered_at": now,
        })
    except MongoDuplicateKeyError:
        raise HTTPException(409, "Already answered this question")

    # Update player score, advance index, update streak
    new_score = player["score"] + points
    await db.players.update_one(
        {"_id": player["_id"]},
        {"$set": {
            "score": new_score,
            "current_question_index": idx + 1,
            "consecutive_correct": new_streak,
            "updated_at": now,
        }}
    )

    # Broadcast score + leaderboard update
    await ws_manager.broadcast_to_session(session_id, {
        "type": events.SCORE_UPDATED,
        "data": {"player_id": player_id, "score": new_score},
    })
    await _broadcast_leaderboard(session_id)

    # Get next tier info
    next_pts_correct, next_pts_wrong, _ = _get_streak_tier(new_streak)

    return {
        "is_correct": is_correct,
        "correct_option": expected_q["correct"],
        "points_awarded": points,
        "new_score": new_score,
        "streak": new_streak,
        "streak_points_correct": next_pts_correct,
        "streak_points_wrong": next_pts_wrong,
    }


@router.post("/timeout")
@limiter.limit("60/minute")
async def submit_timeout(request: Request, data: dict, x_player_token: str = Header(...)):
    """Handle question timeout — counts as wrong answer, resets streak."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
    player_id = str(player["_id"])
    session_id = player["session_id"]
    idx = player.get("current_question_index", 0)

    # FIX #3: Session must be active
    await _assert_session_active(session_id)

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

    # FIX 1d: Verify delivery exists for timeout
    delivery = await db.question_deliveries.find_one({
        "player_id": player_id,
        "question_index": idx,
    })
    if not delivery:
        raise HTTPException(400, "Question was never fetched — cannot time out")

    now = datetime.now(timezone.utc)
    points = settings.points_wrong  # Timeout always uses base wrong penalty
    new_streak = 0  # Timeout resets streak

    # FIX 2: DuplicateKeyError handling for timeout
    try:
        await db.player_answers.insert_one({
            "player_id": player_id,
            "question_id": question_id,
            "question_index": idx,
            "selected_option": None,
            "is_correct": False,
            "points_awarded": points,
            "answered_at": now,
        })
    except MongoDuplicateKeyError:
        raise HTTPException(409, "Already answered this question")

    new_score = player["score"] + points
    await db.players.update_one(
        {"_id": player["_id"]},
        {"$set": {
            "score": new_score,
            "current_question_index": idx + 1,
            "consecutive_correct": new_streak,
            "updated_at": now,
        }}
    )

    await ws_manager.broadcast_to_session(session_id, {
        "type": events.SCORE_UPDATED,
        "data": {"player_id": player_id, "score": new_score},
    })
    await _broadcast_leaderboard(session_id)

    # Get the correct answer to send back
    try:
        q = await db.questions.find_one({"_id": ObjectId(question_id)})
        correct_option = q["correct"] if q else 0
    except Exception:
        correct_option = 0

    return {
        "is_correct": False,
        "correct_option": correct_option,
        "points_awarded": points,
        "new_score": new_score,
        "streak": 0,
    }
