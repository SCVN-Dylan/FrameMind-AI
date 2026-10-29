# FrameMind AI

FrameMind AI compares two gameplay videos — a **Reference** video (the expected result) and a **Current** video (your current implementation) — and uses AI vision to produce visual feedback for Unity developers: differences in camera, layout, lighting, colors, animation and VFX, with suggested fixes and timestamps.

> **Status:** Milestones 01–06 done. Videos are uploaded to the backend, pairs are saved in SQLite, FFmpeg extracts frames, and **Analyze** runs the locally installed **Codex CLI** (signed in with your ChatGPT account) to produce structured Unity feedback. Dashboard statistics and the sample reports in History are still **Demo** data. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Tech stack

| Layer            | Technology                           |
| ---------------- | ------------------------------------ |
| Frontend         | Next.js 16 (App Router), TypeScript, Tailwind CSS 4 |
| Backend          | Python 3.12 (3.9+ works), FastAPI, Uvicorn |
| Database         | SQLite (via SQLAlchemy)              |
| Video processing | FFmpeg + FFprobe (via subprocess)    |
| AI               | Local OpenAI Codex CLI (`codex exec`), ChatGPT sign-in, no API key |

## Project layout

```
framemind-ai/
├── frontend/   Next.js web app (UI)
├── backend/    FastAPI server (API, database, video + AI services)
├── storage/    Local files: uploaded videos, extracted frames, SQLite DB
├── submission/ Standalone single-file frontend (index.html)
├── scripts/    macOS launcher scripts, portable package builder, launcher tests
├── Start FrameMind.command / Stop FrameMind.command   one-click launcher
└── docs/       Architecture, roadmap, progress, portable setup (PORTABLE.md)
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js 20+ and npm
- Python 3.11+ recommended (3.9 still works; the dev machine uses Homebrew `python@3.12`)
- FFmpeg + FFprobe (required for upload and frame extraction)
- Codex CLI 0.165.0+ signed in with ChatGPT (required for Analyze): `npm install -g @openai/codex`, then `codex login`

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

## AI analysis with Codex CLI

Analyze uses the OpenAI Codex CLI installed on this Mac, signed in with **your ChatGPT account**. No API key is
needed or used, and FrameMind never reads or stores your credentials.

**Install once:** `npm install -g @openai/codex`.

**Sign in, log out, switch account — Settings → AI provider → Codex CLI:**

- **Login with ChatGPT** runs the official `codex login` on this Mac. Codex opens OpenAI's sign-in page in your
  browser (an "Open the sign-in page" link is shown too, in case no window opened). Sign in there; the panel switches
  to **Connected** once `codex login status` confirms it. FrameMind never sees your password or tokens.
- **Logout** (asks for confirmation) runs `codex logout` and only reports success after `codex login status` says
  "Not logged in". Then **Login with ChatGPT** signs in again — with another ChatGPT account if you like.
- **Refresh connection** re-checks the CLI (e.g. after signing in from a terminal).
- If the button can't work (e.g. port 1455 is busy), sign in from Terminal: `codex login`, or
  `codex login --device-auth` (enable device-code login in your ChatGPT security settings first).
- Login/logout are refused while an analysis is running. Only the sign-in **type** (ChatGPT, API key, …) is shown:
  Codex CLI has no command that reports the account's e-mail or plan, and FrameMind does not read `~/.codex/auth.json`.

**Model — Settings → AI provider → AI model:** the list comes from `codex debug models` (the model catalog Codex
loads for the signed-in account; hidden/internal models are left out). If that fails, the catalog bundled with the
CLI is shown and labelled as such; if both fail, only "Codex CLI default model" is available. Models without image
input are shown but disabled. The choice is saved in SQLite (`app_settings`) and used by future Single Frame and
Short Clip analyses (`codex exec --model …`); a job keeps the model it started with. Before each analysis the model is
re-checked against the catalog: if this account can't use it any more, Analyze asks you to pick another one.
`codex debug models` is a debug command of the CLI, so its output format may change in future versions.

**Run an analysis:** in New Analysis, upload both videos, add a Single Frame or Short Clip pair, wait for
"Saved", select the pair and click **Analyze Selected Frames / Clips**. The AI Analysis card shows the job running
(elapsed time, no fake percentage); feedback appears in the timeline and Feedback panel. Clicking a feedback item
seeks each video to its own timestamp. Results are saved and come back after a refresh or a backend restart.
Full Video stays "Future".

**Feedback language:** Analyze sends the current UI language (EN / VI / KO). Codex is told to write the summary and
every human-readable field in that language, keeping Unity terms (Cinemachine, FOV, URP, …) and all JSON field names
and enum values (category, severity, confidence) in English, so the schema is unchanged. The language is stored on the
job; feedback is shown exactly as generated. Switching the UI language later does not re-run anything — the AI Analysis
card notes the language and you can click Analyze again. Missing or unknown languages fall back to English.

**How Codex is invoked** (`backend/app/services/ai/codex_cli.py`): once per pair, as
`codex exec` with the prompt on stdin, the labelled frames attached with `--image` (Single Frame: 1 per video;
Short Clip: up to `AI_MAX_FRAMES_PER_CLIP` evenly picked frames per video, in order, with their real timestamps),
`--output-schema` for strict JSON and `--output-last-message` to read the answer. The backend validates the answer
with Pydantic, generates the feedback ids, checks the pair id, evidence frame labels and timestamps, and stores it.

**Security restrictions** (all documented CLI options, checked against codex-cli 0.165.0):

- runs in a fresh temp folder outside the project that contains only copies of the frames;
- a permissions profile passed with `-c` denies the whole filesystem (`":root" = "deny"`) except that folder
  (read-only) and the minimal system paths; no writes, no network, `approval_policy="never"`;
- shell/exec, image viewing, image generation, browser, computer use, apps and plugins are disabled (`--disable`);
- `--ignore-user-config` / `--ignore-rules` (your MCP servers, plugins and rules are not loaded), `--ephemeral`;
- no `--dangerously-*` flags; `subprocess` argument lists only (never `shell=True`); user text never goes into
  arguments; `OPENAI_API_KEY`/`CODEX_API_KEY` are removed from Codex's environment;
- timeout with process-group kill, 1 concurrent Codex run by default, output size limits, tokens redacted from logs.

If Codex is signed in with an API key instead of ChatGPT, Analyze is refused (so nothing is billed to an API account),
unless you set `CODEX_ALLOW_API_KEY_AUTH=true`.

**Usage limits:** every analysed pair is one Codex task and counts toward your ChatGPT plan's Codex limits
(5-hour and weekly windows). OpenAI documents `codex exec` for scripts; running it with ChatGPT sign-in is meant for
your own trusted machine. Keep this a personal local tool: do not expose the backend to other people.

**Troubleshooting**

| Message | Fix |
| --- | --- |
| Codex CLI is not installed | `npm install -g @openai/codex`, or set `CODEX_CLI_PATH` to the binary |
| Codex CLI is not signed in | Settings → AI provider → Login with ChatGPT (or `codex login` in a terminal, then Refresh connection) |
| Sign-in did not complete / port 1455 in use | Close other Codex logins, or use `codex login --device-auth` in a terminal |
| Selected model not available | Pick another model in Settings (accounts can have different models) |
| Codex CLI version is too old | `codex update` (0.165.0 or newer) |
| Signed in with an API key | `codex logout && codex login` and choose ChatGPT |
| Codex did not finish in time | Raise `CODEX_TIMEOUT_SECONDS`, or use fewer frames (`AI_MAX_FRAMES_PER_CLIP`) |
| Exited with an error / usage limit | Read the message; you may have hit your plan's usage limit — wait for it to reset |
| Not valid feedback JSON | Run it again; the answer did not match the schema and nothing was saved |
| Interrupted | The backend restarted during the run; run it again |

## Standalone page (`submission/index.html`)

A single self-contained HTML file (all CSS, JavaScript and SVG icons inline; no CDN, no build, no Node.js) that
mirrors the Next.js UI: Dashboard, New Analysis, History and Settings, in EN / VI / KO. Open it by double-clicking.

- **Works offline:** load the Reference/Current videos, play/seek, match Single Frame and Short Clip pairs (same rules
  as the app), extract frames in the browser with Canvas, switch language. Pairs are kept in browser storage per pair of
  files and restored when the same files are loaded again. Analyze is disabled and shows "AI Backend Offline" — no
  sample or fake results are ever shown.
- **With the backend running** (`uvicorn app.main:app` in `backend/`): uploads, saved sessions, backend (FFmpeg) frame
  extraction, Codex analysis in the UI language, History, Dashboard statistics and Codex account/model settings — all
  through the existing API.
- **Pairing (once):** a page opened from disk sends `Origin: null`, which sandboxed iframes on any website also send.
  The backend therefore requires a pairing code from such pages (except `/api/health`). It is printed when the backend
  starts and stored in `storage/standalone_pairing_code.txt` (owner-only, git-ignored). Enter it in the page's
  **Settings → Local backend** (or open the page with `#pairing=<code>`). The Next.js app on `localhost:3000` is
  unaffected. Disable with `STANDALONE_FRONTEND_ENABLED=false`.
