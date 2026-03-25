from fastapi import APIRouter, HTTPException, Request
from app.database import get_db
from passlib.hash import bcrypt
from datetime import datetime, timezone
import uuid

router = APIRouter()

# Rate limiter — imported from main where it's initialized
from app.main import limiter


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, data: dict):
    """Authenticate a registered player. Returns a session token."""
    db = get_db()
    username = (data.get("username") or "").strip().lower()
    password = data.get("password") or ""

    if not username or not password:
        raise HTTPException(400, "Username and password required")

    account = await db.registered_players.find_one({"username": username})
    if not account:
        raise HTTPException(401, "Invalid username or password")

    if not bcrypt.verify(password, account["password_hash"]):
        raise HTTPException(401, "Invalid username or password")

    # Generate a fresh player token for this session
    player_token = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    await db.registered_players.update_one(
        {"_id": account["_id"]},
        {"$set": {
            "current_token": player_token,
            "last_login": now,
        }}
    )

    return {
        "player_token": player_token,
        "display_name": account.get("display_name", account["username"]),
        "username": account["username"],
    }
