#!/bin/bash
# Stops the FrameMind AI backend started by Start FrameMind.command. Only that process is stopped: it is
# identified by the PID file and re-verified (command line and listening port) before any signal is sent.
set -u
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
. "$APP_DIR/scripts/common.sh"

step "Stopping FrameMind AI"
stop_owned_backend
