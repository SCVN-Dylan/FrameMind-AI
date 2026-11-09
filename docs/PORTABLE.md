# FrameMind AI — Portable (macOS)

FrameMind AI compares a **Reference** and a **Current** gameplay video and gives AI feedback on matched frames or short clips. Everything runs on your Mac. The page is a single local file (`submission/index.html`), the backend listens only on `127.0.0.1`, and AI analysis uses **your** ChatGPT account through the official Codex CLI.

On Windows, use `Start FrameMind.bat` and see `README-Windows.md`.

## Quick start

1. Copy `FrameMind-Portable.zip` to the Mac (AirDrop, USB drive, cloud drive, …).
2. Double-click the ZIP to extract it. You can move the `FrameMind-Portable` folder anywhere you like; paths with spaces work.
3. Double-click **`Start FrameMind.command`**.
4. If something is missing, the window explains what it is and how it will be installed. It asks before each installation in a small window: click **Yes** to accept or **Not now** to skip. (If no window can be shown, for example over SSH, the question is asked in Terminal: type `y` and press Return.)
5. Your default browser opens FrameMind AI. In Safari a short "Opening FrameMind AI…" tab appears and closes by itself. Keep the Terminal window open while you use the app.
6. For AI analysis, open **Settings → AI Provider → Login with ChatGPT** (only needed once).

### The first time macOS blocks the file

Files that come from the internet or AirDrop are checked by Gatekeeper. Because the launcher is a script and not a signed app, macOS may say it *"cannot be opened"* or *"could not be verified"*.

- **macOS 15 (Sequoia) and newer:** click **Done**. Then open **System Settings → Privacy & Security**, scroll to *"Start FrameMind.command was blocked…"*, click **Open Anyway** and confirm.
- **macOS 12–14:** Control-click (or right-click) `Start FrameMind.command`, choose **Open**, then click **Open** again.

You only have to do this once. The launcher never turns Gatekeeper off or removes macOS security flags.

If the folder is in Downloads, Desktop or Documents, macOS may also ask whether **Terminal** may access that folder. Click **Allow**, because the launcher has to read its own files.

## What the launcher installs

It only installs what this Mac is missing, and only after you click **Yes**. Nothing is installed with `sudo` by the launcher.

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
  - Then click **Analyze**. Feedback is written in the language selected in the app (EN / VI / KO), and clicking a feedback card seeks both videos. Each pair gets up to 20 issues, most severe first.
- **Unity project (optional):** right above **Analyze**, the *Unity project* list chooses what the AI may also read:
  - *None: videos only* (the default), a project you used before, or *Add a project…* (*Choose folder…* or paste the
    path of the folder that contains `Assets/` and `ProjectSettings/`).
  - Click *Folders*, tick only what matters for this review (e.g. `Assets/Scenes`, your camera or VFX folder), then
    *Save folders*. **Nothing ticked = the videos only.**
  - Each project remembers its own ticked folders, so you can switch between projects; the bin button removes one
    from the list. The AI reads the ticked folders only, read-only: the rest of the project, `Library/` and the rest
    of your Mac stay blocked, and nothing is ever changed. The files it reads are sent to OpenAI with the analysis.
  - Feedback then names the file, GameObject, component and value to change. An analysis with a project takes longer
    (up to 10 minutes per pair). Scenes and prefabs are readable only with *Force Text* asset serialization.
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
├── framemind.db                  sessions, matched pairs, analyses, feedback, settings (AI model, Unity projects)
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
selected AI model, the chosen Unity project and its list, the pairing code, the language, `runtime/`, `logs/` and your ChatGPT sign-in. It cannot be undone.

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
| *A required tool is missing* | Run the launcher again and click **Yes**, or install the tool yourself (commands above). |
| *Installing the Python packages failed* | Usually there is no internet, or a proxy blocks pypi.org. Connect and start again. |
| *Port … is used by another program* | Nothing to do: the next free port is used. To choose a port, set `PORT=` in `launcher.conf`. |
| *The backend did not answer its health check* | Read the lines printed under the error, or `logs/backend.log`. |
| The page shows **AI Backend Offline** | The Terminal window was closed. Start FrameMind again. |
| The page asks for a pairing code | Copy the code from the Terminal window into Settings → Local backend. |
| Codex shows **Not signed in** | Settings → AI Provider → Login with ChatGPT. |
| Codex **not installed** | Start FrameMind again and click **Yes** to download its Codex CLI. |
| *Codex exited with an error* | Read the line shown in the app, or `logs/backend.log` (sign-in expired, usage limit, network). Sandbox start-up problems with a new Codex are retried automatically. |
| *The connected Unity project can't be read any more* | The folder moved or its drive is unmounted: pick another project, or *None: videos only*, above Analyze. |
| *Codex could not start its sandbox to read the Unity project* | Pick *None: videos only* to analyse the videos, or start FrameMind again to update Codex. |
| The Unity project list is missing | Reading a Unity project is available on macOS only. |
| Python environment errors | Delete `~/Library/Application Support/FrameMind AI/runtime` and start again (your data is kept). |

To check the tools without starting anything, run `scripts/check_dependencies.sh` in Terminal.
