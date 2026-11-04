#!/bin/bash
# FrameMind AI — double-click to remove what FrameMind AI set up, so Start FrameMind.command installs it again.
# Asks first: either only the Python environment and Codex CLI (your data is kept), or everything.
set -u
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)" || exit 1
/bin/bash "$APP_DIR/scripts/reset.sh"
status=$?
printf '\nPress Return to close this window. '
read -r _ || true
exit "$status"
