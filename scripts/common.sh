# Shared settings and helpers for the FrameMind AI launcher scripts (macOS, /bin/bash 3.2).
# Sourced by the other scripts after they set APP_DIR; never run directly.
#
# Rules kept everywhere: every path is quoted, no eval, no sudo, nothing is installed without a "yes",
# and only processes this launcher started (recorded in the PID file and re-verified) are ever stopped.

# --- Locations -------------------------------------------------------------------------------------------
# User data lives outside the app folder, so the folder can be moved, replaced or read-only.
DATA_DIR="${FRAMEMIND_DATA_DIR:-$HOME/Library/Application Support/FrameMind AI}"
RUNTIME_DIR="$DATA_DIR/runtime"
VENV_DIR="$RUNTIME_DIR/venv"
VENV_PY="$VENV_DIR/bin/python"
VENV_STAMP="$VENV_DIR/.framemind-requirements"
LOG_DIR="$DATA_DIR/logs"
BACKEND_LOG="$LOG_DIR/backend.log"
RUN_DIR="$DATA_DIR/run"
PID_FILE="$RUN_DIR/backend.pid"
LOCK_DIR="$RUN_DIR/launcher.lock"
OPEN_PAGE="$RUN_DIR/open-framemind.html"
CONFIG_FILE="$DATA_DIR/launcher.conf"
PAIRING_FILE="$DATA_DIR/standalone_pairing_code.txt"

BACKEND_DIR="$APP_DIR/backend"
REQUIREMENTS="$BACKEND_DIR/requirements.txt"
INDEX_HTML="$APP_DIR/submission/index.html"

# Where Homebrew (Apple Silicon: /opt/homebrew, Intel: /usr/local) and its tools live. Overridable for tests.
TOOL_DIRS="${FRAMEMIND_TOOL_DIRS:-/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin}"

DEFAULT_PORT=8000
PORT_FALLBACK_COUNT=20
MIN_MACOS_MAJOR=12
APP_NAME="FrameMind AI"
BACKEND_MODULE="app.main:app"
HEALTH_TIMEOUT_SECONDS="${FRAMEMIND_HEALTH_TIMEOUT:-60}"

# --- Output ----------------------------------------------------------------------------------------------
if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_RESET=$'\033[0m'
else
  C_BOLD=""; C_DIM=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi

step() { printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_RESET"; }
info() { printf '    %s\n' "$*"; }
ok()   { printf '    %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '    %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
# error "what went wrong" ["how to fix it" ...]
error() {
  printf '\n%s✗ %s%s\n' "$C_RED" "$1" "$C_RESET" >&2
  shift
  local line
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
}

# ask_yes_no "Question" -> 0 for yes. Anything else, including no input (EOF), is "no".
ask_yes_no() {
  local answer=""
  printf '\n%s? %s%s [y/N] ' "$C_BOLD" "$1" "$C_RESET"
  if ! IFS= read -r answer; then
    printf '\n'
    return 1
  fi
  case "$answer" in
    y|Y|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

# --- Environment -----------------------------------------------------------------------------------------
# Double-clicked .command files may start with a minimal PATH. Add the Homebrew locations (if present)
# and npm's global bin, without dropping anything the user already has.
extend_path() {
  local dir old_ifs="$IFS"
  IFS=':'
  for dir in $TOOL_DIRS; do
    IFS="$old_ifs"
    if [ -d "$dir" ]; then
      case ":$PATH:" in *":$dir:"*) ;; *) PATH="$PATH:$dir" ;; esac
    fi
    IFS=':'
  done
  IFS="$old_ifs"
  if command -v npm >/dev/null 2>&1; then
    local npm_prefix
    npm_prefix="$(npm prefix -g 2>/dev/null || true)"
    if [ -n "$npm_prefix" ] && [ -d "$npm_prefix/bin" ]; then
      case ":$PATH:" in *":$npm_prefix/bin:"*) ;; *) PATH="$PATH:$npm_prefix/bin" ;; esac
    fi
  fi
  export PATH
}

find_brew() {
  local dir old_ifs="$IFS"
  if command -v brew >/dev/null 2>&1; then command -v brew; return 0; fi
  IFS=':'
  for dir in $TOOL_DIRS; do
    if [ -x "$dir/brew" ]; then IFS="$old_ifs"; printf '%s\n' "$dir/brew"; return 0; fi
  done
  IFS="$old_ifs"
  return 1
}

# Prints "major.minor" of a Python interpreter, or fails.
python_version_of() {
  "$1" -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null
}

# 3.9 (the Python that ships with Apple's Command Line Tools) through 3.13 are supported.
python_version_ok() {
  local major="${1%%.*}" minor="${1#*.}"
  [ "$major" = "3" ] && [ "$minor" -ge 9 ] 2>/dev/null && [ "$minor" -le 13 ]
}

