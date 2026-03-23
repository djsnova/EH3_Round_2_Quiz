"""
Seed script — imports the 25 quiz questions into MongoDB.
Run once:  cd backend && python -m app.seed
"""
import asyncio
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from app.config import settings

QUESTIONS = [
    {"question": "Which constellation contains the Great Nebula (M42)?", "options": ["Taurus", "Orion", "Perseus", "Cygnus"], "correct": 1, "category": "Constellations", "difficulty": "easy"},
    {"question": "Which star is the brightest in the night sky?", "options": ["Vega", "Polaris", "Sirius", "Rigel"], "correct": 2, "category": "Stars", "difficulty": "easy"},
    {"question": "Which of the following is NOT a type of galaxy?", "options": ["Spiral", "Elliptical", "Irregular", "Radial"], "correct": 3, "category": "Galaxies", "difficulty": "easy"},
    {"question": "Which layer of the Sun is visible during a total solar eclipse?", "options": ["Photosphere", "Chromosphere", "Corona", "Core"], "correct": 2, "category": "Solar System", "difficulty": "medium"},
    {"question": "Which constellation is known as 'The Hunter'?", "options": ["Leo", "Orion", "Scorpius", "Perseus"], "correct": 1, "category": "Constellations", "difficulty": "easy"},
    {"question": "What is the boundary around a black hole beyond which nothing can escape?", "options": ["Singularity", "Photon Sphere", "Event Horizon", "Accretion Disk"], "correct": 2, "category": "Black Holes", "difficulty": "medium"},
    {"question": "Which law explains the expansion of the universe?", "options": ["Doppler Effect", "Hubble's Law", "Kepler's Law", "Newton's Law"], "correct": 1, "category": "Cosmology", "difficulty": "medium"},
    {"question": "If one star shows redshift and another blueshift, what does it mean?", "options": ["One is hotter", "One is larger", "One is moving away, the other toward us", "One is older"], "correct": 2, "category": "Spectroscopy", "difficulty": "medium"},
    {"question": "Why don't we observe parallax shifts easily for distant stars?", "options": ["Stars don't move", "Telescopes are weak", "Distances are extremely large", "Light bends"], "correct": 2, "category": "Observation", "difficulty": "medium"},
    {"question": "Two stars have same temperature but one is brighter. Why?", "options": ["It is closer", "It is older", "It is moving faster", "It has more planets"], "correct": 0, "category": "Stars", "difficulty": "medium"},
    {"question": "If the Sun disappeared, when would Earth notice?", "options": ["Immediately", "After 8 minutes", "After 1 day", "After 1 year"], "correct": 1, "category": "Solar System", "difficulty": "easy"},
    {"question": "Which constellation is known as 'The Swan'?", "options": ["Lyra", "Cygnus", "Aquila", "Pegasus"], "correct": 1, "category": "Constellations", "difficulty": "easy"},
    {"question": "Why is Polaris useful for navigation?", "options": ["It is brightest", "It stays nearly fixed", "It rotates fastest", "It is closest"], "correct": 1, "category": "Navigation", "difficulty": "easy"},
    {"question": "Which law relates orbital period and distance from the Sun?", "options": ["Newton's First Law", "Kepler's First Law", "Kepler's Second Law", "Kepler's Third Law"], "correct": 3, "category": "Orbital Mechanics", "difficulty": "medium"},
    {"question": "What happens to constellations over millions of years?", "options": ["Stay same", "Shift slightly", "Completely change shapes", "Disappear"], "correct": 2, "category": "Constellations", "difficulty": "hard"},
    {"question": "Irregular blinking of a star is LEAST likely caused by?", "options": ["Atmospheric distortion", "Instrument error", "Alien signal", "Dust interference"], "correct": 2, "category": "Observation", "difficulty": "hard"},
    {"question": "Which situation increases redshift?", "options": ["Galaxy moving toward us", "Galaxy moving away faster", "Galaxy cooling", "Galaxy shrinking"], "correct": 1, "category": "Spectroscopy", "difficulty": "medium"},
    {"question": "What does the Drake Equation estimate?", "options": ["Life probability on one planet", "Number of communicative civilizations", "Total habitable planets", "Interstellar travel likelihood"], "correct": 1, "category": "Astrobiology", "difficulty": "medium"},
    {"question": "If a blue and red star appear equally bright, which is farther?", "options": ["Blue star", "Red star", "Same distance", "Cannot determine"], "correct": 0, "category": "Stars", "difficulty": "hard"},
    {"question": "If light speed were infinite, what would change?", "options": ["Star colors", "We'd see stars in real-time", "Gravity disappears", "Constellations vanish"], "correct": 1, "category": "Physics", "difficulty": "hard"},
    {"question": "Strongest evidence for universe expansion?", "options": ["Star brightness", "Galaxy redshift", "Constellation motion", "Planet orbits"], "correct": 1, "category": "Cosmology", "difficulty": "medium"},
    {"question": "If a star moves perpendicular to us, what do we observe?", "options": ["Redshift", "Blueshift", "No shift", "Brightness increase"], "correct": 2, "category": "Spectroscopy", "difficulty": "hard"},
    {"question": "From the Moon, how would constellations appear?", "options": ["Completely different", "Same but clearer", "Invisible", "Rotating faster"], "correct": 1, "category": "Observation", "difficulty": "hard"},
    {"question": "What is panspermia?", "options": ["Planet formation", "Life on every planet", "Life spreading via space", "Artificial life creation"], "correct": 2, "category": "Astrobiology", "difficulty": "medium"},
    {"question": "If a star becomes 4x farther, brightness becomes?", "options": ["2x dimmer", "4x dimmer", "8x dimmer", "16x dimmer"], "correct": 3, "category": "Physics", "difficulty": "hard"},
]


async def seed():
    client = AsyncIOMotorClient(settings.mongo_uri)
    db = client[settings.mongo_db_name]

    # Check if questions already exist
    count = await db.questions.count_documents({})
    if count > 0:
        print(f"Questions collection already has {count} documents. Skipping seed.")
        print("To re-seed, drop the 'questions' collection first:")
        print(f"  db.questions.drop()")
        client.close()
        return

    now = datetime.now(timezone.utc)
    docs = []
    for i, q in enumerate(QUESTIONS):
        docs.append({
            **q,
            "active": True,
            "order": i + 1,
            "created_at": now,
            "updated_at": now,
        })

    result = await db.questions.insert_many(docs)
    print(f"Seeded {len(result.inserted_ids)} questions into '{settings.mongo_db_name}.questions'")
    client.close()


if __name__ == "__main__":
    asyncio.run(seed())
