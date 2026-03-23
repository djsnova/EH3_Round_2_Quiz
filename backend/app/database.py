from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings
from passlib.hash import bcrypt
from datetime import datetime, timezone

client: AsyncIOMotorClient = None
db = None

# Test accounts seeded on first run
TEST_ACCOUNTS = [
    {"username": "player1", "password": "test1234", "display_name": "Player 1"},
    {"username": "player2", "password": "test1234", "display_name": "Player 2"},
    {"username": "player3", "password": "test1234", "display_name": "Player 3"},
    {"username": "player4", "password": "test1234", "display_name": "Player 4"},
    {"username": "player5", "password": "test1234", "display_name": "Player 5"},
]


async def _seed_test_accounts():
    """Insert test accounts if they don't exist yet."""
    now = datetime.now(timezone.utc)
    for acct in TEST_ACCOUNTS:
        existing = await db.registered_players.find_one({"username": acct["username"]})
        if not existing:
            await db.registered_players.insert_one({
                "username": acct["username"],
                "password_hash": bcrypt.hash(acct["password"]),
                "display_name": acct["display_name"],
                "current_token": None,
                "last_login": None,
                "created_at": now,
            })
            print(f"  Seeded test account: {acct['username']}")


async def connect_db():
    global client, db
    client = AsyncIOMotorClient(settings.mongo_uri)
    db = client[settings.mongo_db_name]
    # Create indexes
    await db.players.create_index([("session_id", 1)])
    await db.players.create_index([("token", 1)], unique=True)
    await db.player_answers.create_index(
        [("player_id", 1), ("question_index", 1)], unique=True
    )
    await db.powerup_events.create_index([("session_id", 1), ("created_at", -1)])
    await db.questions.create_index([("order", 1)])
    await db.registered_players.create_index([("username", 1)], unique=True)

    # Seed test accounts
    await _seed_test_accounts()

    print("MongoDB connected")


async def close_db():
    global client
    if client:
        client.close()


def get_db():
    return db