- The page sets a strict Content-Security-Policy: inline code only, network only to `http://localhost:*` /
  `http://127.0.0.1:*`. The backend address is configurable in Settings (localhost only).
- UI text and icons are copied from `frontend/src/lib/i18n/dictionaries.ts` and `frontend/src/components/ui/Icon.tsx`;
  update the page when those change.

## One-click macOS launcher and portable package

`Start FrameMind.command` (double-click) sets up and starts everything for the standalone page — no Next.js, no build:

1. Checks macOS (12+, Apple Silicon or Intel), the app files, Python 3.9–3.13 and FFmpeg; Codex CLI is optional.
   Anything missing is explained and installed only after a `y` (Homebrew: official installer; then
   `brew install python@3.12` / `ffmpeg` / `--cask codex`). No `sudo`, no `eval`.
2. Creates a virtual environment in `~/Library/Application Support/FrameMind AI/runtime/venv` from
   `backend/requirements.txt` (reused while requirements and Python are unchanged).
3. Starts `uvicorn app.main:app` on `127.0.0.1:8000` with `STORAGE_DIR` set to that folder (database, videos, frames,
   pairing code, logs). A busy port is left alone and the next free one is used; an already-running backend started
   by the launcher is reused (verified by PID file + command line + listening port + `/api/health`).
