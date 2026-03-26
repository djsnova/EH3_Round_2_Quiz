from fastapi import APIRouter, HTTPException, Header, Depends, Query
from app.database import get_db
from app.config import settings
from app.ws.manager import ws_manager
from app.ws import events
from app.routers.game import _broadcast_leaderboard
from bson import ObjectId
from passlib.hash import bcrypt
from datetime import datetime, timezone
from typing import Optional
import asyncio
import uuid

router = APIRouter()


async def verify_admin_token(x_admin_token: str = Header(...)):
    if x_admin_token != settings.admin_secret_token:
        raise HTTPException(403, "Invalid admin token")
    return x_admin_token


# ─── Registered Player Management ──────────────────────────────────────────

@router.get("/players/registered", dependencies=[Depends(verify_admin_token)])
async def list_registered_players():
    """List all registered (whitelisted) player accounts."""
    db = get_db()
    cursor = db.registered_players.find().sort("username", 1)
    players = []
    async for p in cursor:
        players.append({
            "id": str(p["_id"]),
            "username": p["username"],
            "display_name": p.get("display_name", p["username"]),
            "last_login": p.get("last_login"),
            "created_at": p.get("created_at"),
        })
    return players


@router.post("/players/register", dependencies=[Depends(verify_admin_token)])
async def register_player(data: dict):
    """Create a new registered player account."""
    db = get_db()
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""
    display_name = (data.get("display_name") or username).strip()

    if not username or not password:
        raise HTTPException(400, "username and password required")
    if len(password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")

    existing = await db.registered_players.find_one({"username": username})
    if existing:
        raise HTTPException(409, "Username already exists")

    now = datetime.now(timezone.utc)
    result = await db.registered_players.insert_one({
        "username": username,
        "password_hash": bcrypt.hash(password),
        "display_name": display_name,
        "current_token": None,
        "last_login": None,
        "created_at": now,
    })

    return {
        "id": str(result.inserted_id),
        "username": username,
        "display_name": display_name,
    }


@router.post("/players/register/bulk", dependencies=[Depends(verify_admin_token)])
async def register_players_bulk(data: dict):
    """Bulk register players from a JSON array of {username, password, display_name?}."""
    db = get_db()
    players_data = data.get("players", [])
    if not players_data or not isinstance(players_data, list):
        raise HTTPException(400, "players array required")

    now = datetime.now(timezone.utc)
    created = []
    skipped = []

    for p in players_data:
        username = (p.get("username") or "").strip().lower()
        password = p.get("password") or ""
        display_name = (p.get("display_name") or username).strip()

        if not username or not password:
            skipped.append({"username": username, "reason": "missing username or password"})
            continue

        existing = await db.registered_players.find_one({"username": username})
        if existing:
            skipped.append({"username": username, "reason": "already exists"})
            continue

        await db.registered_players.insert_one({
            "username": username,
            "password_hash": bcrypt.hash(password),
            "display_name": display_name,
            "current_token": None,
            "last_login": None,
            "created_at": now,
        })
        created.append(username)

    return {"created": len(created), "skipped": len(skipped), "skipped_details": skipped}


@router.delete("/players/registered/{player_id}", dependencies=[Depends(verify_admin_token)])
async def delete_registered_player(player_id: str):
    """Remove a registered player account."""
    db = get_db()
    result = await db.registered_players.delete_one({"_id": ObjectId(player_id)})
    if result.deleted_count == 0:
        raise HTTPException(404, "Registered player not found")
    return {"success": True}


# ─── Session Management ────────────────────────────────────────────────────

@router.get("/sessions", dependencies=[Depends(verify_admin_token)])
async def list_sessions():
    db = get_db()
    cursor = db.game_sessions.find().sort("created_at", -1)
    sessions = []
    async for s in cursor:
        sid = str(s["_id"])
        player_count = await db.players.count_documents({"session_id": sid})
        sessions.append({
            "id": sid,
            "status": s["status"],
            "timer_started_at": s.get("timer_started_at"),
            "player_count": player_count,
            "created_at": s.get("created_at"),
            "updated_at": s.get("updated_at"),
        })
    return sessions


@router.post("/sessions", dependencies=[Depends(verify_admin_token)])
async def create_session():
    db = get_db()
    now = datetime.now(timezone.utc)
    result = await db.game_sessions.insert_one({
        "status": "waiting",
        "timer_started_at": None,
        "timer_ended_at": None,
        "created_at": now,
        "updated_at": now,
    })
    return {"id": str(result.inserted_id), "status": "waiting"}


@router.patch("/sessions/{session_id}", dependencies=[Depends(verify_admin_token)])
async def update_session(session_id: str, data: dict):
    db = get_db()
    status = data.get("status")
    if status not in ("waiting", "active", "paused", "finished"):
        raise HTTPException(400, "Invalid status")

    session = await db.game_sessions.find_one({"_id": ObjectId(session_id)})
    if not session:
        raise HTTPException(404, "Session not found")

    now = datetime.now(timezone.utc)
    update_doc = {"status": status, "updated_at": now}

    if status == "active" and not session.get("timer_started_at"):
        update_doc["timer_started_at"] = now
        update_doc["timer_ended_at"] = None
    elif status == "waiting":
        update_doc["timer_started_at"] = None
        update_doc["timer_ended_at"] = None
    elif status == "finished":
        update_doc["timer_ended_at"] = now

    await db.game_sessions.update_one(
        {"_id": ObjectId(session_id)},
        {"$set": update_doc}
    )

    if status == "finished":
        hidden_ids = []
        async for row in db.session_hidden_questions.find({"session_id": session_id}, {"question_id": 1}):
            try:
                hidden_ids.append(ObjectId(row["question_id"]))
            except Exception:
                continue

        question_query: dict[str, object] = {"active": True}
        if hidden_ids:
            question_query["_id"] = {"$nin": hidden_ids}
        total_questions = await db.questions.count_documents(question_query)

        cursor = db.players.find({"session_id": session_id, "completed_at": None})
        async for p in cursor:
            attempted = p.get("attempted_count", 0)
            formula = (p.get("score", 0) * (attempted / total_questions)) if total_questions > 0 else 0.0
            elapsed = None
            if session.get("timer_started_at"):
                elapsed = max(0.0, (now - session["timer_started_at"]).total_seconds())

            update_player = {
                "completed_at": now,
                "final_formula_score": formula,
                "total_questions_dynamic": total_questions,
                "updated_at": now,
            }
            if elapsed is not None:
                update_player["elapsed_seconds"] = elapsed
                update_player["sort_elapsed_seconds"] = elapsed

            await db.players.update_one({"_id": p["_id"]}, {"$set": update_player})

        await _broadcast_leaderboard(session_id)

    await ws_manager.broadcast_to_session(session_id, {
        "type": events.SESSION_UPDATED,
        "data": {"session_id": session_id, "status": status},
    })

    return {"success": True, "status": status}


@router.post("/sessions/{session_id}/reset", dependencies=[Depends(verify_admin_token)])
async def reset_session(session_id: str):
    db = get_db()
    now = datetime.now(timezone.utc)
    player_ids = []

    async for p in db.players.find({"session_id": session_id}, {"_id": 1}):
        player_ids.append(str(p["_id"]))

    # Reset session
    await db.game_sessions.update_one(
        {"_id": ObjectId(session_id)},
        {"$set": {
            "status": "waiting",
            "timer_started_at": None,
            "timer_ended_at": None,
            "updated_at": now,
        }}
    )

    # Reset all players (including streak)
    await db.players.update_many(
        {"session_id": session_id},
        {"$set": {
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
            "updated_at": now,
        }}
    )

    # Rotate tokens so persisted client sessions become invalid after reset.
    async for p in db.players.find({"session_id": session_id}, {"_id": 1}):
        await db.players.update_one(
            {"_id": p["_id"]},
            {"$set": {"token": str(uuid.uuid4()), "updated_at": now}}
        )

    # Delete answers for players in this session
    if player_ids:
        await db.player_answers.delete_many({"player_id": {"$in": player_ids}})

    await ws_manager.broadcast_to_session(session_id, {
        "type": events.PLAYER_SESSION_RESET,
        "data": {"session_id": session_id, "reason": "admin_reset"},
    })

    await ws_manager.broadcast_to_session(session_id, {
        "type": events.SESSION_UPDATED,
        "data": {"session_id": session_id, "status": "waiting"},
    })
    await _broadcast_leaderboard(session_id)

    return {"success": True}


# ─── Player Management ─────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/players", dependencies=[Depends(verify_admin_token)])
async def list_players(session_id: str):
    db = get_db()
    cursor = db.players.find({"session_id": session_id}).sort([("score", -1), ("sort_elapsed_seconds", 1)])
    players = []
    async for p in cursor:
        players.append({
            "id": str(p["_id"]),
            "session_id": p["session_id"],
            "name": p["name"],
            "score": p["score"],
            "attempted_count": p.get("attempted_count", 0),
            "final_formula_score": p.get("final_formula_score", 0.0),
            "elapsed_seconds": p.get("elapsed_seconds"),
            "current_question_index": p.get("current_question_index", 0),
            "consecutive_correct": p.get("consecutive_correct", 0),
            "is_frozen": p.get("is_frozen", False),
            "has_shield": p.get("has_shield", False),
            "skip_count": p.get("skip_count", 0),
            "registered_username": p.get("registered_username"),
            "created_at": p.get("created_at"),
        })
    return players


@router.patch("/players/{player_id}/score", dependencies=[Depends(verify_admin_token)])
async def update_player_score(player_id: str, data: dict):
    db = get_db()
    score = data.get("score")
    if score is None:
        raise HTTPException(400, "score required")

    player = await db.players.find_one({"_id": ObjectId(player_id)})
    if not player:
        raise HTTPException(404, "Player not found")

    await db.players.update_one(
        {"_id": ObjectId(player_id)},
        {"$set": {"score": score, "updated_at": datetime.now(timezone.utc)}}
    )
    await _broadcast_leaderboard(player["session_id"])
    return {"success": True, "score": score}


@router.delete("/players/{player_id}", dependencies=[Depends(verify_admin_token)])
async def remove_player(player_id: str):
    db = get_db()
    player = await db.players.find_one({"_id": ObjectId(player_id)})
    if not player:
        raise HTTPException(404, "Player not found")

    session_id = player["session_id"]
    await db.players.delete_one({"_id": ObjectId(player_id)})
    await db.player_answers.delete_many({"player_id": player_id})

    await ws_manager.broadcast_to_session(session_id, {
        "type": events.PLAYER_LEFT,
        "data": {"player_id": player_id, "name": player["name"]},
    })
    await _broadcast_leaderboard(session_id)

    return {"success": True}


@router.post("/players/{player_id}/freeze", dependencies=[Depends(verify_admin_token)])
async def admin_freeze_player(player_id: str, data: Optional[dict] = None):
    db = get_db()
    duration = (data or {}).get("duration_seconds", 60)
    now = datetime.now(timezone.utc)

    player = await db.players.find_one({"_id": ObjectId(player_id)})
    if not player:
        raise HTTPException(404, "Player not found")

    frozen_until = datetime.fromtimestamp(now.timestamp() + duration, tz=timezone.utc)
    await db.players.update_one(
        {"_id": ObjectId(player_id)},
        {"$set": {"is_frozen": True, "frozen_until": frozen_until, "updated_at": now}}
    )

    session_id = player["session_id"]
    await ws_manager.broadcast_to_session(session_id, {
        "type": events.PLAYER_FROZEN,
        "data": {"player_id": player_id, "frozen_by": "admin", "duration": duration},
    })

    # Auto-unfreeze
    from app.routers.powerups import _auto_unfreeze
    asyncio.create_task(_auto_unfreeze(player_id, session_id, duration))

    return {"success": True, "duration_seconds": duration}


# ─── Question Management ───────────────────────────────────────────────────

@router.get("/questions", dependencies=[Depends(verify_admin_token)])
async def list_questions(active: Optional[bool] = None, category: Optional[str] = None, difficulty: Optional[str] = None, session_id: Optional[str] = None):
    db = get_db()
    query: dict[str, object] = {}
    if active is not None:
        query["active"] = active
    if category:
        query["category"] = category
    if difficulty:
        query["difficulty"] = difficulty

    hidden_for_session = set()
    if session_id:
        async for row in db.session_hidden_questions.find({"session_id": session_id}, {"question_id": 1}):
            hidden_for_session.add(row["question_id"])

    cursor = db.questions.find(query).sort("order", 1)
    questions = []
    async for q in cursor:
        questions.append({
            "id": str(q["_id"]),
            "question": q["question"],
            "options": q["options"],
            "correct": q["correct"],
            "category": q.get("category"),
            "difficulty": q.get("difficulty"),
            "active": q.get("active", True),
            "hidden_in_session": str(q["_id"]) in hidden_for_session,
            "order": q.get("order", 0),
            "created_at": q.get("created_at"),
            "updated_at": q.get("updated_at"),
        })
    return questions


@router.post("/questions", dependencies=[Depends(verify_admin_token)])
async def create_question(data: dict):
    db = get_db()
    now = datetime.now(timezone.utc)

    # Auto-assign order
    last = await db.questions.find_one(sort=[("order", -1)])
    next_order = (last["order"] + 1) if last and "order" in last else 1

    doc = {
        "question": data["question"],
        "options": data["options"],
        "correct": data["correct"],
        "category": data.get("category", "General"),
        "difficulty": data.get("difficulty", "medium"),
        "active": data.get("active", True),
        "order": data.get("order", next_order),
        "created_at": now,
        "updated_at": now,
    }

    result = await db.questions.insert_one(doc)

    session_id = data.get("session_id")
    if session_id:
        await db.session_hidden_questions.delete_one({
            "session_id": session_id,
            "question_id": str(result.inserted_id),
        })

    doc["id"] = str(result.inserted_id)
    doc["hidden_in_session"] = False
    return doc


@router.patch("/questions/{question_id}", dependencies=[Depends(verify_admin_token)])
async def update_question(question_id: str, data: dict):
    db = get_db()
    data["updated_at"] = datetime.now(timezone.utc)

    # Remove any None values and id field
    update_data = {k: v for k, v in data.items() if v is not None and k != "id"}

    await db.questions.update_one(
        {"_id": ObjectId(question_id)},
        {"$set": update_data}
    )

    q = await db.questions.find_one({"_id": ObjectId(question_id)})
    if not q:
        raise HTTPException(404, "Question not found")

    return {
        "id": str(q["_id"]),
        "question": q["question"],
        "options": q["options"],
        "correct": q["correct"],
        "category": q.get("category"),
        "difficulty": q.get("difficulty"),
        "active": q.get("active", True),
        "order": q.get("order", 0),
    }


@router.delete("/questions/{question_id}", dependencies=[Depends(verify_admin_token)])
async def delete_question(question_id: str, mode: str = Query("hard"), session_id: str = Query(None)):
    db = get_db()
    q = await db.questions.find_one({"_id": ObjectId(question_id)})
    if not q:
        raise HTTPException(404, "Question not found")

    if mode == "hard":
        await db.questions.delete_one({"_id": ObjectId(question_id)})
        await db.session_hidden_questions.delete_many({"question_id": question_id})
        return {"success": True, "deleted": "hard"}

    if mode == "hide_session":
        if not session_id:
            raise HTTPException(400, "session_id is required for hide_session mode")
        await db.session_hidden_questions.update_one(
            {"session_id": session_id, "question_id": question_id},
            {
                "$set": {
                    "session_id": session_id,
                    "question_id": question_id,
                    "updated_at": datetime.now(timezone.utc),
                },
                "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )
        return {"success": True, "deleted": "hide_session", "session_id": session_id}

    raise HTTPException(400, "mode must be one of: hard, hide_session")


@router.post("/questions/{question_id}/session-visibility", dependencies=[Depends(verify_admin_token)])
async def set_session_question_visibility(question_id: str, data: dict):
    db = get_db()
    session_id = data.get("session_id")
    hidden = bool(data.get("hidden", False))

    if not session_id:
        raise HTTPException(400, "session_id required")

    q = await db.questions.find_one({"_id": ObjectId(question_id)})
    if not q:
        raise HTTPException(404, "Question not found")

    if hidden:
        await db.session_hidden_questions.update_one(
            {"session_id": session_id, "question_id": question_id},
            {
                "$set": {
                    "session_id": session_id,
                    "question_id": question_id,
                    "updated_at": datetime.now(timezone.utc),
                },
                "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )
    else:
        await db.session_hidden_questions.delete_one({"session_id": session_id, "question_id": question_id})

    return {"success": True, "session_id": session_id, "question_id": question_id, "hidden": hidden}


@router.post("/questions/reorder", dependencies=[Depends(verify_admin_token)])
async def reorder_questions(data: dict):
    db = get_db()
    question_ids = data.get("question_ids", [])
    now = datetime.now(timezone.utc)

    for i, qid in enumerate(question_ids):
        await db.questions.update_one(
            {"_id": ObjectId(qid)},
            {"$set": {"order": i + 1, "updated_at": now}}
        )
    return {"success": True, "count": len(question_ids)}


@router.post("/questions/import", dependencies=[Depends(verify_admin_token)])
async def import_questions(data: dict):
    db = get_db()
    questions = data.get("questions", [])
    now = datetime.now(timezone.utc)

    # Get current max order
    last = await db.questions.find_one(sort=[("order", -1)])
    next_order = (last["order"] + 1) if last and "order" in last else 1

    docs = []
    for i, q in enumerate(questions):
        docs.append({
            "question": q["question"],
            "options": q["options"],
            "correct": q["correct"],
            "category": q.get("category", "General"),
            "difficulty": q.get("difficulty", "medium"),
            "active": q.get("active", True),
            "order": q.get("order", next_order + i),
            "created_at": now,
            "updated_at": now,
        })

    if docs:
        await db.questions.insert_many(docs)

    return {"success": True, "imported": len(docs)}
