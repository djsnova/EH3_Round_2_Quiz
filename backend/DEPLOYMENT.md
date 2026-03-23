# Deploying Event Horizon 3.0 Backend on Hugging Face Spaces

## Prerequisites
- A Hugging Face account ([huggingface.co](https://huggingface.co))
- The backend code in a Git repo
- MongoDB Atlas connection string (already configured)
- Python 3.10.11

## Step 1: Create a New Space

1. Go to [huggingface.co/spaces](https://huggingface.co/spaces)
2. Click **Create new Space**
3. Choose **Docker** as the SDK
4. Name it `event-horizon-api` (or your choice)
5. Set visibility to **Private** (recommended for game servers)

## Step 2: Configure Files

Create these files in the Space repo root:

### `Dockerfile`

```dockerfile
FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

# HF Spaces expects port 7860
EXPOSE 7860

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
```

### `requirements.txt`

Copy the existing `backend/requirements.txt` as-is.

### `app/`

Copy the entire `backend/app/` directory.

## Step 3: Set Environment Variables (Secrets)

In the Space settings → **Variables and secrets**, add:

| Variable | Value |
|---|---|
| `MONGO_URI` | `mongodb+srv://djsnova09_db_user:...@cluster0.bwdjaqx.mongodb.net/...` |
| `MONGO_DB_NAME` | `event_horizon` |
| `ADMIN_SECRET_TOKEN` | Your admin secret (min 32 chars) |
| `CORS_ORIGINS` | `["https://your-frontend-url.com"]` |
| `PORT` | `7860` |

> **IMPORTANT**: Mark `MONGO_URI` and `ADMIN_SECRET_TOKEN` as **Secrets** (hidden), not plain variables.

## Step 4: Update Backend Config for HF

The `config.py` already reads from environment variables, so no code changes needed. HF Spaces injects secrets as environment variables.

However, update the port default in `config.py` if deploying only to HF:

```python
port: int = 7860  # HF Spaces default
```

## Step 5: Push to HF Space

```bash
# Clone the Space
git clone https://huggingface.co/spaces/YOUR_USERNAME/event-horizon-api
cd event-horizon-api

# Copy backend files
cp -r /path/to/backend/requirements.txt .
cp -r /path/to/backend/app ./app
cp /path/to/backend/Dockerfile .

# Push
git add .
git commit -m "Initial deploy"
git push
```

HF will build and deploy automatically. Check the **Logs** tab.

## Step 6: Seed Questions

Once deployed, seed questions from your local machine:

```bash
# Set MONGO_URI to Atlas and run seed
MONGO_URI="mongodb+srv://..." python -m app.seed
```

Or use the admin API to import questions via the `/admin/questions/import` endpoint.

## Step 7: Update Frontend

Update your frontend `.env` to point to the HF Space:

```env
VITE_API_BASE_URL=https://YOUR_USERNAME-event-horizon-api.hf.space/api/v1
VITE_WS_BASE_URL=wss://YOUR_USERNAME-event-horizon-api.hf.space
```

## Step 8: Add IP Whitelist on Atlas

In MongoDB Atlas → **Network Access**, add the HF Spaces IP range or use `0.0.0.0/0` (allow all) for simplicity.

> **Security note**: For production, consider using Atlas VPC peering or restricting to known IPs.

## Troubleshooting

| Issue | Solution |
|---|---|
| Space fails to build | Check Dockerfile syntax, ensure Python 3.10-slim |
| MongoDB connection refused | Verify Atlas Network Access allows HF IPs |
| WebSocket disconnects | HF Spaces has a request timeout (~5min idle). Add ping/pong keepalive |
| CORS errors | Update `CORS_ORIGINS` in Space secrets to include frontend URL |
| Slow cold starts | HF free tier may sleep after inactivity. Upgrade to persistent Space |

## Alternative: Deploy on Railway or Render

If HF Spaces WebSocket limitations are a concern:

### Railway
1. Push backend to GitHub
2. Connect to [railway.app](https://railway.app)
3. Set env variables
4. Railway auto-detects Dockerfile

### Render
1. Push to GitHub
2. Create a new **Web Service** on [render.com](https://render.com)
3. Set root directory to `backend/`
4. Set build command: `pip install -r requirements.txt`
5. Set start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
6. Add env variables
