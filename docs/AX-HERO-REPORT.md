# Dylan — AX Hero AI Workflow Report (Nov 2026)

**Project:** FrameMind AI, a local tool that compares a reference gameplay video with the current Unity build and returns AI feedback with Unity fixes.
**Period:** 2026-10-28 → 2026-11-05 (about 9 days, 12 commits, ~24k lines across Python / HTML-JS / TS / shell)
**Main tools:** Claude Code (desktop app), building the tool · ChatGPT, writing specs and docs · OpenAI Codex CLI, the AI engine inside the product

---

## Part 1 — Tool & Workflow Sharing

### 1. Problem

When we build a playable or creative from a reference video, someone has to answer "how is our build different from the reference?". Today we scrub both videos by eye and write notes by hand. Those notes are slow to write, subjective, and rarely end up as concrete Unity changes (camera FOV, lighting, VFX timing…).

**Goal:** a tool where I mark matching moments in the two videos and get structured, evidence-backed feedback, with each issue tied to a timestamp, a frame, and a suggested Unity fix.

### 2. Tool & approach

| Role | Tool | How it was used |
| --- | --- | --- |
| Builder | **Claude Code** | Wrote nearly all the code: FastAPI backend, FFmpeg pipeline, a single-file HTML UI, macOS/Windows launchers, tests |
| Spec writer | **ChatGPT** | Turned my ideas into long milestone specs, which I pasted into Claude Code |
| Product AI | **Codex CLI** (ChatGPT login, no API key) | Gets the extracted frames and returns JSON feedback against a fixed schema |

**Workflow that worked:**
1. **Milestone specs.** Each milestone is a self-contained spec with explicit constraints, for example *"no API key"*, *"never delete user data"*, *"localhost only"*.
2. **Claude Code implements and writes tests in the same pass.** The backend now has 126 pytest tests and the launcher 103 shell tests.
3. **I run the real app and react** with screenshots and short messages like "I click the image and nothing happens".
4. **Commit only after I've checked it**, then push.
5. **Keep project docs current** (`ARCHITECTURE.md`, `PROGRESS.md`, `PROJECT-OVERVIEW.md`) so a new AI session or ChatGPT can pick up the context.

**Key design decision: don't trust the AI's output.** The backend re-validates everything Codex returns:
- IDs are generated server-side.
- Frame labels must exist.
- Timestamps snap to frames that were actually sent.
- Duplicates are removed, with at most 20 issues per pair.
- For a single still frame, "animation" findings are downgraded.

### 3. Demonstration

> _[Attach: screen recording of upload → mark pairs → Analyze → click a feedback item → both videos seek + evidence frame opens full screen]_
> _[Attach: screenshot of one feedback card showing category, severity, observation, Unity recommendation, evidence frames]_

- **Input:** a reference video, a current-build video, and 1–5 matched moments (single frame or short clip).
- **Output:** per-pair issues across Camera / Composition / Lighting / Colors / Animation / VFX. Each issue has a severity, confidence, the reason it matters, a Unity recommendation, and evidence frames. Feedback is available in EN / VI / KO.
- **Delivery:** double-click `Start FrameMind.command`. It checks for and offers to install Python, FFmpeg and its own Codex, then opens the page with a pairing code.

### 4. Evaluation

**What worked**
- **Speed.** A working end-to-end tool (video → frames → AI → validated feedback → history) took about a week of part-time work, which I could not have done alone.
- **Tests as a safety net.** Asking for tests in every task caught regressions, and the test suites cost almost no extra effort.
- **Constraints were respected when stated explicitly.** Examples: no API key, the Codex sandbox kept read-only with no network, Clear All Data scoped to its storage folder, tests only on temporary storage.
- **Polish requests were fast.** Adding the click-to-enlarge evidence frame, a 3-language UI, or yes/no install dialogs each took a single short iteration.

**What failed or needed manual correction**
- **Scope creep from big AI-written specs.** A large "Visual Difference Studio" spec (slider / overlay / heatmap) was fully implemented and tested, then I realised I didn't need it and reverted it. A "Reset" helper and a "Security Settings" helper were also built and later removed. *The AI builds whatever the spec says, so the spec must state what I actually need.*
- **"It works" vs. "I can see it".** After one change I saw nothing new. The app was running from an old packaged copy (`dist/`), not the repo. The AI's tests passed, but my real environment differed.
- **Safety risk with real data.** Once a test run started with my real runtime environment. I stopped it, and since then tests use an isolated venv and temporary storage. Rules like "never touch real data" must be written down explicitly and repeated.
- **Unverified areas.** The Windows launcher was written but never run on a real Windows machine. The Next.js frontend drifted behind the standalone page. The AI says so honestly, but I have to track it.
- **AI analysis limits.** Codex sees separate frames, not motion, so judgements on timing and animation are weak. Each analysis also uses ChatGPT plan quota.

**Human effort:** deciding what to build, testing in the real app, rejecting features, and choosing what to commit. Most of the actual typing was done by the AI.

### 5. Recommendation

**Reuse**
- **Short, constraint-first prompts.** "Implement only X. Do not touch Y. Never delete real data. Use temporary test storage."
- **"Implement + test + tell me what isn't verified"** as the default request.
- **Keep a living `PROJECT-OVERVIEW.md`** to hand context between tools (Claude Code ↔ ChatGPT ↔ teammates).
- **Validate AI output in code** (schema, IDs, timestamps, limits) instead of trusting the model.
- **Try every change in the real app before committing.**

**Avoid**
- Pasting huge, all-in-one feature specs. Build one small feature, use it, then decide on the next.
- Assuming "tests pass" means "the user sees it". Check which build or path is actually running.
- Letting tests or tools run against real user data or the real environment.

---

## Part 2 — Short Individual Report

| | |
| --- | --- |
| **Task** | Build FrameMind AI: compare reference vs. current gameplay video and get AI feedback with Unity fixes |
| **Tool / workflow** | Claude Code for implementation and tests, ChatGPT for specs and docs, Codex CLI as the in-product AI; milestone specs → implement + test → real-app check → commit |
| **Result** | Working local tool for macOS (Windows untested): video compare, frame extraction, validated AI feedback, history, 3 languages, one-click launcher. _[link / video]_ |
| **Findings** | Very fast for the build itself and for tests. Weakest at deciding *what* is worth building: two features were built and thrown away. Real-environment checks and data-safety rules are still a human job. |
| **Recommendation** | **Reuse**, with small scoped tasks, explicit constraints, and human verification before every commit. |

## Group Discussion — my view

- **Real value:** AI coding agents for full-stack tooling and tests; AI-written docs that carry context between tools and people.
- **Human review is essential for:** product decisions (what to build or drop), checking in the real app, anything touching user data, and platforms the AI can't run (Windows, device builds).
- **Standardise:** a shared prompt template (scope + constraints + "list what's unverified"), a `PROJECT-OVERVIEW.md` in each repo, and a "tests never use real data" rule.
- **Future AX Hero challenges:** reward a small tool the team actually uses over a large feature list, and ask for a short "what failed / what we threw away" section, since that is where most of the learning is.

**Next step (planned, not started):** extend FrameMind into a Unity Development & QA assistant (GDD → requirement checklist → project scan → progress tracking). See `docs/ROADMAP-DEV-WORKSPACE.md`.
