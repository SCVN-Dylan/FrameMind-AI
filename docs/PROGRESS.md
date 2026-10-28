# Progress

_Last updated: 2026-10-28_

## Current milestone

**05 — Backend Video Processing & Storage:** complete (2026-10-28). Next: **06 — OpenAI Vision Integration**.

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

### Milestone 05 — Backend video processing & storage (2026-10-28)

- [x] Environment: Homebrew FFmpeg/FFprobe 9.0.2 installed; `backend/.venv` recreated with Python 3.12.16
- [x] SQLite tables `videos`, `analysis_sessions`, `matching_pairs`, `extracted_media` (`app/db/models.py`); additive
      `create_all`, SQLite foreign keys enabled
- [x] `POST /api/videos`: raw-body streaming upload to `storage/videos/<uuid>.part`, 1 GB limit (Content-Length and
      streamed bytes), extension + file-signature check, FFprobe metadata (duration, size, resolution, fps, codec,
      container), first-frame decode check; partial/invalid files are always deleted; original name sanitised
- [x] Video metadata + streaming with HTTP range (`/api/videos/{id}`, `/file`)
- [x] Sessions CRUD; replacing a video deletes the session's extracted frames and prunes pairs that no longer fit;
      unreferenced videos are deleted; shared videos are kept
- [x] Pairs CRUD with the frontend's rules (timestamps within each video, start < end, clips 0.1–10 s, lengths may
      differ, 50 ms duplicate tolerance); errors return the frontend's reason codes; client UUIDs make creates idempotent
- [x] FFmpeg extraction: Single Frame (one JPEG per video at its own timestamp, last-frame fallback at the end of a
      video) and Short Clip (ordered sequence per video, grid-anchored sampling at `CLIP_SAMPLE_FPS`, capped at
      `CLIP_MAX_FRAMES`); exact source timestamps from `showinfo`; temp folder + rename; per-pair lock; global job
      semaphore; timeouts; frames scaled to ≤ 1280 px wide
- [x] Safe file serving: media/video ids only, paths resolved inside `storage/frames` / `storage/videos`
- [x] Unified error body `{"error": {code, message, details}}`; CORS limited to the configured origin and used methods
- [x] Startup cleanup of interrupted uploads/extractions
- [x] Frontend: `lib/api.ts` (XHR upload with progress, typed endpoints, `ApiError`), `hooks/useSessionSync.ts`
      (serialized session writes, pair diff sync, stale-result guards, retry + `online` retry, restore),
      `?session=<id>` in the URL, upload status per video, per-pair save state, "New session"
- [x] `ExtractedFramesPanel`: extract / re-extract the selected pair, side-by-side frames or two filmstrips, click a
      frame to seek that video; Full Video shows "not available yet"
- [x] History: real saved sessions (open / delete) above the Demo AI reports
- [x] EN / VI / KO text for all new UI
- [x] 41 backend tests pass (upload, invalid/oversized/corrupt files, metadata, sessions, both pair types, validation,
      extraction, missing video/FFmpeg, restore, safe serving, cleanup, shared-video deletion)
- [x] `tsc`, `npm run lint`, `npm run build` pass
- [x] Headless Chrome run with real H.264 videos: upload both → frame pair 3 s ↔ 5 s extracted at exactly
      00:03.000 / 00:05.000 → clip pair 2–4 s ↔ 6–11 s extracted as 16 / 40 frames → reload restores mode, pairs,
      videos (12 s / 15 s, playable and seekable) and frames → VI/KO text → session listed in History; no page errors

## Pending

Plan: [ROADMAP.md](ROADMAP.md) — 5/8 milestones done (01–05).

- [ ] 06 — OpenAI Vision Integration
- [ ] 07 — Real Feedback, History & Export
- [ ] 08 — QA, Optimization & Hackathon Demo

## Known issues

- Frame stepping in the browser still assumes 30 fps. The backend now stores the real fps (`videos.fps`), but the
  player doesn't use it yet.
- All AI feedback, dashboard statistics and the "Demo AI reports" list are sample data until Milestone 06/07.
- Videos uploaded but never attached to a session (e.g. the session write failed and the tab was closed) stay in
  `storage/videos/` as orphans. They are not auto-deleted.
- Pair validation runs against the browser's durations in the UI and FFprobe's on the server; a pair at the very
  last millisecond can be accepted locally but rejected by the server (shown as "Not saved").
- Session names can be set through the API (`PATCH name`) but there is no rename field in the UI yet.
- Variable-frame-rate sources are handled by timestamp-based selection, but were only tested with generated
  constant-rate videos (H.264 MP4, VP9 WebM).
- Whether a file plays in the browser depends on its codec: H.264/VP8/VP9/AV1 work; HEVC/ProRes .mov often don't
  in Chrome (FFmpeg can still extract frames from them).
- `frontend/package-lock.json` was regenerated on 2026-10-28 after corrupted entries (Next 16.4.3, React 19.3.0).

## Next task

**06 — OpenAI Vision Integration:** add `services/ai/` that sends a pair's extracted frames (one image per video
for Single Frame, the two ordered sequences for Short Clip) to the OpenAI vision model, asks for structured JSON
(category, severity, evidence, reference/current timestamps, Unity fix), stores the result in SQLite, and replaces
the Demo "Analyze" button with a real call. Needs `OPENAI_API_KEY` in `backend/.env`.
