import asyncio
from motor.motor_asyncio import AsyncIOMotorClient

async def main():
    try:
        c = AsyncIOMotorClient("mongodb://localhost:27017", tz_aware=True)
        print("Motor client created successfully!")
    except Exception as e:
        print("ERROR:", e)

asyncio.run(main())
