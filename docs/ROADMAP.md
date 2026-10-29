# Roadmap — MVP (8 milestones)

Each milestone ends with something you can test by hand. Don't start the next milestone until the current one's "Done when" passes.

Milestones 01–06 are complete (6/8). Milestone 06 was re-scoped from the OpenAI API to the local Codex CLI. Days for 05–08 count from the start of Milestone 05.

| Days | Milestone | Status | Done when |
| --- | --- | --- | --- |
| — | **01 — Project Setup** | ✅ Done | Next.js 16, FastAPI, SQLite, project layout, env config; website loads and `/api/health` returns `ok` |
| — | **02 — Frontend UI** | ✅ Done | Dark-mode Dashboard, New Analysis, History, Settings, Feedback Panel, Timeline, EN/VI/KR languages; pages navigate with demo data |
| — | **03 — Video Upload & Timestamp Matching** | ✅ Done (frontend) | Two videos load and play with independent controls; the same gameplay event is matched at two different timestamps; clicking a pair seeks each video to its own time; timeline markers |
| — | **04 — Analysis Settings UI** | ✅ Done (chosen scope) | Single Frame, Short Clip with manual Start/End, Full Video (Future); the analysed range is shown on the timeline |
| 1–3 | **05 — Backend Video Processing & Storage** | ✅ Done | Real upload saves both videos to `storage/videos/`; FFprobe metadata (duration, resolution, fps) is stored; SQLite keeps sessions and frame/clip pairs, so a page reload restores metadata and pairs; FFmpeg extracts frames and clip frame sequences at the right timestamps into `storage/frames/` |
| 4–6 | **06 — Local Codex CLI Integration** | ✅ Done | Codex CLI capabilities verified; Analyze runs `codex exec` locally (ChatGPT sign-in, no API key) on the extracted frames of the selected Single Frame / Short Clip pair; strict JSON validated with Pydantic and stored in SQLite; results shown in the existing timeline/feedback UI and restored after refresh. Verified with mocked/fake Codex; a real run is done by the user |
| 7–8 | **07 — Real Feedback, History & Export** | ⬜ Next | Demo data is replaced by real AI results; History lists saved sessions and reopening one shows its feedback; clicking feedback seeks the videos; Markdown and JSON reports export successfully |
| 9–10 | **08 — QA, Optimization & Hackathon Demo** | ⬜ | Tested with real gameplay video pairs; API speed/cost tuned; bugs fixed; full flow upload → choose mode → analyze → review → export runs end to end for the demo |

## Scope guardrails (not in MVP)

- Automatic video synchronization / scene matching
- Automatic 2-second clip around a marked moment (Short Clip uses manual Start/End)
- User accounts, multi-user, cloud hosting
- Background job queues (Redis, Celery), Docker, PostgreSQL
- Video editing or annotation drawing
