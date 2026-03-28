from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings
from passlib.hash import bcrypt
from datetime import datetime, timezone
import certifi
import logging

client: AsyncIOMotorClient = None
db = None
logger = logging.getLogger("api.database")

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
    try:
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
    except Exception as e:
        logger.warning("Failed to seed test accounts (non-fatal): %s", e)


from bson.codec_options import CodecOptions


def _build_mongo_client() -> AsyncIOMotorClient:
    client_kwargs = {
        "serverSelectionTimeoutMS": 10000,
        "connectTimeoutMS": 10000,
        "socketTimeoutMS": 10000,
    }

    # Atlas/SRV uses TLS by default; local mongodb:// typically does not.
    if settings.mongo_uri.startswith("mongodb+srv://"):
        client_kwargs["tlsCAFile"] = certifi.where()

    return AsyncIOMotorClient(settings.mongo_uri, **client_kwargs)


async def connect_db():
    global client, db
    try:
        client = _build_mongo_client()
        await client.admin.command("ping")
        db = client.get_database(settings.mongo_db_name, codec_options=CodecOptions(tz_aware=True))

        # Create indexes
        await db.players.create_index([("session_id", 1)])
        await db.players.create_index([("token", 1)], unique=True)
        await db.player_answers.create_index(
            [("player_id", 1), ("question_index", 1)], unique=True
        )
        await db.player_answers.create_index([("player_id", 1), ("is_correct", 1)])
        await db.powerup_events.create_index([("session_id", 1), ("created_at", -1)])
        await db.questions.create_index([("order", 1)])
        await db.registered_players.create_index([("username", 1)], unique=True)
        await db.question_deliveries.create_index(
            [("player_id", 1), ("question_index", 1)], unique=True
        )
        await db.session_hidden_questions.create_index(
            [("session_id", 1), ("question_id", 1)], unique=True
        )
        await db.session_hidden_questions.create_index([("session_id", 1)])
        await db.session_leaderboards.create_index([("session_id", 1), ("created_at", -1)])
        await db.session_leaderboards.create_index([("trigger", 1), ("created_at", -1)])
        await db.session_leaderboards.create_index([("session_id", 1), ("trigger", 1)], unique=True)

        # Seed test accounts
        await _seed_test_accounts()
        logger.info("MongoDB connected to '%s'", settings.mongo_db_name)
    except Exception:
        logger.exception(
            "MongoDB startup failed. Verify MONGO_URI, credentials, and Atlas Network Access."
        )
        raise


async def close_db():
    global client
    if client:
        client.close()
        logger.info("MongoDB client closed")


def get_db():
    return db
