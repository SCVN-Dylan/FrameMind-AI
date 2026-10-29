#!/bin/bash
# Tests for the macOS launcher (developer tool, not shipped).
#
#   scripts/tests/test_launcher.sh [work dir]
#
# Installation steps run against mocks (fake brew / curl / python / codex in a sandbox PATH): nothing is
# installed on this Mac. The real parts — virtual environment, backend start/stop, health checks, pairing,
# data preservation and the ZIP — run against a throwaway data folder whose path contains spaces.
# Python packages are downloaded from PyPI into that throwaway environment (needs internet).
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
WORK="${1:-$(mktemp -d -t framemind-launcher-tests)}"
APP_PARENT="$WORK/Some Folder/With Spaces"
APP="$APP_PARENT/FrameMind-Portable"
DATA="$WORK/Test Data/FrameMind AI"
SANDBOX="$WORK/sandbox"
TEST_PORT="${TEST_PORT:-18720}"

PASSED=0; FAILED=0
pass() { PASSED=$((PASSED + 1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/       /'; }
check() { local name="$1"; shift; if "$@"; then pass "$name"; else fail "$name"; fi; }
contains() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

cleanup() {
  [ -n "${BLOCKER_PID:-}" ] && kill "$BLOCKER_PID" 2>/dev/null
  [ -n "${LAUNCHER_PID:-}" ] && kill "$LAUNCHER_PID" 2>/dev/null
  if [ -d "$APP" ]; then
    FRAMEMIND_DATA_DIR="$DATA" /bin/bash "$APP/scripts/stop_backend.sh" >/dev/null 2>&1
  fi
}
trap cleanup EXIT

printf 'Work dir: %s\n' "$WORK"

# --------------------------------------------------------------------------------------------------------
section "1. Syntax and permissions"
for f in "$REPO/Start FrameMind.command" "$REPO/Stop FrameMind.command" "$REPO"/scripts/*.sh; do
  check "bash -n $(basename "$f")" /bin/bash -n "$f"
done
check "Start FrameMind.command is executable" test -x "$REPO/Start FrameMind.command"
check "Stop FrameMind.command is executable" test -x "$REPO/Stop FrameMind.command"
check "launcher scripts use no eval" sh -c '! grep -nE "(^|[;&| ])eval " "$1"/scripts/*.sh "$1"/*.command' _ "$REPO"
check "launcher scripts never call sudo" sh -c '! grep -nE "(^|[;&| ])sudo " "$1"/scripts/*.sh "$1"/*.command' _ "$REPO"

# --------------------------------------------------------------------------------------------------------
section "2. Package (ZIP) contents"
/bin/bash "$REPO/scripts/build_portable.sh" "$WORK/dist" >/dev/null || fail "build_portable.sh"
ZIP="$WORK/dist/FrameMind-Portable.zip"
LISTING="$(unzip -Z1 "$ZIP")"
for wanted in "FrameMind-Portable/Start FrameMind.command" "FrameMind-Portable/Stop FrameMind.command" \
  FrameMind-Portable/submission/index.html FrameMind-Portable/backend/requirements.txt FrameMind-Portable/backend/app/main.py \
  FrameMind-Portable/scripts/setup.sh FrameMind-Portable/scripts/start_backend.sh FrameMind-Portable/scripts/check_dependencies.sh \
  FrameMind-Portable/README.md; do
  check "ZIP contains $wanted" contains "$LISTING" "$wanted"
done
check "ZIP has no tests, venvs, node_modules, .env, databases, videos, git or caches" \
  sh -c '! printf "%s\n" "$1" | grep -E "tests/|venv|node_modules|\.env|\.db$|\.mp4$|\.mov$|\.git/|__pycache__|\.next/|frontend/|storage/|pairing_code|auth\.json|\._"' _ "$LISTING"
mkdir -p "$APP_PARENT"
(cd "$APP_PARENT" && ditto -x -k "$ZIP" .) || fail "extract ZIP"
check "extracted to a path with spaces" test -f "$APP/submission/index.html"
check "executable bit kept in ZIP (Start)" test -x "$APP/Start FrameMind.command"
check "executable bit kept in ZIP (scripts)" test -x "$APP/scripts/start_backend.sh"

# --------------------------------------------------------------------------------------------------------
section "3. Dependency detection and installation prompts (mocks)"
make_sandbox() {
  rm -rf "$SANDBOX"; mkdir -p "$SANDBOX/bin" "$SANDBOX/brew/bin"
  local tool
  for tool in bash sh uname sw_vers sysctl cat grep sed awk mkdir rm mv chmod date dirname basename head tail tr cut \
    sleep ps lsof shasum wc mktemp env id ln cp; do
    ln -s "$(command -v "$tool")" "$SANDBOX/bin/$tool"
  done
  : > "$SANDBOX/calls.log"
  # curl: network checks succeed; a download writes a fake Homebrew installer that "installs" fake brew.
  cat > "$SANDBOX/bin/curl" <<EOF
#!/bin/bash
echo "curl \$*" >> "$SANDBOX/calls.log"
out=""; while [ \$# -gt 0 ]; do [ "\$1" = "-o" ] && out="\$2"; shift; done
if [ -n "\$out" ]; then
  printf '%s\n' '#!/bin/bash' 'echo homebrew-installer-ran >> "$SANDBOX/calls.log"' \
    'cp "$SANDBOX/fake-brew" "$SANDBOX/brew/bin/brew"' > "\$out"
fi
exit 0
EOF
  cat > "$SANDBOX/fake-brew" <<EOF
#!/bin/bash
echo "brew \$*" >> "$SANDBOX/calls.log"
case "\$*" in
  "install python@3.12") printf '#!/bin/bash\necho 3.12\n' > "$SANDBOX/brew/bin/python3.12"; chmod +x "$SANDBOX/brew/bin/python3.12" ;;
  "install ffmpeg") for b in ffmpeg ffprobe; do printf '#!/bin/bash\necho "\$b version 9.9-mock"\n' > "$SANDBOX/brew/bin/\$b"; chmod +x "$SANDBOX/brew/bin/\$b"; done ;;
  "install --cask codex") cp "$SANDBOX/fake-codex" "$SANDBOX/brew/bin/codex" ;;
esac
EOF
  cat > "$SANDBOX/fake-codex" <<'EOF'
#!/bin/bash
case "$*" in
  --version) echo "codex-cli 0.0.0-mock" ;;
  "login status") echo "Not logged in"; exit 1 ;;
esac
EOF
  chmod +x "$SANDBOX/bin/curl" "$SANDBOX/fake-brew" "$SANDBOX/fake-codex"
}
run_deps() {  # run_deps "<answers>" [--install]
  printf '%b' "$1" | env -i HOME="$WORK/home" PATH="$SANDBOX/bin" FRAMEMIND_TOOL_DIRS="$SANDBOX/brew/bin" \
    FRAMEMIND_DATA_DIR="$DATA" /bin/bash "$APP/scripts/check_dependencies.sh" ${2:+"$2"} 2>&1
}

make_sandbox
OUT="$(run_deps "")"; STATUS=$?
check "nothing installed: report-only run exits 1" test "$STATUS" = 1
check "missing Python is explained" contains "$OUT" "Python 3 (3.9–3.13) was not found"
check "missing FFmpeg is explained" contains "$OUT" "FFmpeg was not found"
check "missing Codex is explained and optional" contains "$OUT" "Continuing without Codex CLI"
check "missing Homebrew is explained" contains "$OUT" "Homebrew (https://brew.sh) is not installed"
check "report-only run installs nothing" test ! -s "$SANDBOX/calls.log"

OUT="$(run_deps "n\nn\nn\n" --install)"; STATUS=$?
check "--install, answer no: exits 1" test "$STATUS" = 1
check "--install asks before installing Homebrew" contains "$OUT" "Install Homebrew now? [y/N]"
check "--install, answer no: installer never downloaded or run" sh -c '! grep -q "raw.githubusercontent\|installer-ran\|^brew" "$1"' _ "$SANDBOX/calls.log"

make_sandbox
OUT="$(run_deps "" --install)"; STATUS=$?
check "--install with no input (EOF) counts as no" sh -c '[ "$1" = 1 ] && ! grep -q "installer-ran\|^brew" "$2"' _ "$STATUS" "$SANDBOX/calls.log"

make_sandbox
OUT="$(run_deps "y\ny\ny\ny\n" --install)"; STATUS=$?
check "--install, answer yes: exits 0" test "$STATUS" = 0
check "Homebrew installer downloaded from the official URL, then run" \
  sh -c 'grep -q "raw.githubusercontent.com/Homebrew/install/HEAD/install.sh" "$1" && grep -q installer-ran "$1"' _ "$SANDBOX/calls.log"
check "Python installed with brew install python@3.12" grep -qx "brew install python@3.12" "$SANDBOX/calls.log"
check "FFmpeg installed with brew install ffmpeg" grep -qx "brew install ffmpeg" "$SANDBOX/calls.log"
check "Codex installed with brew install --cask codex" grep -qx "brew install --cask codex" "$SANDBOX/calls.log"
check "installations are verified afterwards" sh -c 'contains() { case "$1" in *"$2"*) return 0;; esac; return 1; }; contains "$1" "Python 3.12:" && contains "$1" "codex-cli 0.0.0-mock"' _ "$OUT"
check "unauthenticated Codex: continues, shown as not signed in" contains "$OUT" "Codex is not signed in"

make_sandbox
cp "$SANDBOX/fake-brew" "$SANDBOX/brew/bin/brew"
OUT="$(run_deps "n\ny\nn\n" --install)"; STATUS=$?
check "partial approval: declined Python stays missing (exit 1)" test "$STATUS" = 1
check "partial approval: only the approved FFmpeg was installed" \
  sh -c 'grep -qx "brew install ffmpeg" "$1" && ! grep -q "python@3.12\|--cask codex" "$1"' _ "$SANDBOX/calls.log"

mv "$APP/submission/index.html" "$APP/submission/index.html.bak"
OUT="$(run_deps "")"; STATUS=$?
mv "$APP/submission/index.html.bak" "$APP/submission/index.html"
check "missing index.html is reported (exit 2)" sh -c '[ "$1" = 2 ]' _ "$STATUS"
check "missing index.html message" contains "$OUT" "submission/index.html"

# Real tools on this Mac (read-only checks).
OUT="$(FRAMEMIND_DATA_DIR="$DATA" /bin/bash "$APP/scripts/check_dependencies.sh" < /dev/null 2>&1)"; STATUS=$?
check "real Mac: dependencies found (exit 0)" test "$STATUS" = 0
check "real Mac: Codex CLI detected" contains "$OUT" "codex-cli"
printf '%s\n' "$OUT" | grep -E "macOS|Python|FFmpeg|codex|Codex" | sed 's/^/       /'

# --------------------------------------------------------------------------------------------------------
section "4. Python environment"
export FRAMEMIND_DATA_DIR="$DATA"
START=$(date +%s); OUT="$(/bin/bash "$APP/scripts/setup.sh" < /dev/null 2>&1)"; STATUS=$?
check "setup.sh creates the environment" test "$STATUS" = 0 -a -x "$DATA/runtime/venv/bin/python"
[ "$STATUS" = 0 ] || printf '%s\n' "$OUT" | tail -n 15
check "data folder is private (700)" test "$(stat -f %Lp "$DATA")" = 700
START=$(date +%s); OUT="$(/bin/bash "$APP/scripts/setup.sh" < /dev/null 2>&1)"; ELAPSED=$(( $(date +%s) - START ))
check "second setup.sh reuses the environment" contains "$OUT" "up to date (reused)"
check "second setup.sh is fast (${ELAPSED}s)" test "$ELAPSED" -lt 10
check "app folder untouched (no __pycache__ written)" test -z "$(find "$APP" -name __pycache__)"
printf 'PORT=abc\n' > "$DATA/launcher.conf"
OUT="$(/bin/bash "$APP/scripts/start_backend.sh" < /dev/null 2>&1)"; STATUS=$?
rm -f "$DATA/launcher.conf"
check "invalid launcher.conf is rejected" sh -c '[ "$1" != 0 ] && case "$2" in *"Invalid configuration"*) exit 0;; esac; exit 1' _ "$STATUS" "$OUT"
printf 'PORT=8000; touch %s/pwned\n' "$WORK" > "$DATA/launcher.conf"
/bin/bash "$APP/scripts/start_backend.sh" < /dev/null >/dev/null 2>&1
rm -f "$DATA/launcher.conf"
check "launcher.conf is never executed" test ! -e "$WORK/pwned"

# --------------------------------------------------------------------------------------------------------
section "5. Backend start, port conflict, duplicates, pairing"
VENV_PY="$DATA/runtime/venv/bin/python"
# From here on the backend gets a fake Codex CLI, so no test can touch the real Codex sign-in.
mkdir -p "$WORK/fake-codex-bin"; cp "$SANDBOX/fake-codex" "$WORK/fake-codex-bin/codex"
export PATH="$WORK/fake-codex-bin:$PATH"
# An unrelated program on the configured port.
"$VENV_PY" -c 'import socket, sys, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1", int(sys.argv[1]))); s.listen(); time.sleep(600)' "$TEST_PORT" &
BLOCKER_PID=$!
sleep 1
export FRAMEMIND_PORT="$TEST_PORT"
OUT="$(/bin/bash "$APP/scripts/start_backend.sh" < /dev/null 2>&1)"; STATUS=$?
check "backend starts" test "$STATUS" = 0
[ "$STATUS" = 0 ] || printf '%s\n' "$OUT" | tail -n 30
read -r PID PORT < "$DATA/run/backend.pid"
check "busy port detected, next port used ($PORT)" sh -c '[ "$1" = "$(($2 + 1))" ] && case "$3" in *"used by another program"*) exit 0;; esac; exit 1' _ "$PORT" "$TEST_PORT" "$OUT"
check "unrelated program on the busy port still running" kill -0 "$BLOCKER_PID"
check "bound to 127.0.0.1 only" sh -c 'lsof -nP -a -p "$1" -iTCP -sTCP:LISTEN | grep -q "127.0.0.1:$2" && ! lsof -nP -a -p "$1" -iTCP -sTCP:LISTEN | grep -q "\*:$2"' _ "$PID" "$PORT"
HEALTH="$(curl -fsS "http://127.0.0.1:$PORT/api/health")"
check "health check ok (database, storage, ffmpeg)" sh -c 'case "$1" in *"\"database\":true"*"\"storage\":true"*"\"ffmpeg\":true"*) exit 0;; esac; exit 1' _ "$HEALTH"
check "database created in the data folder" test -f "$DATA/framemind.db"
check "pairing code created with owner-only permissions" test "$(stat -f %Lp "$DATA/standalone_pairing_code.txt")" = 600
CODE="$(tr -d '[:space:]' < "$DATA/standalone_pairing_code.txt")"
check "pairing code is not written to the log" sh -c '! grep -q "$1" "$2"' _ "$CODE" "$DATA/logs/backend.log"
check "log file is private (600)" test "$(stat -f %Lp "$DATA/logs/backend.log")" = 600

OUT2="$(/bin/bash "$APP/scripts/start_backend.sh" < /dev/null 2>&1)"
read -r PID2 PORT2 < "$DATA/run/backend.pid"
check "second start reuses the same backend (no duplicate)" sh -c '[ "$1" = "$2" ] && [ "$3" = "$4" ]' _ "$PID" "$PID2" "$PORT" "$PORT2"
check "only one FrameMind backend process" test "$(pgrep -f "uvicorn app.main:app --app-dir $APP/backend" | wc -l | tr -d ' ')" = 1

S1="$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: null' "http://127.0.0.1:$PORT/api/sessions")"
S2="$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: null' -H "X-FrameMind-Pairing: $CODE" "http://127.0.0.1:$PORT/api/sessions")"
S3="$(curl -s -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' -X POST "http://127.0.0.1:$PORT/api/ai/provider/login")"
check "file:// page without pairing code is refused (403)" test "$S1" = 403
check "file:// page with pairing code is accepted (200)" test "$S2" = 200
check "login from an unrelated website is refused ($S3)" test "$S3" = 403
CORS="$(curl -s -D - -o /dev/null -H 'Origin: null' -H "X-FrameMind-Pairing: $CODE" "http://127.0.0.1:$PORT/api/health" | tr -d '\r')"
check "CORS allows the file:// page" contains "$CORS" "access-control-allow-origin: null"

FRAMEMIND_OPEN_BROWSER=0 /bin/bash -c 'APP_DIR="$1"; . "$1/scripts/common.sh"; open_frontend "$2"' _ "$APP" "$PORT" >/dev/null 2>&1
check "page opener is private (600)" test "$(stat -f %Lp "$DATA/run/open-framemind.html")" = 600
OPENER="$(cat "$DATA/run/open-framemind.html")"
INDEX_URI="$("$VENV_PY" -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).as_uri())' "$APP/submission/index.html")"
check "opener points to submission/index.html (file://, spaces encoded)" contains "$OPENER" "$INDEX_URI#pairing=$CODE&api=http%3A%2F%2F127.0.0.1%3A$PORT"
check "opener also saves address and code to localStorage" contains "$OPENER" "localStorage.setItem(\"framemind-standalone-pairing\", \"$CODE\")"
/bin/bash -c 'APP_DIR="$1"; . "$1/scripts/common.sh"; write_open_page "$2" storage' _ "$APP" "$PORT"
OPENER="$(cat "$DATA/run/open-framemind.html")"
check "Safari helper saves to localStorage and closes, no file:// redirect" \
  sh -c 'case "$1" in *"location.replace"*) exit 1;; *"localStorage.setItem(\"framemind-standalone-api\", \"http://127.0.0.1:$2\")"*"window.close()"*) exit 0;; esac; exit 1' _ "$OPENER" "$PORT"

# --------------------------------------------------------------------------------------------------------
section "6. Data preservation, stale PID file, shutdown"
SESSION="$(curl -fsS -H 'Origin: null' -H "X-FrameMind-Pairing: $CODE" -H 'Content-Type: application/json' \
  -d '{"name":"launcher persistence test"}' "http://127.0.0.1:$PORT/api/sessions")"
check "session created through the backend" contains "$SESSION" "launcher persistence test"

OUT="$(/bin/bash "$APP/scripts/stop_backend.sh" 2>&1)"
sleep 1
check "stop_backend.sh stops our backend" sh -c '! kill -0 "$1" 2>/dev/null' _ "$PID"
check "PID file removed" test ! -f "$DATA/run/backend.pid"
check "unrelated program not stopped" kill -0 "$BLOCKER_PID"
OUT="$(/bin/bash "$APP/scripts/stop_backend.sh" 2>&1)"
check "stopping again is harmless" contains "$OUT" "No FrameMind AI backend was started"

# A stale PID file pointing at an unrelated process must neither be reused nor stopped.
printf '%s %s\n' "$BLOCKER_PID" "$TEST_PORT" > "$DATA/run/backend.pid"
OUT="$(/bin/bash "$APP/scripts/stop_backend.sh" 2>&1)"
check "stale PID of an unrelated process is not killed" kill -0 "$BLOCKER_PID"
printf '%s %s\n' "$BLOCKER_PID" "$TEST_PORT" > "$DATA/run/backend.pid"
/bin/bash "$APP/scripts/setup.sh" < /dev/null >/dev/null 2>&1
OUT="$(/bin/bash "$APP/scripts/start_backend.sh" < /dev/null 2>&1)"
read -r PID PORT < "$DATA/run/backend.pid"
check "stale PID file ignored, new backend started" sh -c '[ "$1" != "$2" ] && kill -0 "$1"' _ "$PID" "$BLOCKER_PID"
LIST="$(curl -fsS -H 'Origin: null' -H "X-FrameMind-Pairing: $CODE" "http://127.0.0.1:$PORT/api/sessions")"
check "history kept after restart and re-setup" contains "$LIST" "launcher persistence test"
check "same pairing code after restart" test "$(tr -d '[:space:]' < "$DATA/standalone_pairing_code.txt")" = "$CODE"
/bin/bash "$APP/scripts/stop_backend.sh" >/dev/null 2>&1
kill "$BLOCKER_PID" 2>/dev/null; BLOCKER_PID=""

# --------------------------------------------------------------------------------------------------------
section "7. Start FrameMind.command end to end (no browser), repeated launch, Control-C / window close"
run_launcher() {  # background launcher; output in $WORK/launcher-$1.log
  # Background jobs start with SIGINT ignored; restore it, as in a Terminal window.
  FRAMEMIND_OPEN_BROWSER=0 "$VENV_PY" -c 'import os, signal, sys; signal.signal(signal.SIGINT, signal.SIG_DFL); os.execv(sys.argv[1], sys.argv[1:])' \
    "$APP/Start FrameMind.command" < /dev/null > "$WORK/launcher-$1.log" 2>&1 &
  LAUNCHER_PID=$!
  local i=0
  while [ "$i" -lt 90 ] && ! grep -q "is running\|already running\|did not start" "$WORK/launcher-$1.log"; do sleep 1; i=$((i + 1)); done
}
run_launcher a
check "launcher reports FrameMind AI is running" grep -q "FrameMind AI is running" "$WORK/launcher-a.log"
check "launcher shows 'Welcome back' on a later launch" grep -q "Welcome back" "$WORK/launcher-a.log"
read -r PID PORT < "$DATA/run/backend.pid"
FIRST_LAUNCHER="$LAUNCHER_PID"

run_launcher b
check "second launch reuses the running backend and exits" grep -q "already running" "$WORK/launcher-b.log"
sleep 1
check "second launcher exited, first still running" sh -c '! kill -0 "$1" 2>/dev/null && kill -0 "$2"' _ "$LAUNCHER_PID" "$FIRST_LAUNCHER"

kill -HUP "$FIRST_LAUNCHER"   # what closing the Terminal window sends
i=0; while [ "$i" -lt 20 ] && kill -0 "$PID" 2>/dev/null; do sleep 0.5; i=$((i + 1)); done
check "closing the window (SIGHUP) stops the backend" sh -c '! kill -0 "$1" 2>/dev/null' _ "$PID"
check "graceful shutdown logged" grep -q "Application shutdown complete" "$DATA/logs/backend.log"

run_launcher c
read -r PID PORT < "$DATA/run/backend.pid"
kill -INT "$LAUNCHER_PID"
i=0; while [ "$i" -lt 20 ] && kill -0 "$PID" 2>/dev/null; do sleep 0.5; i=$((i + 1)); done
check "Control-C (SIGINT) stops the backend" sh -c '! kill -0 "$1" 2>/dev/null' _ "$PID"

run_launcher d
read -r PID PORT < "$DATA/run/backend.pid"
/bin/bash "$APP/scripts/stop_backend.sh" >/dev/null 2>&1
sleep 2
check "Stop FrameMind: launcher window reports a normal stop" grep -q "was stopped" "$WORK/launcher-d.log"
check "Stop FrameMind: no false crash report" sh -c '! grep -q "stopped unexpectedly" "$1"' _ "$WORK/launcher-d.log"
LAUNCHER_PID=""

# --------------------------------------------------------------------------------------------------------
printf '\n\033[1m%d passed, %d failed\033[0m\n' "$PASSED" "$FAILED"
[ "$FAILED" = 0 ]
