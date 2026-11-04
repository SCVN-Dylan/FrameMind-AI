# FrameMind AI — Portable (Windows 10 / 11)

The same ZIP runs on macOS and Windows. On Windows, use **`Start FrameMind.bat`**. The page is a single local file (`submission\index.html`), the backend listens only on `127.0.0.1`, and AI analysis uses **your** ChatGPT account through the official Codex CLI.

## Quick start

1. Copy `FrameMind-Portable.zip` to the PC.
2. Right-click the ZIP and choose **Extract All…**. Running it from inside the ZIP does not work. You can put the `FrameMind-Portable` folder anywhere you like, and paths with spaces work.
3. Double-click **`Start FrameMind.bat`**.
4. If something is missing, the window explains what it is and how it will be installed. It asks before each installation: type `y` and press Enter.
5. Your default browser opens FrameMind AI. Keep the black window open while you use the app.
6. For AI analysis, open **Settings → AI Provider → Login with ChatGPT**. You only need to do this once on each PC.

### The first time Windows blocks the file

Files from the internet may show **"Windows protected your PC"** (SmartScreen), because the launcher is a script and not a signed program. Click **More info → Run anyway**. You only have to do this once. The launcher never changes Windows security settings. It runs PowerShell with `-ExecutionPolicy Bypass` only for its own scripts, and only for that run.

## What the launcher installs

It only installs what the PC is missing, and only after you answer `y`. It uses **winget** (App Installer, built into Windows 10 2004+ and Windows 11). Node.js is not needed.

| Tool | Why | How it is installed |
| --- | --- | --- |
| Python 3.9–3.13 | Runs the backend | `winget install --id Python.Python.3.12 --exact --scope user` |
| FFmpeg | Reads videos and extracts frames | `winget install --id Gyan.FFmpeg --exact` |
| Codex CLI (optional) | AI analysis with your ChatGPT account | FrameMind AI downloads **its own copy** of the latest release (OpenAI's official package from the npm registry, about 200 MB, checked against the registry's SHA-512) into `runtime\codex`. Each later start updates it without asking, and keeps the current copy if the update fails. Any other Codex on the PC is not affected, and it uses the same ChatGPT sign-in. |
| Python packages | The backend's libraries (`backend\requirements.txt`) | Installed into a private virtual environment, never into the system Python |

The first launch needs internet and takes a few minutes. If a tool was just installed and is still "not found", close the window and start again, because Windows sometimes only updates PATH for new windows. If you skip Codex CLI, FrameMind AI still opens, and AI analysis shows as disconnected.

## Where your data is saved

```
%LOCALAPPDATA%\FrameMind AI\        (C:\Users\<you>\AppData\Local\FrameMind AI)
├── framemind.db                  sessions, matched pairs, analyses, feedback, settings
├── videos\  frames\              uploaded videos and extracted frames
├── standalone_pairing_code.txt   the page's pairing code (private)
├── runtime\venv\                 Python environment (safe to delete; it is rebuilt)
├── logs\backend.err.log          backend log (backend.log has the rest of its output)
├── run\                          PID file and the page opener
└── launcher.conf                 optional settings (you create it), e.g. PORT=8765
```

Moving, replacing or deleting the app folder does not touch this data. To start over, use **Settings → Data Management → Clear All Data**.

## Stopping

Any of these stops the backend: press **Ctrl+C** in the FrameMind window, close the window, or double-click **`Stop FrameMind.bat`**. Only the backend that the launcher started is stopped.

## Troubleshooting

| Message / symptom | What to do |
| --- | --- |
| *Windows protected your PC* | Click **More info → Run anyway**. |
| *winget (App Installer) is not available* | Install **App Installer** from the Microsoft Store, or install the tool yourself from its website. |
| A tool is still "not found" right after installing it | Close the window and double-click `Start FrameMind.bat` again. |
| *Installing the Python packages failed* | Usually there is no internet, or a proxy blocks pypi.org. |
| *The backend did not answer its health check* | Read the lines printed under the error, or `logs\backend.err.log`. |
| The page shows **AI Backend Offline** | The FrameMind window was closed. Start it again. |
| *Codex exited with an error* | Run `codex exec --skip-git-repo-check "say hi"` in a terminal to see Codex's own message (sign-in expired, usage limit, network). |
| Python environment errors | Delete `%LOCALAPPDATA%\FrameMind AI\runtime` and start again. Your data is kept. |

## Known limitations

- Codex CLI's sandbox on Windows is newer than on macOS. If analyses keep failing with *Codex exited with an error* while `codex exec` works in a terminal, please report the line from `logs\backend.err.log`.
- Built for Windows x64. Windows on ARM needs Python packages that have ARM64 builds, and these are not guaranteed.
