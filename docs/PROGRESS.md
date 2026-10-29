# Progress

_Last updated: 2026-10-28_

## Current milestone

**06 — Local Codex CLI Integration:** complete (2026-10-29). Next: **07 — Real Feedback, History & Export**.

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

### Milestone 06 — Local Codex CLI integration (2026-10-29)

- [x] Codex CLI verified (codex-cli 0.165.0, signed in with ChatGPT): `codex exec` (non-interactive), `--image`,
      `--output-schema`, `--output-last-message`, `--ephemeral`, `--ignore-user-config`, `-c` permission profiles,
      `--disable` features. The locked-down profile was checked with `codex debug prompt-input` (local, no model call):
      `:root` deny, only the run folder readable. Prompt goes on stdin because `--image` takes several values.
- [x] Terms/limits reviewed: OpenAI documents `codex exec` for scripts and allows ChatGPT-managed auth on trusted
      machines; runs count toward the ChatGPT plan's Codex limits. FrameMind stays a personal local tool.
- [x] `CodexCLIService` (`services/ai/codex_cli.py`): detection + capability check (cached 60 s), locked-down command,
      prompt via stdin, scrubbed env (no API keys), timeout with process-group kill, concurrency limit, output limits,
      token redaction, API-key sign-in refused by default
- [x] Prompt template + strict JSON Schema (`services/ai/prompt.py`); Pydantic validation (`schemas/analysis.py`)
- [x] Analysis jobs (`services/analysis.py`): one active job per session, bounded worker pool, per-pair Codex runs,
      Short Clip frames evenly picked (≤ `AI_MAX_FRAMES_PER_CLIP`, real timestamps, order kept), output normalization
      (pair id, duplicates, timestamps snapped to sent frames, evidence labels → media ids), interrupted-job recovery
- [x] SQLite: `analysis_jobs`, `feedback_items` (additive); session list shows latest analysis status + issue count
- [x] Routes: `POST /api/analysis/{id}/run`, `GET …/status`, `GET …/results`, `GET …/jobs`, `GET /api/ai/provider/status`
- [x] Frontend: real Analyze button (`useAnalysisJob`: submit, poll, restore), AI Analysis card (running with elapsed
      time — no fake progress — / summary / error + Run again), Codex status line, Settings → AI provider card,
      feedback cards with severity (critical/major/minor/suggestion), confidence, impact, how to improve, Unity
      recommendation and evidence frames; clicking feedback seeks both videos; History analysis badge; EN/VI/KO
- [x] Demo data stays only in Dashboard stats and "Demo AI reports"; the New Analysis page no longer shows "Demo Mode"
- [x] 68 backend tests pass (27 new, Codex always mocked: unavailable, old version, missing options, not signed in,
      API-key sign-in, Single Frame, Short Clip with different durations, zero issues, invalid JSON/schema, timeout,
      non-zero exit with token redaction, duplicate jobs, validation, persistence across restart, interrupted jobs,
      cascade delete, normalization, command safety)
- [x] `tsc`, `npm run lint`, `npm run build` pass
- [x] Headless Chrome run against a **fake `codex` executable** (no model call, isolated storage): Analyze → processing
      → 2 feedback cards; clicking feedback seeks to 3000 / 5000 ms; Short Clip feedback at real sampled timestamps
      (10 880 ms); reload restores results; VI/KO; History badge; Settings provider card; no page errors
- [ ] Real Codex run on real gameplay videos — waiting for the user's confirmation (uses ChatGPT plan quota)

### Codex account & model management (2026-10-29)

- [x] Verified with codex-cli 0.165.0: `codex login` (browser flow, prints the sign-in URL and "Successfully logged in."),
      `codex login --device-auth`, `codex logout` ("Successfully logged out"), `codex login status`,
      `codex debug models` (+ `--bundled`), `codex exec --model`. No CLI command exposes the account e-mail or plan.
- [x] Backend: `codex_account.py` (login flow with URL capture, timeout, cancel; confirmed logout; model catalog with
      bundled fallback; model validation), `app_settings` table, routes `POST/GET/DELETE /api/ai/provider/login`,
      `POST /logout`, `GET /models`, `PUT /model`; local-only + origin guard; login/logout refused during analysis;
      sign-in modes parsed (ChatGPT, access token, API key, Bedrock) and billed modes refused by default; expired
      sign-in during a run → `codex_not_authenticated` + cache reset
