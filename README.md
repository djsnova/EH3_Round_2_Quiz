# Event Horizon 3.0

> A multiplayer space-themed quiz platform by **DJS Nova** — real-time gameplay with powerups, leaderboards, streak bonuses, and an admin control center.

## Project Structure

```
event-horizon/
├── backend/          # FastAPI + MongoDB + WebSockets
│   ├── app/
│   │   ├── main.py           # Entry point + WebSocket endpoints
│   │   ├── config.py         # Settings, game constants & streak tiers
│   │   ├── database.py       # MongoDB connection + test account seeding
│   │   ├── seed.py           # Seed 25 questions
│   │   ├── routers/
│   │   │   ├── auth.py       # Player login (username/password)
│   │   │   ├── game.py       # Join, session, leaderboard
│   │   │   ├── questions.py  # Answer, timeout (with streak scoring)
│   │   │   ├── powerups.py   # Freeze, Shield, Skip (atomic operations)
│   │   │   └── admin.py      # Admin CRUD + player registration
│   │   └── ws/               # WebSocket manager & events
│   ├── requirements.txt
│   ├── Dockerfile
│   └── DEPLOYMENT.md
├── frontend/         # React + Vite + TypeScript + Tailwind
│   ├── src/
│   │   ├── lib/api.ts        # API client (auth, game, admin)
│   │   ├── lib/ws.ts         # WebSocket client
│   │   ├── lib/GameContext.tsx
│   │   ├── pages/            # Index (login), Quiz, Admin
│   │   └── components/       # QuizCard, Leaderboard, PowerupsPanel, etc.
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml
└── README.md
```

---

## Quick Start

### 1. Start the Backend

```bash
cd backend
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt

# Seed questions (first time only)
python -m app.seed

# Start the server (5 test accounts are auto-seeded on startup)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The API docs are available at **http://localhost:8000/api/docs**

### 2. Start the Frontend Dev Server

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:8080** in your browser. The Vite dev server proxies `/api` and `/ws` to the backend automatically.

---

## Test Accounts

The following test accounts are automatically seeded on first startup:

| Username   | Password   | Display Name |
|-----------|-----------|-------------|
| `player1` | `test1234` | Player 1    |
| `player2` | `test1234` | Player 2    |
| `player3` | `test1234` | Player 3    |
| `player4` | `test1234` | Player 4    |
| `player5` | `test1234` | Player 5    |

> **Note:** Additional players can be registered by the admin via the **Registered Players** tab in the admin panel, either individually or via JSON bulk import.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Example |
|---|---|---|
| `MONGO_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/` |
| `MONGO_DB_NAME` | Database name | `event_horizon` |
| `ADMIN_SECRET_TOKEN` | Secret token for admin API | (min 32 chars — **must be changed from default!**) |
| `CORS_ORIGINS` | Allowed origins (JSON array) | `["http://localhost:8080"]` |

### Frontend (`frontend/.env`)

| Variable | Description | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Backend API base URL | (empty — uses Vite proxy) |
| `VITE_WS_BASE_URL` | Backend WebSocket URL | (empty — uses Vite proxy) |

---

## Player Registration (Whitelisting)

Players must have an account to join the quiz. The admin manages accounts:

### Option A: Admin Panel UI

1. Navigate to **http://localhost:8080/admin**
2. Enter the admin token
3. Click the **Registered Players** tab
4. Add players individually or **Import JSON** in bulk

### Option B: API (Bulk Import)

```bash
curl -X POST http://localhost:8000/api/v1/admin/players/register/bulk \
  -H "X-Admin-Token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "players": [
      {"username": "alice", "password": "pass123", "display_name": "Alice"},
      {"username": "bob", "password": "pass456", "display_name": "Bob"}
    ]
  }'
```

---

## Editing Questions

Questions are stored in MongoDB and managed through the **Admin Panel**.

### Option A: Admin Panel UI

1. Navigate to **http://localhost:8080/admin**
2. Enter the admin token (set in `backend/.env` as `ADMIN_SECRET_TOKEN`)
3. Click the **Questions** tab
4. From here you can:
   - **Add** a new question (click "+ Add Question")
   - **Edit** any existing question (click the pencil icon)
   - **Activate/Deactivate** questions (click the eye icon)
   - **Delete** questions (click the trash icon)
   - **Import** questions in bulk via JSON (click "Import JSON")

### Option B: Seed Script (Initial Load)

The seed script inserts the default 25 astronomy questions:

```bash
cd backend
venv\Scripts\activate          # Windows
python -m app.seed
```

> This only runs if the questions collection is empty. To reseed, drop the collection first from MongoDB shell or Atlas UI.

### Option C: API (Programmatic)

Use the admin API endpoints directly:

```bash
# List all questions
curl -H "X-Admin-Token: YOUR_TOKEN" http://localhost:8000/api/v1/admin/questions

# Add a question
curl -X POST http://localhost:8000/api/v1/admin/questions \
  -H "X-Admin-Token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is the largest planet?",
    "options": ["Earth", "Mars", "Jupiter", "Saturn"],
    "correct": 2,
    "category": "Solar System",
    "difficulty": "easy"
  }'

# Bulk import
curl -X POST http://localhost:8000/api/v1/admin/questions/import \
  -H "X-Admin-Token: YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"questions": [...]}'
```

---

## Game Features

- **Player Login** — whitelisted username/password authentication; admin pre-registers participants
- **Real-time multiplayer** — players join a session and answer independently
- **Streak Bonuses** — 3+ correct streak: +40/−30 pts · 7+ correct streak: +50/−20 pts & 10pt powerup discount
- **Powerups** — Freeze (lock opponents), Shield (block freezes), Skip (limited free passes)
- **Leaderboard** — live score updates via WebSocket
- **Admin Controls** — start/pause/reset game, manage players, questions, and registered accounts
- **Security** — server-side question validation, session ownership checks, atomic powerup operations, session-gated actions

---

## Deployment

See [`backend/DEPLOYMENT.md`](backend/DEPLOYMENT.md) for deploying to Hugging Face Spaces, Railway, or Render.