4. Opens `submission/index.html` (file://) in the default browser, already paired: Chrome & co. get
   `#pairing=…&api=…` through a private helper page; Safari, which blocks file-to-file redirects, gets the values
   through `localStorage` (shared by its file:// pages).
5. Keeps running until Control-C, the window is closed, or `Stop FrameMind.command` — then stops only its own backend.

Build the ZIP with `scripts/build_portable.sh` (→ `dist/FrameMind-Portable.zip`, git-ignored; only runtime files, checked
for private files). Test with `scripts/tests/test_launcher.sh` (mocks for installations; a real backend and venv in a
throwaway folder). End-user instructions: [docs/PORTABLE.md](docs/PORTABLE.md) (shipped as the package's README).

## Where data is stored

Everything lives under `storage/` (set `STORAGE_DIR` in `backend/.env` to move it). It is git-ignored.

| What | Location | Notes |
| --- | --- | --- |
| Uploaded videos | `storage/videos/<uuid>.<ext>` | Never named after the original file; the original name is metadata in SQLite |
| Extracted frames | `storage/frames/<session>/<pair>/<run>/reference_000.jpg`, `current_000.jpg`, … | Only the latest run per pair is kept |
| Database | `storage/framemind.db` | Tables: `videos`, `analysis_sessions`, `matching_pairs`, `extracted_media`, `analysis_jobs`, `feedback_items`, `app_settings` |

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
| POST | `/api/analysis/{session_id}/run` | Start an AI analysis (`{"analysis_mode", "pair_ids", "language"}`), 202 + job; 409 if one is running |
| GET | `/api/analysis/{session_id}/status` | Latest job (`pending` / `processing` / `completed` / `failed`), `null` if none |
| GET | `/api/analysis/{session_id}/results[?job_id=]` | Feedback of the latest (or given) completed job |
| GET | `/api/analysis/{session_id}/jobs` | All jobs of the session |
| GET | `/api/ai/provider/status[?refresh=true]` | Codex CLI installed / version / sign-in type / options / selected model / login flow (no credentials) |
| POST · GET · DELETE | `/api/ai/provider/login` | Start `codex login` · follow it · cancel it (local only) |
| POST | `/api/ai/provider/logout` | `codex logout`, confirmed with `codex login status` (local only) |
| GET | `/api/ai/provider/models[?refresh=true]` | Models from `codex debug models` (+ source and selected model) |
| PUT | `/api/ai/provider/model` | Save the analysis model (`{"model": slug or null}`) (local only) |

"Local only" endpoints accept requests only from this computer and, from a browser, only from `FRONTEND_ORIGIN`.

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

Then click **Analyze** (see "AI analysis with Codex CLI" above).

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
| `backend/.env`        | `AI_PROVIDER`         | `codex_cli` (the only provider)          |
| `backend/.env`        | `CODEX_CLI_PATH`      | `codex` on PATH, or an absolute path     |
| `backend/.env`        | `CODEX_MODEL`         | Initial model until one is chosen in Settings (empty = CLI default) |
| `backend/.env`        | `CODEX_TIMEOUT_SECONDS`, `CODEX_MAX_CONCURRENT_JOBS` | Per-pair timeout (180 s), parallel Codex runs (1) |
| `backend/.env`        | `AI_MAX_FRAMES_PER_CLIP`, `AI_MAX_PAIRS_PER_JOB` | Frames sent per clip (6), pairs per job (5) |
| `backend/.env`        | `OPENAI_API_KEY`      | Not used by the Codex CLI provider       |
| `backend/.env`        | `OPENAI_MODEL`        | Vision model name                        |
| `backend/.env`        | `MAX_UPLOAD_BYTES`    | Upload limit per video (default 1 GB)    |
| `backend/.env`        | `CLIP_SAMPLE_FPS`, `CLIP_MAX_FRAMES` | Short Clip sampling rate (default 8) and cap per clip (default 40) |
| `backend/.env`        | `FRAME_MAX_WIDTH`     | Extracted frames are scaled down to this width (default 1280) |
| `backend/.env`        | `FFMPEG_TIMEOUT_SECONDS`, `FFPROBE_TIMEOUT_SECONDS`, `MAX_CONCURRENT_EXTRACTIONS` | FFmpeg limits (defaults 120 s, 30 s, 2 jobs) |
| `frontend/.env.local` | `NEXT_PUBLIC_API_URL` | Backend URL the browser calls            |
