# Architecture

FrameMind AI is two small apps that talk over HTTP, plus a local folder for files.

```
┌──────────────────────┐   HTTP (JSON)   ┌──────────────────────────────┐
│  Frontend (Next.js)  │ ──────────────▶ │  Backend (FastAPI)           │
│  localhost:3000      │ ◀────────────── │  localhost:8000              │
└──────────────────────┘                 │   ├─ SQLite (metadata)       │
                                         │   ├─ storage/ (videos,frames)│
                                         │   ├─ FFmpeg (frame extract)  │
                                         │   └─ OpenAI API (analysis)   │
                                         └──────────────────────────────┘
```

The browser never talks to OpenAI or FFmpeg directly. All heavy work and all secrets stay in the backend.

## Folder structure

```
framemind-ai/
├── frontend/
│   └── src/
│       ├── app/              Pages (routes). page.tsx = "/" homepage
│       ├── components/       Reusable UI pieces (video players, analysis panels, history…)
│       ├── hooks/            useVideoPlayer, useMatchedMoments, useSessionSync (backend sync)
│       └── lib/api.ts        The only place that calls the backend
├── backend/
│   ├── app/
│   │   ├── main.py           Creates the FastAPI app, CORS, startup tasks
│   │   ├── api/
│   │   │   ├── router.py     Mounts every route module under /api
│   │   │   └── routes/       health.py, videos.py, sessions.py (sessions, pairs, extraction), media.py
│   │   ├── core/config.py    Settings read from backend/.env
│   │   ├── core/errors.py    AppError + one JSON error shape for the whole API
│   │   ├── db/database.py    SQLite engine, sessions, Base for models
│   │   ├── db/models.py      Video, AnalysisSession, MatchingPair, ExtractedMedia
│   │   ├── schemas/          Pydantic request/response shapes (API contracts)
│   │   └── services/         Business logic, no HTTP code
│   │       ├── storage.py    Local file storage paths (safe resolve, cleanup)
│   │       ├── videos.py     Streamed upload + validation, video ownership
│   │       ├── sessions.py   Sessions, replacement pruning, deletion rules
│   │       ├── pairs.py      Frame/clip pair validation (mirrors frontend rules)
│   │       ├── extraction.py Frame extraction runs, job limits, extracted media
│   │       ├── video/        ffmpeg.py: FFprobe metadata, frame + sequence extraction
│   │       └── ai/           OpenAI Vision: frame comparison + feedback
│   ├── tests/                pytest tests
│   └── requirements.txt
├── storage/
│   ├── videos/               Uploaded videos (git-ignored)
│   ├── frames/               Extracted frames (git-ignored)
│   └── framemind.db          SQLite database (created on first run, git-ignored)
└── docs/
```

## Module responsibilities

| Module | Responsibility | Must NOT |
| --- | --- | --- |
| `frontend/src/app` | Page layout and composition | Call `fetch` directly |
| `frontend/src/components` | Display + user interaction | Know backend URLs |
| `frontend/src/lib/api.ts` | Typed functions for each backend endpoint | Contain UI |
| `backend/app/api/routes` | Validate input, call services, return schemas | Contain FFmpeg/OpenAI logic |
| `backend/app/schemas` | Define JSON shapes in/out | Touch the database |
| `backend/app/services` | Do the actual work (files, FFmpeg, AI) | Know about HTTP |
| `backend/app/db` | Database connection and tables | Contain business rules |
| `backend/app/core` | Configuration | — |

Rule of thumb: **routes are thin, services are thick.** A route function should be a few lines that call a service.

## Data flow

### Today (Milestone 05)

1. **Pick videos** — the browser plays each file locally at once (object URL) and uploads it in the background:
   `POST /api/videos` streams the raw body to `storage/videos/<uuid>.part`, checks the file signature and size
   while streaming, renames it, then FFprobe reads metadata and FFmpeg decodes the first frame. Any failure
   deletes the file.
2. **Session** — the first finished upload creates an `analysis_sessions` row; later uploads `PATCH` it.
   `useSessionSync` runs session writes one at a time (no duplicate sessions) and puts `?session=<id>` in the URL.
3. **Pairs** — `useMatchedMoments` is the local source of truth. `useSessionSync` diffs it against what the
   server has and sends create / update / delete calls. Pair ids are client UUIDs, so a retried create is
   idempotent. Failed saves are shown per pair and retried (button, next edit, or when the browser comes back online).
4. **Extract** — `POST …/pairs/{id}/extract` runs FFmpeg in a temp folder (max 2 jobs at once, per-pair lock,
   timeouts), renames it into place and stores one `extracted_media` row per image with its exact source
   timestamp (read from FFmpeg's `showinfo`, so variable frame rate is handled).
5. **Restore** — `/analysis/new?session=<id>` loads the session: videos stream from `/api/videos/{id}/file`
   (HTTP range), pairs and mode are restored, extracted frames are fetched when a pair is selected.
6. **Analyze** — still Demo: sample feedback only. Real analysis is Milestone 06.

### Data model

```
videos ──< analysis_sessions (reference_video_id, current_video_id) ──< matching_pairs ──< extracted_media
                                   └──────────────────────────────────────────────────────< extracted_media
```

- `matching_pairs.pair_type` is `single_frame` (reference/current timestamp) or `short_clip` (start/end per video).
- A video is shared and deleted only when no session references it. A session owns its pairs and frames.
- Schema changes are additive (`create_all` only creates missing tables); existing data is never dropped.

### Planned

1. **Analyze** — for each pair, the backend sends the extracted frames (or frame sequences) to the OpenAI vision
   model and asks for structured JSON (category, severity, evidence, timestamps, Unity fix).
2. **Store** — feedback items saved in SQLite, linked to the session and pair.
3. **Review** — the existing timeline/feedback UI shows real results; clicking an item seeks both videos.
4. **Export** — Markdown/JSON report.

## Key decisions

- **SQLite + local folder** instead of a database server or cloud storage: zero setup, enough for one user.
- **Synchronous processing** (no job queue): analysis runs inside the request or a FastAPI background task. Good enough for short clips in an MVP.
- **Manual timestamp matching** before any automatic sync: simpler and more reliable.
- **API key only on the backend** via `backend/.env`.
- **Python 3.9-compatible code** (`Optional[...]` instead of `X | None`). The dev venv now runs Python 3.12, but the code still runs on 3.9.
- **Raw-body uploads** (`application/octet-stream`) instead of multipart: true streaming to disk, size enforced while reading, and real upload progress via XHR.
- **FFmpeg via subprocess** with argument lists (never `shell=True`) and timeouts; no Python video libraries.
