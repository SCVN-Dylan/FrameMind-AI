# FrameMind AI — Portable (macOS)

FrameMind AI compares a **Reference** and a **Current** gameplay video and gives AI feedback on matched frames or short clips. Everything runs on your Mac. The page is a single local file (`submission/index.html`), the backend listens only on `127.0.0.1`, and AI analysis uses **your** ChatGPT account through the official Codex CLI.

On Windows, use `Start FrameMind.bat` and see `README-Windows.md`.

## Quick start

1. Copy `FrameMind-Portable.zip` to the Mac (AirDrop, USB drive, cloud drive, …).
2. Double-click the ZIP to extract it. You can move the `FrameMind-Portable` folder anywhere you like; paths with spaces work.
3. Double-click **`Start FrameMind.command`**.
4. If something is missing, the window explains what it is and how it will be installed. It asks before each installation. Type `y` and press Return to accept.
5. Your default browser opens FrameMind AI. In Safari a short "Opening FrameMind AI…" tab appears and closes by itself. Keep the Terminal window open while you use the app.
6. For AI analysis, open **Settings → AI Provider → Login with ChatGPT** (only needed once).

### The first time macOS blocks the file

Files that come from the internet or AirDrop are checked by Gatekeeper. Because the launcher is a script and not a signed app, macOS may say it *"cannot be opened"* or *"could not be verified"*.

- **macOS 15 (Sequoia) and newer:** click **Done**, then double-click **`Open Security Settings`** in the same folder. It opens **System Settings → Privacy & Security** for you: click **Open Anyway** next to *"Start FrameMind.command was blocked…"* (near the bottom, under Security) and confirm. If no button is shown, double-click `Start FrameMind.command` once more, then open the settings again.
- **macOS 12–14:** Control-click (or right-click) `Start FrameMind.command`, choose **Open**, then click **Open** again.

You only have to do this once. The launcher never turns Gatekeeper off or removes macOS security flags.

If the folder is in Downloads, Desktop or Documents, macOS may also ask whether **Terminal** may access that folder. Click **Allow**, because the launcher has to read its own files.

## What the launcher installs

It only installs what this Mac is missing, and only after you answer `y`. Nothing is installed with `sudo` by the launcher.

