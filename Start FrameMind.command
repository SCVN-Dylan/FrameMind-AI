#!/bin/bash
# FrameMind AI — double-click to start.
#
# First launch: checks this Mac, offers to install what is missing (asks before each installation),
# creates a private Python environment, then starts the local backend and opens the app in the browser.
# Later launches reuse everything that is already set up.
#
# Keep this window open while using FrameMind AI. Control-C, closing the window, or
# "Stop FrameMind.command" stops the backend. Your data stays in ~/Library/Application Support/FrameMind AI.
set -u

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" || exit 1
SCRIPTS="$APP_DIR/scripts"

pause_before_close() {
  printf '\nPress Return to close this window. '
  read -r _ || true
}

if [ ! -f "$SCRIPTS/common.sh" ]; then
  printf '\nFrameMind AI cannot start: the "scripts" folder is missing next to this file.\n'
  printf 'Extract FrameMind-Portable.zip again and keep all files together.\n'
  pause_before_close
  exit 1
fi
. "$SCRIPTS/common.sh"

fail() {
  error "$@"
  printf '\n%sFrameMind AI did not start.%s Fix the problem above, then double-click Start FrameMind.command again.\n' "$C_BOLD" "$C_RESET" >&2
  [ -f "$BACKEND_LOG" ] && printf 'Backend log: %s\n' "$BACKEND_LOG" >&2
  pause_before_close
  exit 1
}

printf '%s\n' "${C_BOLD}FrameMind AI${C_RESET} ${C_DIM}— local launcher${C_RESET}"
printf '%s\n' "${C_DIM}App folder:  $APP_DIR${C_RESET}"
printf '%s\n' "${C_DIM}Data folder: $DATA_DIR${C_RESET}"
if [ -f "$VENV_STAMP" ]; then
  info "Welcome back. Reusing the existing setup."
else
  info "First launch on this Mac: setup can take a few minutes. You will be asked before anything is installed."
fi

# 1–4, 8–9: Mac, required tools, optional Codex CLI and its sign-in status.
/bin/bash "$SCRIPTS/check_dependencies.sh" --install
case $? in
  0) ;;
  1) fail "A required tool is missing (see above)." ;;
  *) fail "FrameMind AI cannot run here (see above)." ;;
esac

# 5–7: data folder and Python environment.
/bin/bash "$SCRIPTS/setup.sh" || fail "Setup did not finish (see above)."

# Was our backend already running before this launch?
extend_path
PREVIOUS_PID=""
if read_pid_file && is_our_backend "$BACKEND_PID" "$BACKEND_PORT"; then
  PREVIOUS_PID="$BACKEND_PID"
fi

# 10–11: backend (reused or started) and health check.
/bin/bash "$SCRIPTS/start_backend.sh" || fail "The backend could not be started (see above)."
read_pid_file || fail "The backend started but its PID file is missing: $PID_FILE"
PID="$BACKEND_PID"
PORT="$BACKEND_PORT"

# 12: open submission/index.html (file://), already paired with this backend.
step "Opening FrameMind AI"
open_frontend "$PORT" || fail "The browser could not be opened."
info "Pairing code (only needed if you open the page in another browser): $(tr -d '[:space:]' < "$PAIRING_FILE")"

if [ -n "$PREVIOUS_PID" ] && [ "$PREVIOUS_PID" = "$PID" ]; then
  printf '\n%sFrameMind AI was already running%s (started from another window). This window can be closed.\n' "$C_GREEN" "$C_RESET"
  exit 0
fi

STOPPING=0
stop_and_exit() {
  [ "$STOPPING" = 1 ] && return
  STOPPING=1
  printf '\n'
  stop_owned_backend
  exit 0
}
trap stop_and_exit INT TERM HUP

printf '\n%sFrameMind AI is running%s at http://127.0.0.1:%s\n' "$C_GREEN" "$C_RESET" "$PORT"
info "Keep this window open while you use the app."
info "To stop: press Control-C, close this window, or double-click Stop FrameMind.command."
info "Backend log: $BACKEND_LOG"

while kill -0 "$PID" 2>/dev/null; do
  sleep 1 &
  wait $! 2>/dev/null
done

trap - INT TERM HUP
if [ -f "$PID_FILE" ]; then
  rm -f "$PID_FILE"
  error "The FrameMind AI backend stopped unexpectedly."
  tail -n 25 "$BACKEND_LOG" 2>/dev/null | sed 's/^/    /' >&2
  fail "Double-click Start FrameMind.command to start it again."
fi
printf '\nThe FrameMind AI backend was stopped. This window can be closed.\n'
