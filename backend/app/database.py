from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings

client: AsyncIOMotorClient = None
db = None


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
    print("MongoDB connected")


async def close_db():
    global client
    if client:
        client.close()


def get_db():
    return db
