# Progress

_Last updated: 2026-10-28_

## Current milestone

**Analysis Settings (frontend):** complete. Builds on Milestone 03. Frontend only; no backend changes.

## Completed

- [x] Root folder, `.gitignore`, `.env.example` files (backend + frontend)
- [x] Next.js 16 + TypeScript + Tailwind CSS 4 frontend (`frontend/`)
- [x] FastAPI backend with modular layout (`backend/app/`)
- [x] Settings loaded from `backend/.env` (no hardcoded keys)
- [x] SQLite setup via SQLAlchemy (`storage/framemind.db` created at startup)
- [x] Storage folders `storage/videos/` and `storage/frames/`
- [x] `GET /api/health` reporting database, storage, FFmpeg and OpenAI-key status
- [x] Frontend API utility (`src/lib/api.ts`) and `BackendStatus` component on the homepage
- [x] CORS configured for `http://localhost:3000`
- [x] Backend test for the health endpoint
- [x] README, ARCHITECTURE, ROADMAP, PROGRESS docs

### Milestone 02 — Frontend UI (2026-10-28)

- [x] Dark theme tokens in `globals.css` (`bg-surface`, `text-muted`, `border-border`, `bg-brand-gradient`, …)
- [x] App shell: sidebar navigation + mobile drawer (`components/layout/`), page header with live backend status pill
- [x] Pages: Dashboard `/`, New Analysis `/analysis/new`, History `/history`, Analysis detail `/history/[id]`, Settings `/settings`, 404
- [x] Video comparison: two local video players side by side (browser object URLs, no upload), drag & drop, play/pause,
      frame step, seek bar, jump-to-timestamp, "Play/Pause both", sync players with offset, mark timestamp pairs
- [x] Object URLs are revoked on file change, unmount, and when Next.js hides the page (Cache Components `<Activity>`);
      players pause when hidden and resume position on return
- [x] Feedback panel: summary, category filters (Camera, Composition, Lighting, Colors, Animation, VFX), severity badges,
      timestamps, expandable cards with suggested Unity fixes
- [x] Analysis timeline: one lane per category, severity markers, playhead, selected-timestamp line, click-to-seek;
      selecting a marker/card seeks both players and highlights them
- [x] Mock data in `lib/mock-data.ts`, labelled as **Demo** everywhere it appears. "Analyze Videos" is marked Demo and
      only loads sample feedback — no real analysis
- [x] Reusable UI primitives in `components/ui/` (Card, Button, Badge, EmptyState, StatCard, inline SVG Icon)
- [x] `npm run lint` and `npm run build` pass
- [x] Language switcher (English / Tiếng Việt / 한국어) in the sidebar and on Settings. Text lives in
      `src/lib/i18n/dictionaries.ts`; the choice is saved in `localStorage`. Demo feedback/history are translated too
      (Unity component names stay in English). Pages prerender in English and switch right after load.

### Milestone 03 — Video upload, dual playback, timestamp matching (2026-10-28)

- [x] Upload per video: drag & drop or file picker; validation of type (MP4, WebM, MOV, OGG) and size (≤ 1 GB);
      clear errors for empty / non-video / unsupported / too large files and for files the browser can't decode
- [x] Shows file name, size, resolution and duration; loading spinner while metadata is read; Replace / Remove
- [x] Files stay in browser memory (object URLs); URLs are revoked on replace, remove, and when the page is hidden
- [x] WebM files without a stored duration (e.g. MediaRecorder output) are handled
- [x] Per player: play, pause, seek, frame step, volume, mute, speed (0.25×–2×), current time / duration, jump-to-time
- [x] Shared: Play both, Pause both, Restart both (each video keeps its own timestamp), optional Sync with offset
- [x] Manual timestamp matching: live or captured/typed times, add / edit / delete / clear, duplicate check (50 ms),
      range check against durations, click a pair (or its marker) to seek both videos to their own times
