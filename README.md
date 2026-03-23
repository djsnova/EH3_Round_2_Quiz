# Event Horizon 3.0

> A multiplayer space-themed quiz platform by **DJS Nova** — real-time gameplay with powerups, leaderboards, and an admin control center.

## Project Structure

```
event-horizon/
├── backend/          # FastAPI + MongoDB + WebSockets
│   ├── app/
│   │   ├── main.py           # Entry point
│   │   ├── config.py         # Settings & game constants
│   │   ├── database.py       # MongoDB connection
│   │   ├── seed.py           # Seed 25 questions
│   │   ├── models/           # Pydantic schemas
│   │   ├── routers/          # API routes (game, questions, powerups, admin)
│   │   └── ws/               # WebSocket manager & events
│   ├── requirements.txt
│   ├── Dockerfile
│   └── DEPLOYMENT.md
├── frontend/         # React + Vite + TypeScript + Tailwind
│   ├── src/
│   │   ├── lib/api.ts        # API client
│   │   ├── lib/ws.ts         # WebSocket client
│   │   ├── lib/GameContext.tsx
│   │   ├── pages/            # Index, Quiz, Admin
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

# Start the server
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

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Example |
|---|---|---|
| `MONGO_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/` |
| `MONGO_DB_NAME` | Database name | `event_horizon` |
| `ADMIN_SECRET_TOKEN` | Secret token for admin API | (min 32 chars) |
| `CORS_ORIGINS` | Allowed origins (JSON array) | `["http://localhost:8080"]` |

### Frontend (`frontend/.env`)

| Variable | Description | Default |
|---|---|---|
| `VITE_API_BASE_URL` | Backend API base URL | (empty — uses Vite proxy) |
| `VITE_WS_BASE_URL` | Backend WebSocket URL | (empty — uses Vite proxy) |

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

- **Real-time multiplayer** — players join a session and answer independently
- **Powerups** — Freeze (lock opponents), Shield (block freezes), Skip (limited free passes)
- **Leaderboard** — live score updates via WebSocket
- **Admin Controls** — start/pause/reset game, manage players and questions
- **Secure** — questions served one-at-a-time from the server; answers never exposed to the client

---

## Deployment

See [`backend/DEPLOYMENT.md`](backend/DEPLOYMENT.md) for deploying to Hugging Face Spaces, Railway, or Render.
