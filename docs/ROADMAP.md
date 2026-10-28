# Roadmap — 14-day MVP

Each milestone ends with something you can test by hand. Don't start the next milestone until the current one's "Done when" passes.

| Day | Milestone | Done when |
| --- | --- | --- |
| 1 | **M0 — Project setup** | Frontend shows "FrameMind AI"; `/api/health` returns `ok`; tests pass |
| 2–3 | **M1 — Video upload** | You can upload a Reference and a Current video; files appear in `storage/videos/`; a `comparison` row exists in SQLite; `GET /api/comparisons/{id}` returns both videos |
| 4 | **M2 — Side-by-side preview** | Comparison page plays both videos next to each other, with play/pause and per-video scrubbing |
| 5 | **M3 — Timestamp matching** | You can mark pairs (Reference time ↔ Current time), see them in a list, delete them; pairs are saved and survive a page reload |
| 6 | **M4 — Frame extraction** | For each pair, FFmpeg writes two JPGs to `storage/frames/{comparison_id}/`; the UI shows the frame thumbnails |
| 7–8 | **M5 — AI frame comparison** | Clicking "Analyze" sends one frame pair to OpenAI Vision and returns structured JSON (category, severity, description, Unity fix); result stored in SQLite |
| 9 | **M6 — Full analysis run** | "Analyze all" processes every pair, shows progress, handles errors per pair without crashing |
| 10–11 | **M7 — Feedback timeline** | Feedback shown on a timeline; clicking an item seeks both videos to that moment; filter by category (camera, layout, lighting, color, animation, VFX) |
| 12 | **M8 — Export report** | "Export" downloads a Markdown (and JSON) report with timestamps, frame images and fixes |
| 13 | **M9 — Polish** | Loading/empty/error states, file size/type validation, clear error messages |
| 14 | **M10 — Buffer + demo** | End-to-end run with real Unity clips; README updated; known issues listed |

## Scope guardrails (not in MVP)

- Automatic video synchronization / scene matching
- User accounts, multi-user, cloud hosting
- Background job queues (Redis, Celery), Docker, PostgreSQL
- Video editing or annotation drawing