# Prints the path of a supported Python 3, preferring the newest. Fails if there is none.
find_python() {
  local candidate path version
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    path="$(command -v "$candidate" 2>/dev/null)" || continue
    # /usr/bin/python3 is only a stub until the Command Line Tools are installed; running it would
    # pop up an install dialog, so only use it when they are present.
    if [ "$path" = "/usr/bin/python3" ] && ! xcode-select -p >/dev/null 2>&1; then
      continue
    fi
    version="$(python_version_of "$path")" || continue
    if python_version_ok "$version"; then
      printf '%s\n' "$path"
      return 0
    fi
  done
  return 1
}

find_codex() {
  command -v codex 2>/dev/null
}

# --- Configuration ---------------------------------------------------------------------------------------
# launcher.conf holds KEY=VALUE lines (currently only PORT). It is parsed, never sourced or evaluated.
load_config() {
  PORT="${FRAMEMIND_PORT:-}"
  if [ -z "$PORT" ] && [ -f "$CONFIG_FILE" ]; then
    local key value
    while IFS='=' read -r key value || [ -n "$key" ]; do
      key="$(printf '%s' "$key" | tr -d '[:space:]')"
      value="$(printf '%s' "$value" | tr -d '[:space:]')"
      case "$key" in
        ''|\#*) ;;
        PORT) PORT="$value" ;;
        *) warn "Ignoring unknown setting \"$key\" in $CONFIG_FILE" ;;
      esac
    done < "$CONFIG_FILE"
  fi
  PORT="${PORT:-$DEFAULT_PORT}"
  case "$PORT" in
    ''|*[!0-9]*) PORT_VALID=0 ;;
    *) if [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ]; then PORT_VALID=1; else PORT_VALID=0; fi ;;
  esac
  if [ "$PORT_VALID" != 1 ]; then
    error "Invalid configuration: PORT=\"$PORT\"." \
      "PORT must be a number from 1024 to 65535." \
      "Fix or delete: $CONFIG_FILE (or the FRAMEMIND_PORT variable)."
    return 1
  fi
}

ensure_data_dirs() {
  # 700: the folder holds the pairing code, the database and private videos.
  mkdir -p "$DATA_DIR" "$RUNTIME_DIR" "$LOG_DIR" "$RUN_DIR" || return 1
  chmod 700 "$DATA_DIR" 2>/dev/null || true
}

# --- Backend process -------------------------------------------------------------------------------------
# The PID file holds "<pid> <port>" for the backend this launcher started.
read_pid_file() {
  BACKEND_PID=""; BACKEND_PORT=""
  [ -f "$PID_FILE" ] || return 1
  read -r BACKEND_PID BACKEND_PORT < "$PID_FILE" || true
  case "$BACKEND_PID" in ''|*[!0-9]*) BACKEND_PID=""; return 1 ;; esac
  case "$BACKEND_PORT" in ''|*[!0-9]*) BACKEND_PORT=""; return 1 ;; esac
  return 0
}

# True only if <pid> is alive, is our uvicorn command for this module/port, and listens on that port.
# Never trust a PID alone: after a reboot the number may belong to an unrelated process.
is_our_backend() {
  local pid="$1" port="$2" command
  kill -0 "$pid" 2>/dev/null || return 1
  command="$(ps -p "$pid" -o command= 2>/dev/null)" || return 1
  case "$command" in
    *"-m uvicorn $BACKEND_MODULE "*"--host 127.0.0.1 --port $port") ;;
    *) return 1 ;;
  esac
  lsof -nP -a -p "$pid" -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

# Prints the /api/health JSON if a FrameMind AI backend answers on <port>.
framemind_health() {
  local body
  body="$(curl -fsS --max-time 3 "http://127.0.0.1:$1/api/health" 2>/dev/null)" || return 1
  case "$body" in
    *'"app_name":"FrameMind AI"'*) printf '%s\n' "$body"; return 0 ;;
    *) return 1 ;;
  esac
}

# lsof only sees this user's processes, so also try to bind the port (catches other users' servers).
port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  [ -x "$VENV_PY" ] || return 1
  ! "$VENV_PY" -c 'import socket, sys
s = socket.socket()
s.bind(("127.0.0.1", int(sys.argv[1])))
s.close()' "$1" 2>/dev/null
}

# "PID 123 (Python)" for this user's process listening on <port>, if lsof can see it.
port_owner() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -Fpc 2>/dev/null | awk '/^p/{pid=substr($0,2)} /^c/{print "PID " pid " (" substr($0,2) ")"; exit}'
}

