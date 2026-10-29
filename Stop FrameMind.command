#!/bin/bash
# FrameMind AI — double-click to stop the backend started by Start FrameMind.command.
# Only that backend is stopped; other programs are never touched. Your data is kept.
set -u
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" || exit 1
/bin/bash "$APP_DIR/scripts/stop_backend.sh"
status=$?
printf '\nPress Return to close this window. '
read -r _ || true
exit "$status"
