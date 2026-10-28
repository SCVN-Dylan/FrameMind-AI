# FrameMind AI

FrameMind AI compares two gameplay videos — a **Reference** video (the expected result) and a **Current** video (your current implementation) — and uses AI vision to produce visual feedback for Unity developers: differences in camera, layout, lighting, colors, animation and VFX, with suggested fixes and timestamps.

> **Status:** Milestones 01–05 done. Videos are uploaded to the backend, sessions and frame/clip pairs are saved in SQLite, and FFmpeg extracts frames. AI analysis (Milestone 06) is not implemented yet: all feedback is labelled **Demo**. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Tech stack

| Layer            | Technology                           |
| ---------------- | ------------------------------------ |
| Frontend         | Next.js 16 (App Router), TypeScript, Tailwind CSS 4 |
| Backend          | Python 3.12 (3.9+ works), FastAPI, Uvicorn |
| Database         | SQLite (via SQLAlchemy)              |
| Video processing | FFmpeg + FFprobe (via subprocess)    |
| AI               | OpenAI vision-capable model (Milestone 06) |

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
- Python 3.11+ recommended (3.9 still works; the dev machine uses Homebrew `python@3.12`)
- FFmpeg + FFprobe (required for upload and frame extraction)

Install on macOS with Homebrew:

```bash
brew install ffmpeg python@3.12
ffmpeg -version && ffprobe -version   # both must print a version
```

## Installation

### 1. Backend

```bash
cd backend
python3.12 -m venv .venv            # or python3 -m venv .venv
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

## Where data is stored

Everything lives under `storage/` (set `STORAGE_DIR` in `backend/.env` to move it). It is git-ignored.

| What | Location | Notes |
| --- | --- | --- |
| Uploaded videos | `storage/videos/<uuid>.<ext>` | Never named after the original file; the original name is metadata in SQLite |
| Extracted frames | `storage/frames/<session>/<pair>/<run>/reference_000.jpg`, `current_000.jpg`, … | Only the latest run per pair is kept |
| Database | `storage/framemind.db` | Tables: `videos`, `analysis_sessions`, `matching_pairs`, `extracted_media` |

Interrupted uploads (`*.part`) and extractions (`.tmp-*` folders) are removed when the backend starts.

## API

Interactive docs with every request/response shape: http://localhost:8000/docs. Errors always look like
`{"error": {"code": "...", "message": "...", "details": ...}}`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Status of database, storage, FFmpeg, OpenAI key |
| POST | `/api/videos?filename=<name>` | Upload a video (raw bytes, `application/octet-stream`, streamed to disk, ≤ 1 GB) |
| GET | `/api/videos/{id}` | Video metadata (duration, size, resolution, fps, codec) |
| GET | `/api/videos/{id}/file` | Stream the video (supports HTTP range / seeking) |
| GET / POST | `/api/sessions` | List sessions / create a session |
| GET / PATCH / DELETE | `/api/sessions/{id}` | Session with videos and pairs / update name, videos, mode / delete |
| GET / POST | `/api/sessions/{id}/pairs` | List / create frame or clip pairs |
| PATCH / DELETE | `/api/sessions/{id}/pairs/{pair_id}` | Update / delete a pair |
| POST | `/api/sessions/{id}/pairs/{pair_id}/extract[?force=true]` | Extract frames for a pair with FFmpeg |
| GET | `/api/sessions/{id}/pairs/{pair_id}/media` | Frames already extracted for a pair |
| GET | `/api/media/{id}` · `/api/media/{id}/file` | Extracted image metadata · the JPEG |

Deleting a session removes its pairs and extracted frames; a video is deleted only when no session uses it.
Replacing a session's video removes its extracted frames and the pairs that no longer fit the new video.

## Using the app

1. Open http://localhost:3000/analysis/new and drop a Reference and a Current video. Each one plays locally
   right away while it uploads (progress bar → "Saved to server"). The first upload creates a session and the
   URL becomes `/analysis/new?session=<id>`.
2. **Single Frame:** pause each video on the same gameplay event (the times may differ, e.g. 10 s ↔ 15 s),
   add the pair, select it, then click **Extract frames** in *Extracted Frames*: one image per video.
3. **Short Clip:** set Start/End in each video (each 0.1–10 s, lengths may differ), add the pair, select it,
   then **Extract frames**: an ordered frame sequence per video (8 fps, max 40 frames per clip by default;
   see `CLIP_SAMPLE_FPS` / `CLIP_MAX_FRAMES`). Click a thumbnail to seek that video to it.
4. **Full Video:** UI only. No extraction or analysis yet.
5. Refresh the page: videos, pairs, mode and extracted frames come back. Saved sessions are listed in
   **Analysis History** (open or delete them there).

The "Analyze" button is still **Demo** — it only shows sample feedback.

## Checks

```bash
# Backend tests (tiny test videos are generated with FFmpeg; those tests are skipped without it)
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
| `backend/.env`        | `MAX_UPLOAD_BYTES`    | Upload limit per video (default 1 GB)    |
| `backend/.env`        | `CLIP_SAMPLE_FPS`, `CLIP_MAX_FRAMES` | Short Clip sampling rate (default 8) and cap per clip (default 40) |
| `backend/.env`        | `FRAME_MAX_WIDTH`     | Extracted frames are scaled down to this width (default 1280) |
| `backend/.env`        | `FFMPEG_TIMEOUT_SECONDS`, `FFPROBE_TIMEOUT_SECONDS`, `MAX_CONCURRENT_EXTRACTIONS` | FFmpeg limits (defaults 120 s, 30 s, 2 jobs) |
| `frontend/.env.local` | `NEXT_PUBLIC_API_URL` | Backend URL the browser calls            |
