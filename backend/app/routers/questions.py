from fastapi import APIRouter, HTTPException, Header
from app.database import get_db
from app.config import settings
from app.ws.manager import ws_manager
from app.ws import events
from app.routers.game import _broadcast_leaderboard
from bson import ObjectId
from datetime import datetime, timezone

router = APIRouter()


async def _get_player_by_token(token: str):
    """Validate player token and return player doc."""
    db = get_db()
    player = await db.players.find_one({"token": token})
    if not player:
        raise HTTPException(401, "Invalid player token")
    return player


@router.get("/current")
async def get_current_question(x_player_token: str = Header(...)):
    """Fetch the current question for this player. No 'correct' field."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
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
    return {
        "id": str(q["_id"]),
        "question": q["question"],
        "options": q["options"],
        "category": q.get("category"),
        "difficulty": q.get("difficulty"),
        "question_index": idx,
        "total_questions": total,
    }


@router.post("/answer")
async def submit_answer(data: dict, x_player_token: str = Header(...)):
    """Submit an answer. Returns correctness and points."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
    player_id = str(player["_id"])
    session_id = player["session_id"]
    idx = player.get("current_question_index", 0)

    question_id = data.get("question_id")
    selected_option = data.get("selected_option")

    if question_id is None or selected_option is None:
        raise HTTPException(400, "question_id and selected_option required")

    # Validate question matches current index
    try:
        q = await db.questions.find_one({"_id": ObjectId(question_id)})
    except Exception:
        raise HTTPException(400, "Invalid question_id")

    if not q:
        raise HTTPException(404, "Question not found")

    # Prevent double-answer
    existing = await db.player_answers.find_one({
        "player_id": player_id,
        "question_index": idx,
    })
    if existing:
        raise HTTPException(409, "Already answered this question")

    # Check frozen
    if player.get("is_frozen") and player.get("frozen_until"):
        if datetime.now(timezone.utc) < player["frozen_until"]:
            raise HTTPException(403, "You are frozen")

    # Evaluate answer
    is_correct = selected_option == q["correct"]
    points = settings.points_correct if is_correct else settings.points_wrong
    now = datetime.now(timezone.utc)

    # Save answer
    await db.player_answers.insert_one({
        "player_id": player_id,
        "question_id": question_id,
        "question_index": idx,
        "selected_option": selected_option,
        "is_correct": is_correct,
        "points_awarded": points,
        "answered_at": now,
    })

    # Update player score and advance index
    new_score = player["score"] + points
    await db.players.update_one(
        {"_id": player["_id"]},
        {"$set": {
            "score": new_score,
            "current_question_index": idx + 1,
            "updated_at": now,
        }}
    )

    # Broadcast score + leaderboard update
    await ws_manager.broadcast_to_session(session_id, {
        "type": events.SCORE_UPDATED,
        "data": {"player_id": player_id, "score": new_score},
    })
    await _broadcast_leaderboard(session_id)

    return {
        "is_correct": is_correct,
        "correct_option": q["correct"],
        "points_awarded": points,
        "new_score": new_score,
    }


@router.post("/timeout")
async def submit_timeout(data: dict, x_player_token: str = Header(...)):
    """Handle question timeout — counts as wrong answer."""
    db = get_db()
    player = await _get_player_by_token(x_player_token)
    player_id = str(player["_id"])
    session_id = player["session_id"]
    idx = player.get("current_question_index", 0)

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

    now = datetime.now(timezone.utc)
    points = settings.points_wrong

    await db.player_answers.insert_one({
        "player_id": player_id,
        "question_id": question_id,
        "question_index": idx,
        "selected_option": None,
        "is_correct": False,
        "points_awarded": points,
        "answered_at": now,
    })

    new_score = player["score"] + points
    await db.players.update_one(
        {"_id": player["_id"]},
        {"$set": {
            "score": new_score,
            "current_question_index": idx + 1,
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
    }