# Stops the backend recorded in the PID file, only after verifying it is ours. Prints what it did.
stop_owned_backend() {
  read_pid_file || { info "No FrameMind AI backend was started by this launcher."; return 0; }
  if ! is_our_backend "$BACKEND_PID" "$BACKEND_PORT"; then
    info "The recorded backend (PID $BACKEND_PID) is no longer running."
    rm -f "$PID_FILE"
    return 0
  fi
  info "Stopping the FrameMind AI backend (PID $BACKEND_PID, port $BACKEND_PORT)..."
  # Removed first: tells the launcher window watching this PID that the stop was requested, not a crash.
  rm -f "$PID_FILE"
  kill -TERM "$BACKEND_PID" 2>/dev/null || true
  local waited=0
  while kill -0 "$BACKEND_PID" 2>/dev/null && [ "$waited" -lt 20 ]; do
    sleep 0.5; waited=$((waited + 1))
  done
  if kill -0 "$BACKEND_PID" 2>/dev/null && is_our_backend "$BACKEND_PID" "$BACKEND_PORT"; then
    warn "The backend did not stop within 10 seconds; forcing it to stop."
    kill -KILL "$BACKEND_PID" 2>/dev/null || true
  fi
  ok "Backend stopped."
}

# --- Opening the page ------------------------------------------------------------------------------------
# `open` drops the #fragment of file:// URLs, so the page is opened through a tiny private helper page in
# the data folder, which hands the backend address and pairing code to submission/index.html:
#   - "redirect" (Chrome, Firefox, …): forwards to index.html#pairing=…&api=… (the page then cleans its URL).
#   - "storage" (Safari): Safari blocks scripted file:// → file:// navigation, but its file:// pages share
#     localStorage. The helper saves both values there and closes itself; the launcher then opens index.html.
# The code never appears in a command line (`ps`), and the helper is readable by this user only.
write_open_page() {
  local port="$1" mode="$2" code
  code="$(tr -d '[:space:]' < "$PAIRING_FILE" 2>/dev/null)"
  case "$code" in
    [A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]-[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]-[A-Z0-9][A-Z0-9][A-Z0-9][A-Z0-9]) ;;
    *) error "The backend did not create a valid pairing code in $PAIRING_FILE"; return 1 ;;
  esac
  (
    umask 077
    printf '%s' "$code" | "$VENV_PY" -I -c '
import html, json, pathlib, sys, urllib.parse
index, port, mode, out = sys.argv[1:5]
code = sys.stdin.read().strip()
api = "http://127.0.0.1:" + port
target = pathlib.Path(index).as_uri() + "#" + urllib.parse.urlencode({"pairing": code, "api": api})
js = lambda value: json.dumps(value).replace("<", "\\u003c")
then = "setTimeout(function () { window.close(); }, 1500);" if mode == "storage" else "location.replace(%s);" % js(target)
page = """<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Opening FrameMind AI…</title>
<script>
try { localStorage.setItem("framemind-standalone-api", %s); localStorage.setItem("framemind-standalone-pairing", %s); } catch (e) {}
%s
</script>
<p style="font-family:-apple-system,sans-serif">Opening FrameMind AI… If it does not open, open <code>%s</code>. This tab can be closed.</p>
""" % (js(api), js(code), then, html.escape(index))
pathlib.Path(out).write_text(page, encoding="utf-8")
' "$INDEX_HTML" "$port" "$mode" "$OPEN_PAGE"
  )
}

# The app that opens https:// links, so the page opens in a browser even if .html files open in an editor.
default_browser_app() {
  osascript -l JavaScript -e 'ObjC.import("AppKit");
var u = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("https://example.com"));
u ? u.path.js : ""' 2>/dev/null
}

open_frontend() {
  local port="$1" browser="" mode="redirect" name
  if [ "${FRAMEMIND_OPEN_BROWSER:-1}" != 0 ]; then
    browser="$(default_browser_app)"
    [ -n "$browser" ] && [ -d "$browser" ] || browser=""
  fi
  case "$(basename "${browser:-none}" .app)" in Safari|"Safari Technology Preview") mode="storage" ;; esac
  write_open_page "$port" "$mode" || return 1
  if [ "${FRAMEMIND_OPEN_BROWSER:-1}" = 0 ]; then
    info "Not opening a browser (FRAMEMIND_OPEN_BROWSER=0). Helper page: $OPEN_PAGE"
    return 0
  fi
  if [ -n "$browser" ]; then
    name="$(basename "$browser" .app)"
    if open -a "$browser" "$OPEN_PAGE"; then
      if [ "$mode" = storage ]; then
        sleep 1.5  # let the helper save the address and code first (the page also picks them up later)
        open -a "$browser" "$INDEX_HTML" || { error "Could not open $INDEX_HTML in $name."; return 1; }
      fi
      ok "Opened FrameMind AI in $name."
      return 0
    fi
  fi
  open "$OPEN_PAGE" && { ok "Opened FrameMind AI in the default app for web pages."; return 0; }
  error "Could not open the browser." "Open this file in Chrome, Safari or Firefox: $INDEX_HTML"
  return 1
}