- [x] Per-video timeline: playhead, click/drag/keyboard seeking, numbered pair markers, selected pair highlight
- [x] Replacing a video keeps pairs that still fit and removes the rest, with a notice
- [x] "Match Gameplay Moments": each pair = id + reference ms + current ms + optional event description;
      timestamps are expected to differ, adding a pair never moves/syncs the videos; pairs are the input for AI comparison later
- [x] State in hooks: `src/hooks/useVideoPlayer.ts`, `src/hooks/useTimestampPairs.ts`; types in `src/lib/types.ts`
- [x] All timestamps are integer milliseconds internally (`referenceMs`, `currentMs`, `durationMs`)
- [x] Headless-Chrome end-to-end check (real WebM videos recorded in the page): 49/49 scenarios passed

### Analysis Settings (2026-10-28)

- [x] One "Analysis Settings" panel (the separate matching panel was merged into it): pick a mode, mark it, analyze
- [x] Single Frame (default): frame pairs = one moment in each video (times may differ), live or captured/typed
- [x] Short Clip: clip pairs = a from–to range in each video, set with "Set start" / "Set end" or typed;
      the two clips may have different lengths (0.1–10 s each); validated against each video's duration
- [x] Full Video: nothing to mark; shows both full durations, accuracy warning and "Future" label
- [x] Frame pairs and clip pairs are separate lists with their own selection; switching modes keeps both
- [x] Optional event description, edit / delete / clear, duplicate check, click a pair (or its timeline marker)
      to select it and seek each video to its own (start) time; replaced videos prune pairs that no longer fit
- [x] Timelines show the analysed area: point (frame), band (clip), whole bar (full) — purple reference, blue current
- [x] Mode-specific button ("Analyze Selected Frames / Clips / Full Videos") with validation messages; still Demo Mode:
      no request is sent (there is no backend analysis endpoint yet); demo feedback is placed inside the selection
- [x] Types `FramePair`, `ClipPair`, `AnalysisMode`, `AnalysisSettings`, `AnalysisRange`, `AnalysisTarget` in
      `src/lib/types.ts`; logic in `src/lib/analysis.ts` (27 unit checks) and `src/hooks/useMatchedMoments.ts`
- [x] Headless-Chrome end-to-end check: 72/72 scenarios passed

## Pending

- [ ] M1 — Video upload
- [~] M2 — Side-by-side preview (frontend done with local files; switch to backend-served videos after M1)
- [~] M3 — Timestamp matching (manual frame/clip pairs done in the frontend; not saved to the backend yet)
- [ ] M4 — Frame extraction (FFmpeg)
- [ ] M5 — AI frame comparison (OpenAI Vision)
- [ ] M6 — Full analysis run
- [ ] M7 — Feedback timeline
- [ ] M8 — Export report
- [ ] M9 — Polish
- [ ] M10 — Buffer + demo

## Known issues

- **FFmpeg is not installed** on the dev machine. Health check reports `ffmpeg: false`. Install with `brew install ffmpeg` before M4.
- **Python 3.9.6** (macOS system Python) is end-of-life. Everything works today, but upgrading to Python 3.11+ is recommended (`brew install python@3.12`, then recreate `backend/.venv`).
- No git repository has been initialized yet.
- `frontend/package-lock.json` had 24 corrupted entries (no version), which left packages such as `next` and
  `has-symbols` empty. It was regenerated on 2026-10-28 from the same `package.json` ranges (Next 16.4.3, React 19.3.0).
- Frame stepping assumes 30 fps; the browser cannot read a video's real frame rate. Fix once the backend reports it
  via FFmpeg (M4).
- All feedback, history and statistics are demo data until M5/M6.
- Frame/clip pairs live only in memory: a page reload clears videos and pairs (File objects can't be persisted).
- Whether a file plays depends on its codec: H.264/VP8/VP9/AV1 work; HEVC/ProRes .mov files often don't in Chrome.

## Next task

**M1 — Video upload (backend):** `POST /api/comparisons` accepting two video files (reference + current), saving them to `storage/videos/`, creating a `Comparison` table in SQLite, then wire `ComparisonWorkspace` to upload the selected files (add the call in `src/lib/api.ts`) and load the History page from the backend instead of `DEMO_HISTORY`.