| Tool | Why | How it is installed |
| --- | --- | --- |
| Homebrew | Only needed to install the tools below | The official installer from brew.sh. It explains itself and asks for your macOS password; an administrator account is required. |
| Python 3.9–3.13 | Runs the backend | `brew install python@3.12` (the Python that comes with Apple's Command Line Tools also works) |
| FFmpeg | Reads videos and extracts frames | `brew install ffmpeg` |
| Codex CLI (optional) | AI analysis with your ChatGPT account | FrameMind AI downloads **its own copy** of the latest release (OpenAI's official package from the npm registry, about 150 MB, checked against the registry's SHA-512) into `runtime/codex`, and keeps it up to date. See below. |
| Python packages | The backend's libraries (`backend/requirements.txt`) | Installed into a private virtual environment, never into the system Python |

Node.js is **not** required. If you skip Codex CLI, FrameMind AI still opens, and AI analysis is shown as disconnected until you install it.

### FrameMind AI's own Codex CLI

FrameMind AI does not depend on the Codex installed on the Mac. The first start asks to download its own copy of the latest Codex CLI. Each later start checks for a newer release and updates the copy without asking. If the update fails or you are offline, the current copy is kept. Updating, replacing or removing any other Codex on the Mac does not affect it.

New Codex versions sometimes change how their sandbox starts. FrameMind AI runs Codex with its own, tighter read-only settings. If a Codex version cannot start with them, FrameMind AI retries once with Codex's built-in read-only settings and keeps using those for that version. Both are read-only and offline, and Codex's shell tool stays off. The log notes the switch.

The copy uses the same ChatGPT sign-in as any other Codex on the Mac (`~/.codex`), so you sign in only once. If you decline the download, FrameMind AI uses the `codex` command it finds on the Mac.

The first launch needs internet and takes a few minutes. Later launches reuse everything and start in a few seconds.

## Using FrameMind AI

- **New Analysis:** choose the two videos, then match moments:
  - *Single Frame:* the same moment at a different time in each video.
  - *Short Clip:* Start/End in each video, durations may differ, at most 10 seconds each.
  - Then click **Analyze**. Feedback is written in the language selected in the app (EN / VI / KO), and clicking a feedback card seeks both videos.
- **History:** reopens saved sessions with their feedback.
- **Full Video** analysis is not available yet (marked *Future*).

Real AI analysis uses your ChatGPT plan's Codex usage. FrameMind AI never uses an OpenAI API key and refuses to run if Codex is signed in with one.

## ChatGPT sign-in and models (Settings → AI Provider)

- **Login with ChatGPT:** starts the official `codex login`. A browser tab opens on OpenAI's sign-in page. FrameMind AI never sees your password or tokens. If no tab opens, use the link shown in Settings, or the *Sign in from Terminal instead* commands.
- **Logout:** runs `codex logout`.
- **Switch account:** click Logout, then Login with ChatGPT and choose the other account.
- **Model:** pick one of the models your account can use, as reported by the installed Codex CLI, or keep the Codex default.
- **Refresh connection:** checks the installation and the sign-in again.

Sign-in is stored by Codex CLI on this Mac (in `~/.codex`). It is never copied from or to another computer, so each Mac signs in once.

## Where your data is saved

```
~/Library/Application Support/FrameMind AI/
├── framemind.db                  sessions, matched pairs, analyses, feedback, settings
├── videos/                       uploaded videos
├── frames/                       extracted frames
├── standalone_pairing_code.txt   the page's pairing code (private)
├── runtime/venv/                 Python environment (safe to delete; it is rebuilt)
├── runtime/codex/                FrameMind AI's own Codex CLI (safe to delete; it is downloaded again)
├── logs/backend.log              backend log
├── run/                          PID file and the page opener
└── launcher.conf                 optional settings (you create it)
```

Moving, replacing or deleting the app folder does not touch this data. Deleting this folder deletes your history and videos.

To start over without touching anything else, use **Settings → Data Management → Clear All Data** (type `DELETE` to
confirm). It deletes the videos, frames, sessions, analyses and feedback above and keeps `framemind.db` (empty), your
selected AI model, the pairing code, the language, `runtime/`, `logs/` and your ChatGPT sign-in. It cannot be undone.

To set FrameMind AI up again from scratch, double-click **`Reset FrameMind.command`**. It stops FrameMind AI, then asks:

- **1 — Reinstall:** removes `runtime/` (the Python environment and FrameMind AI's Codex CLI). Your sessions, videos and settings are kept. The next start installs them again.
- **2 — Remove everything:** deletes the whole folder above (type `DELETE` to confirm). It cannot be undone.

Homebrew tools (Python, FFmpeg), any other Codex and your ChatGPT sign-in are never touched.

To use another port than 8000, create `launcher.conf` there with a line such as `PORT=8765`. If the port is busy, the launcher uses the next free one.

## Stopping

Any of these stops the backend:

- Press **Control-C** in the FrameMind window.
- Close the window.
- Double-click **`Stop FrameMind.command`**.

Only the backend that the launcher started is stopped, and other programs are never touched. Double-clicking `Start FrameMind.command` while FrameMind is already running just opens the page again.

## The pairing code

Pages opened from disk send `Origin: null`, and so do sandboxed frames on any website. The backend therefore only accepts the page together with a pairing code that only someone using this Mac can read. The launcher fills it in automatically (tested with Chrome and Safari; other browsers get it through the page URL). To open the page in a different browser, copy the code shown in the Terminal window into **Settings → Local backend**.

## Troubleshooting

| Message / symptom | What to do |
| --- | --- |
| *cannot be opened* / *could not be verified* | See "The first time macOS blocks the file" above. |
| *A required tool is missing* | Run the launcher again and answer `y`, or install the tool yourself (commands above). |
| *Installing the Python packages failed* | Usually there is no internet, or a proxy blocks pypi.org. Connect and start again. |
| *Port … is used by another program* | Nothing to do: the next free port is used. To choose a port, set `PORT=` in `launcher.conf`. |
| *The backend did not answer its health check* | Read the lines printed under the error, or `logs/backend.log`. |
| The page shows **AI Backend Offline** | The Terminal window was closed. Start FrameMind again. |
| The page asks for a pairing code | Copy the code from the Terminal window into Settings → Local backend. |
| Codex shows **Not signed in** | Settings → AI Provider → Login with ChatGPT. |
| Codex **not installed** | Start FrameMind again and answer `y` to download its Codex CLI. |
| *Codex exited with an error* | Read the line shown in the app, or `logs/backend.log` (sign-in expired, usage limit, network). Sandbox start-up problems with a new Codex are retried automatically. |
| Python environment errors | Double-click `Reset FrameMind.command`, choose **1**, then start again (your data is kept). |

To check the tools without starting anything, run `scripts/check_dependencies.sh` in Terminal.
