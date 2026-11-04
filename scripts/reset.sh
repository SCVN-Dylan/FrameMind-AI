#!/bin/bash
# Removes what FrameMind AI set up on this Mac, so the next Start FrameMind.command sets everything up again.
# Asks first. Only FrameMind AI's own data folder is touched: tools installed with Homebrew, any other Codex and
# the ChatGPT sign-in (~/.codex) are kept.
set -u
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
. "$APP_DIR/scripts/common.sh"

cancelled() { info "Nothing was removed."; exit 0; }

step "Reset FrameMind AI"
if [ ! -d "$DATA_DIR" ]; then
  ok "Nothing to remove: $DATA_DIR does not exist."
  exit 0
fi
# Guard against a mistyped FRAMEMIND_DATA_DIR: only a folder named "FrameMind AI" is ever deleted.
case "$DATA_DIR" in
  */"FrameMind AI") ;;
  *) error "Refusing to reset $DATA_DIR: the folder must be named \"FrameMind AI\"."; exit 1 ;;
esac

info "Folder: $DATA_DIR"
info ""
info "1) Reinstall: removes the Python environment and FrameMind AI's Codex CLI (runtime/)."
info "   Sessions, videos, feedback and settings are kept."
info "2) Remove everything: also deletes all sessions, videos, frames, feedback, settings and logs."
info "   This cannot be undone."
info ""
info "Homebrew tools, any other Codex and your ChatGPT sign-in are not touched."
printf '\n%s? Type 1 or 2 and press Return (just Return cancels):%s ' "$C_BOLD" "$C_RESET"
IFS= read -r choice || choice=""
case "$choice" in
  1) target="$RUNTIME_DIR"; what="the Python environment and Codex CLI" ;;
  2)
    printf '%s? Type DELETE to delete all FrameMind AI data:%s ' "$C_BOLD" "$C_RESET"
    IFS= read -r confirm || confirm=""
    [ "$confirm" = "DELETE" ] || cancelled
    target="$DATA_DIR"; what="all FrameMind AI data"
    ;;
  *) cancelled ;;
esac

step "Stopping FrameMind AI"
stop_owned_backend

step "Removing $what"
if rm -rf "$target" && [ ! -e "$target" ]; then
  ok "Removed: $target"
else
  error "Could not remove everything in $target." "Close FrameMind AI and its Terminal windows, then try again."
  exit 1
fi
info ""
info "Double-click Start FrameMind.command to set FrameMind AI up again."
