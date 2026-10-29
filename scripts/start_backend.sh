#!/bin/bash
# Makes sure exactly one FrameMind AI backend runs for this user, bound to 127.0.0.1 only.
#   - If the backend this launcher started earlier is still running (verified, not just by port), it is reused.
#   - Otherwise it starts one on the configured port (default 8000). If that port is taken by another
#     program — including a FrameMind backend this launcher did not start — the next free port is used.
#     Nothing that belongs to another program is ever stopped.
# On success the PID file (<data folder>/run/backend.pid) holds "<pid> <port>". The backend keeps running
# after this script exits (Start FrameMind.command watches it; Stop FrameMind.command stops it).
set -u
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
. "$APP_DIR/scripts/common.sh"

LOCK_HELD=0

release_lock() {
  [ "$LOCK_HELD" = 1 ] && rm -rf "$LOCK_DIR"
  LOCK_HELD=0
}

# Two launches at the same moment must not start two backends.
acquire_lock() {
  local tries=0 holder
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$LOCK_DIR"  # left behind by a launcher that was killed
      continue
    fi
    tries=$((tries + 1))
    if [ "$tries" -gt 60 ]; then
      error "Another FrameMind AI launcher has been starting the backend for over a minute." \
        "Wait for it to finish, or close its Terminal window and try again."
      return 1
    fi
    [ "$tries" = 1 ] && info "Another FrameMind AI launcher is starting the backend; waiting..."
    sleep 1
  done
  printf '%s\n' "$$" > "$LOCK_DIR/pid"
  LOCK_HELD=1
}

rotate_log() {
  [ -f "$BACKEND_LOG" ] || return 0
  local size
  size="$(wc -c < "$BACKEND_LOG" | tr -d ' ')"
  if [ "${size:-0}" -gt 5242880 ]; then
    mv -f "$BACKEND_LOG" "$BACKEND_LOG.1"
  fi
}

show_log_tail() {
  [ -f "$BACKEND_LOG" ] || return 0
  printf '\n  Last lines of %s:\n' "$BACKEND_LOG" >&2
  tail -n 25 "$BACKEND_LOG" | sed 's/^/    /' >&2
}

wait_for_health() {
  local pid="$1" port="$2" waited=0 body
  while [ "$waited" -lt "$HEALTH_TIMEOUT_SECONDS" ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      error "The FrameMind AI backend stopped while starting."
      show_log_tail
      if grep -q "address already in use" "$BACKEND_LOG" 2>/dev/null; then
        printf '  Port %s was taken at the same moment by another program. Run Start FrameMind.command again.\n' "$port" >&2
      fi
      return 1
    fi
    if body="$(framemind_health "$port")" && is_our_backend "$pid" "$port"; then
      HEALTH_BODY="$body"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  error "The backend did not answer its health check within $HEALTH_TIMEOUT_SECONDS seconds."
  show_log_tail
  return 1
}

report_health() {
  case "$HEALTH_BODY" in *'"database":true'*) ok "Database ready" ;; *) warn "The backend reports a database problem (see the log)." ;; esac
  case "$HEALTH_BODY" in *'"storage":true'*) ok "Storage ready" ;; *) warn "The backend reports a storage problem (see the log)." ;; esac
  case "$HEALTH_BODY" in *'"ffmpeg":true'*) ok "FFmpeg available to the backend" ;; *) warn "The backend cannot find FFmpeg: uploads and frame extraction will fail." ;; esac
}

choose_port() {
  local port="$PORT" last=$((PORT + PORT_FALLBACK_COUNT)) owner
  while [ "$port" -le "$last" ] && [ "$port" -le 65535 ]; do
    if ! port_in_use "$port"; then
      CHOSEN_PORT="$port"
      return 0
    fi
    owner="$(port_owner "$port")"
    if framemind_health "$port" >/dev/null; then
      warn "Port $port is used by a FrameMind AI backend this launcher did not start${owner:+ ($owner)}, e.g. a development server. Leaving it alone."
    else
      warn "Port $port is used by another program${owner:+ ($owner)}. Leaving it alone."
    fi
    port=$((port + 1))
  done
  error "No free port between $PORT and $last." \
    "Close some programs, or set another port: create $CONFIG_FILE with a line such as PORT=8765"
  return 1
}

start_new_backend() {
  local port="$1" codex pid
  codex="$(find_codex)" || codex="codex"
  rotate_log
  printf '\n===== %s  Start FrameMind.command: backend on 127.0.0.1:%s =====\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$port" >> "$BACKEND_LOG"
  chmod 600 "$BACKEND_LOG" 2>/dev/null || true
  # API-key variables are removed so Codex can only use the ChatGPT sign-in (the backend scrubs them too).
  # Bytecode is not written, so the app folder can stay read-only.
  # SIGHUP/SIGINT are ignored so closing the window or Control-C reach the launcher, which then stops the
  # backend gracefully with SIGTERM.
  (
    trap '' HUP INT
    cd "$DATA_DIR" || exit 1
    exec env -u OPENAI_API_KEY -u CODEX_API_KEY -u OPENAI_BASE_URL \
      STORAGE_DIR="$DATA_DIR" \
      ENVIRONMENT="portable" \
      STANDALONE_FRONTEND_ENABLED="true" \
      STANDALONE_LOG_PAIRING_CODE="false" \
      CODEX_ALLOW_API_KEY_AUTH="false" \
      CODEX_CLI_PATH="$codex" \
      PYTHONDONTWRITEBYTECODE="1" \
      PYTHONUNBUFFERED="1" \
      "$VENV_PY" -m uvicorn "$BACKEND_MODULE" --app-dir "$BACKEND_DIR" --host 127.0.0.1 --port "$port"
  ) < /dev/null >> "$BACKEND_LOG" 2>&1 &
  pid=$!
  printf '%s %s\n' "$pid" "$port" > "$PID_FILE"
  info "Starting the backend on http://127.0.0.1:$port (PID $pid)..."
  if ! wait_for_health "$pid" "$port"; then
    # It is our own process (just started): stop it if it is somehow still alive.
    kill -TERM "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    return 1
  fi
  ok "Backend is running and healthy: http://127.0.0.1:$port"
  report_health
}

main() {
  extend_path
  step "Starting the FrameMind AI backend"
  load_config || return 1
  ensure_data_dirs || { error "Could not create the data folder: $DATA_DIR"; return 1; }
  if [ ! -x "$VENV_PY" ]; then
    error "The Python environment is missing." "Run Start FrameMind.command (it runs scripts/setup.sh first)."
    return 1
  fi
  acquire_lock || return 1
  trap release_lock EXIT

  if read_pid_file; then
    if is_our_backend "$BACKEND_PID" "$BACKEND_PORT"; then
      info "A FrameMind AI backend started by this launcher is already running (PID $BACKEND_PID, port $BACKEND_PORT)."
      if wait_for_health "$BACKEND_PID" "$BACKEND_PORT"; then
        ok "Reusing it: http://127.0.0.1:$BACKEND_PORT"
        report_health
        return 0
      fi
      return 1
    fi
    rm -f "$PID_FILE"  # stale: that process is gone (or the PID now belongs to something else)
  fi

  choose_port || return 1
  [ "$CHOSEN_PORT" != "$PORT" ] && warn "Using port $CHOSEN_PORT instead of $PORT."
  start_new_backend "$CHOSEN_PORT" || return 1
}

main
