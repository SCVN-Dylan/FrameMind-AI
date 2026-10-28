# FrameMind AI

FrameMind AI compares two gameplay videos — a **Reference** video (the expected result) and a **Current** video (your current implementation) — and uses AI vision to produce visual feedback for Unity developers: differences in camera, layout, lighting, colors, animation and VFX, with suggested fixes and timestamps.

> **Status:** Milestone 0 (project setup). Video upload, frame extraction and AI analysis are not implemented yet. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Tech stack

| Layer            | Technology                           |
| ---------------- | ------------------------------------ |
| Frontend         | Next.js 16 (App Router), TypeScript, Tailwind CSS 4 |
| Backend          | Python 3.9+, FastAPI, Uvicorn        |
| Database         | SQLite (via SQLAlchemy)              |
| Video processing | FFmpeg (later milestone)             |
| AI               | OpenAI vision-capable model (later milestone) |

## Project layout

```
framemind-ai/
├── frontend/   Next.js web app (UI)
├── backend/    FastAPI server (API, database, video + AI services)
├── storage/    Local files: uploaded videos, extracted frames, SQLite DB
└── docs/       Architecture, roadmap, progress
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js 20+ and npm
- Python 3.9+ (3.11+ recommended)
- FFmpeg (needed from Milestone 3; install now with `brew install ffmpeg` on macOS)

## Installation

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then edit .env if needed
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
```

## Running in development

Use two terminals.

**Terminal 1 — backend** (http://localhost:8000)

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

- Health check: http://localhost:8000/api/health
- Interactive API docs: http://localhost:8000/docs

**Terminal 2 — frontend** (http://localhost:3000)

```bash
cd frontend
npm run dev
```

Open http://localhost:3000. The homepage shows "FrameMind AI" and a status box that confirms the backend connection.

## Checks

```bash
# Backend tests
cd backend && source .venv/bin/activate && pytest

# Frontend lint + production build
cd frontend && npm run lint && npm run build
```

## Environment variables

Secrets live only in `backend/.env` (git-ignored). Never put API keys in frontend files — anything prefixed `NEXT_PUBLIC_` is visible in the browser.

| File                  | Variable              | Purpose                                  |
| --------------------- | --------------------- | ---------------------------------------- |
| `backend/.env`        | `FRONTEND_ORIGIN`     | URL allowed to call the API (CORS)       |
| `backend/.env`        | `STORAGE_DIR`         | Folder for videos, frames and the DB     |
| `backend/.env`        | `OPENAI_API_KEY`      | OpenAI key (used from the AI milestone)  |
| `backend/.env`        | `OPENAI_MODEL`        | Vision model name                        |
| `frontend/.env.local` | `NEXT_PUBLIC_API_URL` | Backend URL the browser calls            |
