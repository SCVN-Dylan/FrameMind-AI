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

The browser never talks to Codex or FFmpeg directly. All heavy work stays in the backend; Codex keeps its own ChatGPT sign-in in `~/.codex`, which FrameMind never reads or exposes.

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
│   │   │   └── routes/       health.py, videos.py, sessions.py, media.py, analysis.py, ai_provider.py
│   │   ├── core/config.py    Settings read from backend/.env
│   │   ├── core/errors.py    AppError + one JSON error shape for the whole API
│   │   ├── db/database.py    SQLite engine, sessions, Base for models
│   │   ├── db/models.py      Video, AnalysisSession, MatchingPair, ExtractedMedia, AnalysisJob, FeedbackItem, AppSetting
│   │   ├── schemas/          Pydantic request/response shapes (API contracts)
│   │   └── services/         Business logic, no HTTP code
│   │       ├── storage.py    Local file storage paths (safe resolve, cleanup)
│   │       ├── videos.py     Streamed upload + validation, video ownership
│   │       ├── sessions.py   Sessions, replacement pruning, deletion rules
│   │       ├── pairs.py      Frame/clip pair validation (mirrors frontend rules)
│   │       ├── extraction.py Frame extraction runs, job limits, extracted media
│   │       ├── video/        ffmpeg.py: FFprobe metadata, frame + sequence extraction
│   │       ├── analysis.py   Analysis jobs: queue, frame selection, validation, storage
│   │       ├── app_settings.py Local preferences (selected model) in SQLite
│   │       └── ai/           codex_cli.py (CodexCLIService), codex_account.py (login/logout/models), prompt.py
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

### Analyze (Milestone 06)

1. `POST /api/analysis/{session}/run` checks the pairs and the Codex CLI (installed, version, documented options,
   signed in with ChatGPT), refuses a second active job (409), stores a `pending` `analysis_jobs` row and hands it to
   a bounded worker pool (`CODEX_MAX_CONCURRENT_JOBS`, default 1).
2. The worker marks it `processing`, then per pair: reuses or extracts the frames, copies the selected ones into a
   fresh temp folder with labelled names (`01_R1_reference_10000ms.jpg`), builds the prompt (`services/ai/prompt.py`)
   and runs `codex exec` locked down (see README → Security restrictions). Prompt on stdin, answer from
   `--output-last-message`, shape enforced by `--output-schema`.
3. The answer is parsed with Pydantic (`AIAnalysisOutput`); issues with a wrong pair id or duplicates are dropped,
   timestamps are snapped to the frames that were actually sent, evidence labels are mapped to `extracted_media` ids,
   and `feedback_items` rows are stored with backend-generated ids. The job ends `completed` or `failed` (error code +
   message). Jobs still active at startup are marked `failed` / `interrupted`.
4. The frontend (`useAnalysisJob`) polls `/status` every 2 s while active, then loads `/results`; it also restores the
   latest job and results when a session is opened.

```
analysis_sessions ──< analysis_jobs ──< feedback_items >── matching_pairs (SET NULL if the pair is deleted)
```

### Feedback language

`AnalysisRunRequest.language` (`en` / `vi` / `ko`, anything else → `en`) is stored in `analysis_jobs.language` and
added to the prompt as an output-language requirement (`prompt.language_requirement`). The JSON Schema and enum
values stay English. `add_missing_columns()` in `db/database.py` adds such new columns to existing databases with
`ALTER TABLE … ADD COLUMN` (never drops anything).

### Codex account & model (Settings)

- **Login:** `POST /api/ai/provider/login` spawns `codex login` (argument list, scrubbed env, own process group). A
  watcher thread reads its output in memory (never logged) to pick up the OpenAI sign-in URL it prints, waits for the
  process to exit, then confirms with `codex login status`. The UI polls `GET /login`; the flow times out after
  10 minutes and can be cancelled (`DELETE /login` kills the process group).
- **Logout:** `codex logout`, then `codex login status` must say "Not logged in" — otherwise 502 `codex_logout_failed`.
- **Models:** `codex debug models` (account catalog, cached 10 min, refreshed after login/logout) with `--bundled` as a
  labelled fallback. The chosen slug is stored in `app_settings`; `start_job` validates it (listed, image input) and
  stores it on the job; `codex exec --model <slug>` uses the job's own value.
- **Guard:** login, logout, cancel and model changes require a request from this computer and, if sent by a browser,
  the `FRONTEND_ORIGIN` origin (`require_local_request`). Login/logout are refused while an analysis is active.

### Planned

1. **Report & export** — Markdown/JSON report of a completed analysis; history of past jobs in the UI.
2. **QA** — real gameplay pairs, prompt tuning, cost/speed tuning.

## Key decisions

- **SQLite + local folder** instead of a database server or cloud storage: zero setup, enough for one user.
- **Synchronous processing** (no job queue): analysis runs inside the request or a FastAPI background task. Good enough for short clips in an MVP.
- **Manual timestamp matching** before any automatic sync: simpler and more reliable.
- **No API key:** analysis uses the user's own Codex CLI sign-in (ChatGPT plan limits) through `codex exec`, a documented non-interactive mode. One Codex run per pair keeps each prompt small and failures isolated.
- **Python 3.9-compatible code** (`Optional[...]` instead of `X | None`). The dev venv now runs Python 3.12, but the code still runs on 3.9.
- **Raw-body uploads** (`application/octet-stream`) instead of multipart: true streaming to disk, size enforced while reading, and real upload progress via XHR.
- **FFmpeg via subprocess** with argument lists (never `shell=True`) and timeouts; no Python video libraries.