- [x] Analyze (Single Frame and Short Clip) uses the selected model; each job stores its model; the model is checked
      against the catalog before a job starts
- [x] Settings → AI provider → Codex CLI: connection, sign-in type, model dropdown (source labelled, text-only models
      disabled, unavailable saved model flagged), Login with ChatGPT (waiting state + sign-in link + cancel), Logout
      (confirm), Refresh connection, Terminal fallback instructions; EN/VI/KO
- [x] 86 backend tests pass (18 new, CLI faked: not installed, login success/failure/refused/URL/cancel, logout
      success/failure, switch account, origin guard, catalog + fallbacks, selection persistence across restart,
      unsupported/unverifiable models, analyze with selected model, queued job keeps its model, default model,
      model removed from catalog, expired sign-in); `tsc`, lint, build pass
- [x] Headless Chrome against a fake `codex` (no real login, no inference): Connected → choose model → persists after
      reload → Logout → Not connected → Login → waiting + sign-in link → Connected → Analyze runs with
      `--model fake-vision-b`; VI/KO; no page errors
- [x] Real CLI (read-only checks only): status Connected (ChatGPT), 8 models listed from the account catalog

### AI feedback in the UI language (2026-10-29)

- [x] Analyze sends the current UI language; backend validates it (`en`/`vi`/`ko`, invalid/missing → `en`), stores it in
      `analysis_jobs.language` (additive `ALTER TABLE` migration; existing jobs became `en`), and adds the output-language
      requirement to the Codex prompt for Single Frame and Short Clip. JSON schema and enums unchanged.
- [x] Feedback is shown as generated; switching UI language never re-runs the analysis — the AI Analysis card says which
      language it was generated in. Earlier jobs keep their language (`GET …/results?job_id=`).
- [x] 97 backend tests pass (11 new: vi/en/ko prompts and results, Short Clip in Korean, invalid/missing language,
      earlier results kept, migration of an old database); `tsc`, lint, build pass
- [x] Headless Chrome with a fake `codex` that answers in the requested language: VI UI → Vietnamese cards; switching to
      EN keeps them (no new Codex call) with a note; EN Analyze → English; KO Short Clip → Korean; reload keeps it; no errors
- [ ] Real model output language not yet checked (needs a real Codex run)

## Pending

Plan: [ROADMAP.md](ROADMAP.md) — 6/8 milestones done (01–06).

- [ ] 07 — Real Feedback, History & Export
- [ ] 08 — QA, Optimization & Hackathon Demo

## Known issues

- Frame stepping in the browser still assumes 30 fps. The backend now stores the real fps (`videos.fps`), but the
  player doesn't use it yet.
- Dashboard statistics and the "Demo AI reports" list are still sample data (Milestone 07).
- Codex output quality has only been checked with mocked/fake answers so far; a real run is pending.
- Account e-mail/plan can't be shown: Codex CLI has no command for it (FrameMind does not read `~/.codex/auth.json`).
- The model list uses `codex debug models`, a debug command whose format may change; parsing is defensive and falls
  back to the bundled list or the CLI default model.
- The real `codex login` / `codex logout` flows were not run from the app yet (only with a fake CLI), to avoid
  signing you out.
- Each pair is one Codex task (~seconds to minutes) and uses ChatGPT plan quota; there is no cost estimate or cancel button.
- Only the latest completed analysis is shown in New Analysis; older jobs are available via `GET …/jobs` only.
- Feedback timestamps are snapped to the frames that were sent; with Short Clip (≤ 6 frames per clip) an issue
  between two sampled frames is located at the nearest sampled frame.
- The Codex capability check reads `codex exec --help`; a future CLI that renames options will be reported as
  unavailable rather than run with guessed flags.
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

**Real Codex check (user):** with the backend running, open a session with two real gameplay videos, add one Single
Frame pair, click Analyze and review the feedback. Then **07 — Real Feedback, History & Export:** list past analysis
jobs in History, open a job's report, and export Markdown/JSON.
