#!/bin/bash
# Checks what FrameMind AI needs on this Mac. With --install, offers to install what is missing — each
# installation is explained first and runs only after the user answers "y". Nothing uses sudo.
#
#   scripts/check_dependencies.sh            report only
#   scripts/check_dependencies.sh --install  report and offer installations (used by Start FrameMind.command)
#
# Exit codes: 0 ready (Codex may still be missing: it is optional), 1 a required dependency is missing,
# 2 this Mac or this app folder cannot run FrameMind AI.
set -u
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
. "$APP_DIR/scripts/common.sh"

INSTALL=0
[ "${1:-}" = "--install" ] && INSTALL=1

BREW=""
MISSING_REQUIRED=0

check_macos() {
  if [ "$(uname -s)" != "Darwin" ]; then
    error "FrameMind AI's launcher only supports macOS."
    return 2
  fi
  local version major arch
  version="$(sw_vers -productVersion 2>/dev/null)"
  major="${version%%.*}"
  arch="$(uname -m)"
  case "$major" in ''|*[!0-9]*) major=0 ;; esac
  if [ "$major" -lt "$MIN_MACOS_MAJOR" ]; then
    error "macOS $version is not supported." "FrameMind AI needs macOS $MIN_MACOS_MAJOR (Monterey) or newer."
    return 2
  fi
  case "$arch" in
    arm64) ok "macOS $version on Apple Silicon (arm64)" ;;
    x86_64)
      if [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = "1" ]; then
        ok "macOS $version on Apple Silicon (Terminal is running under Rosetta)"
        warn "Tools will be looked up in both /opt/homebrew and /usr/local."
      else
        ok "macOS $version on Intel (x86_64)"
      fi
      ;;
    *) ok "macOS $version ($arch)" ;;
  esac
}

check_package_files() {
  local missing=0
  if [ ! -f "$INDEX_HTML" ]; then
    error "The FrameMind AI page is missing: submission/index.html" \
      "The app folder is incomplete. Extract FrameMind-Portable.zip again."
    missing=1
  fi
  if [ ! -f "$BACKEND_DIR/app/main.py" ] || [ ! -f "$REQUIREMENTS" ]; then
    error "The FrameMind AI backend is missing (backend/app/main.py or backend/requirements.txt)." \
      "The app folder is incomplete. Extract FrameMind-Portable.zip again."
    missing=1
  fi
  [ "$missing" = 0 ] && ok "App files found in: $APP_DIR"
  [ "$missing" = 0 ]
}

network_available() {
  curl -fsSI --max-time 8 "https://formulae.brew.sh" >/dev/null 2>&1
}

# Homebrew is only needed to install something that is missing.
ensure_homebrew() {
  BREW="$(find_brew)" && return 0
  [ "$INSTALL" = 1 ] || return 1
  info "Homebrew is needed to install it."
  info "Installing it downloads the official installer from https://github.com/Homebrew/install and runs it."
  info "The installer explains each step and asks for your macOS password itself (administrator account needed)."
  if ! ask_yes_no "Install Homebrew now?"; then
    warn "Homebrew was not installed."
    return 1
  fi
  if ! network_available; then
    error "No internet connection." "Connect to the internet and run Start FrameMind.command again."
    return 1
  fi
  local installer
  installer="$(mktemp -t framemind-homebrew-install)" || return 1
  if ! curl -fsSL --max-time 120 "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh" -o "$installer"; then
    rm -f "$installer"
    error "Could not download the Homebrew installer." "Check the internet connection and try again."
    return 1
  fi
  /bin/bash "$installer"
  local status=$?
  rm -f "$installer"
  if [ "$status" != 0 ]; then
    error "The Homebrew installer did not finish (exit code $status)." \
      "If it said you need an administrator account, ask an administrator to install Homebrew from https://brew.sh."
    return 1
  fi
  extend_path
  BREW="$(find_brew)" || { error "Homebrew was installed but brew could not be found."; return 1; }
  ok "Homebrew installed: $BREW"
}

# brew_install "<what it is>" <brew arguments...>
brew_install() {
  local label="$1"; shift
  ensure_homebrew || return 1
  info "It will be installed with Homebrew: brew install $*"
  if ! ask_yes_no "Install $label now?"; then
    warn "$label was not installed."
    return 1
  fi
  if ! network_available; then
    error "No internet connection." "Connect to the internet and run Start FrameMind.command again."
    return 1
  fi
  if ! "$BREW" install "$@"; then
    error "Homebrew could not install $label." \
      "Read the messages above. If it is a permissions problem, run 'brew doctor' in Terminal."
    return 1
  fi
  hash -r
  extend_path
}

