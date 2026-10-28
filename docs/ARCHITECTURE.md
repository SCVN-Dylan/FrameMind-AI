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
│       ├── components/       Reusable UI pieces (BackendStatus, later VideoPlayer, Timeline…)
│       └── lib/api.ts        The only place that calls the backend
├── backend/
│   ├── app/
│   │   ├── main.py           Creates the FastAPI app, CORS, startup tasks
│   │   ├── api/
│   │   │   ├── router.py     Mounts every route module under /api
│   │   │   └── routes/       One file per feature (health.py, later videos.py, analysis.py)
│   │   ├── core/config.py    Settings read from backend/.env
│   │   ├── db/database.py    SQLite engine, sessions, Base for models
│   │   ├── schemas/          Pydantic request/response shapes (API contracts)
│   │   └── services/         Business logic, no HTTP code
│   │       ├── storage.py    Local file storage paths
│   │       ├── video/        FFmpeg: metadata + frame extraction
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

### Today (Milestone 0)

1. Browser loads `localhost:3000`.
2. `BackendStatus` component calls `getHealth()` in `lib/api.ts`.
3. `GET http://localhost:8000/api/health` → `routes/health.py`.
4. The route asks `db`, `services/storage` and `services/video/ffmpeg` for their status and returns a `HealthResponse`.
5. The component shows the results.

### Planned (MVP)

1. **Upload** — user uploads Reference + Current videos → backend saves them in `storage/videos/` and stores a row in SQLite.
2. **Preview & match** — frontend plays both videos side by side; user marks matching timestamp pairs.
3. **Extract** — backend uses FFmpeg to grab a frame from each video at each timestamp pair → `storage/frames/`.
4. **Analyze** — for each pair, backend sends both frames to the OpenAI vision model and asks for structured JSON (category, severity, description, Unity fix).
5. **Store** — feedback items saved in SQLite, linked to the comparison and timestamp.
6. **Review** — frontend shows feedback on an interactive timeline; clicking an item seeks both videos.
7. **Export** — backend produces a Markdown/JSON report.

## Key decisions

- **SQLite + local folder** instead of a database server or cloud storage: zero setup, enough for one user.
- **Synchronous processing** (no job queue): analysis runs inside the request or a FastAPI background task. Good enough for short clips in an MVP.
- **Manual timestamp matching** before any automatic sync: simpler and more reliable.
- **API key only on the backend** via `backend/.env`.
- **Python 3.9-compatible code** (`Optional[...]` instead of `X | None`) because the dev machine currently has Python 3.9.