check_python() {
  local python version
  if python="$(find_python)"; then
    version="$(python_version_of "$python")"
    ok "Python $version: $python"
    return 0
  fi
  warn "Python 3 (3.9–3.13) was not found. The FrameMind AI backend runs on Python."
  if [ "$INSTALL" = 1 ] && brew_install "Python 3.12" python@3.12; then
    if python="$(find_python)"; then
      ok "Python $(python_version_of "$python"): $python"
      return 0
    fi
    error "Python was installed but could not be found."
  fi
  error "Python 3.9–3.13 is required." \
    "Install it with Homebrew (brew install python@3.12) or from https://www.python.org/downloads/macos/," \
    "then run Start FrameMind.command again."
  return 1
}

check_ffmpeg() {
  if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
    local version
    version="$(ffmpeg -hide_banner -version 2>/dev/null | sed -n '1s/^ffmpeg version \([^ ]*\).*/\1/p')"
    ok "FFmpeg ${version:-?}: $(command -v ffmpeg)"
    return 0
  fi
  warn "FFmpeg was not found. FrameMind AI uses FFmpeg/FFprobe to read videos and extract frames."
  if [ "$INSTALL" = 1 ] && brew_install "FFmpeg" ffmpeg; then
    if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
      ok "FFmpeg: $(command -v ffmpeg)"
      return 0
    fi
    error "FFmpeg was installed but could not be found."
  fi
  error "FFmpeg is required." "Install it with Homebrew (brew install ffmpeg), then run Start FrameMind.command again."
  return 1
}

install_codex() {
  # Official methods from https://github.com/openai/codex: Homebrew cask (no Node.js needed) or npm.
  if BREW="$(find_brew)"; then
    brew_install "Codex CLI" --cask codex
    return
  fi
  if command -v npm >/dev/null 2>&1; then
    info "It will be installed with npm: npm install -g @openai/codex"
    ask_yes_no "Install Codex CLI now?" || { warn "Codex CLI was not installed."; return 1; }
    network_available || { error "No internet connection."; return 1; }
    if ! npm install -g @openai/codex; then
      error "npm could not install Codex CLI." \
        "If the error mentions permissions (EACCES), install Homebrew and use: brew install --cask codex"
      return 1
    fi
    hash -r; extend_path
    return 0
  fi
  brew_install "Codex CLI" --cask codex
}

# Codex is optional: without it FrameMind AI still opens, with AI analysis shown as disconnected.
check_codex() {
  local codex version status_text
  codex="$(find_codex)"
  if [ -z "$codex" ]; then
    warn "Codex CLI was not found. It runs FrameMind AI's analysis with your ChatGPT account."
    if [ "$INSTALL" = 1 ] && install_codex; then
      codex="$(find_codex)"
    fi
    if [ -z "$codex" ]; then
      warn "Continuing without Codex CLI: the app opens, AI analysis stays disconnected."
      info "Install later with: brew install --cask codex   (or: npm install -g @openai/codex)"
      return 0
    fi
  fi
  version="$("$codex" --version 2>/dev/null | head -n 1)"
  if [ -z "$version" ]; then
    warn "Codex CLI at $codex did not answer 'codex --version'. AI analysis may not work."
    return 0
  fi
  ok "$version: $codex"
  # Only the sign-in mode is shown; the raw output can contain a masked key and is not printed.
  status_text="$("$codex" login status 2>&1 | tr '[:upper:]' '[:lower:]')"
  case "$status_text" in
    *"not logged in"*) warn "Codex is not signed in. Use Settings → Login with ChatGPT in FrameMind AI." ;;
    *"logged in using chatgpt"*) ok "Codex is signed in with ChatGPT." ;;
    *"logged in"*"api key"*) warn "Codex is signed in with an API key. FrameMind AI will not use it (it bills the API account); sign in with ChatGPT in Settings." ;;
    *"logged in"*) warn "Codex is signed in with a method FrameMind AI does not use. Sign in with ChatGPT in Settings." ;;
    *) warn "Could not read the Codex sign-in status. Check it in FrameMind AI → Settings." ;;
  esac
}

main() {
  extend_path
  step "Checking this Mac"
  check_macos || return 2
  check_package_files || return 2

  step "Checking required tools"
  if BREW="$(find_brew)"; then
    ok "Homebrew: $BREW"
  else
    BREW=""
    info "Homebrew (https://brew.sh) is not installed. It is only needed if something below has to be installed."
  fi
  check_python || MISSING_REQUIRED=1
  check_ffmpeg || MISSING_REQUIRED=1
  if command -v node >/dev/null 2>&1; then
    info "Node.js: $(node --version 2>/dev/null) (not required to run FrameMind AI)"
  fi

  step "Checking Codex CLI (optional, for AI analysis)"
  check_codex

  [ "$MISSING_REQUIRED" = 0 ] || return 1
  return 0
}

main
