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
  if ! ask_yes_no "Install Homebrew now?" \
      "Homebrew is needed to install the missing tools. Its official installer then continues in the Terminal window and asks for your macOS password (administrator account needed)."; then
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
  if ! ask_yes_no "Install $label now?" "FrameMind AI needs it. It will be installed with Homebrew: brew install $*"; then
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

# The latest Codex CLI release on the npm registry (empty when offline).
codex_latest_version() {
  curl -fsS --max-time 10 "$CODEX_REGISTRY/@openai/codex/latest" 2>/dev/null |
    grep -oE '"version":"[0-9]+\.[0-9]+\.[0-9]+"' | head -n 1 | cut -d '"' -f 4
}

# Downloads Codex CLI <version> (OpenAI's official npm package for this Mac, checked against the SHA-512 the
# registry publishes for it) into runtime/codex/<version> and makes it the one in use. Older copies are deleted
# only after the new one is ready, so a failed download keeps the current copy. Returns 0 on success.
install_own_codex() {
  local version="$1" platform target integrity work old
  read -r platform target <<EOF_PLATFORM
$(codex_platform)
EOF_PLATFORM
  integrity="$(curl -fsS --max-time 15 "$CODEX_REGISTRY/@openai/codex/$version-$platform" 2>/dev/null |
    grep -oE '"integrity":"sha512-[A-Za-z0-9+/=]+"' | head -n 1 | cut -d '"' -f 4)"
  if [ -z "$integrity" ]; then
    warn "Could not read the details of Codex CLI $version from the npm registry."
    return 1
  fi
  mkdir -p "$CODEX_HOME_DIR" || return 1
  work="$(mktemp -d "$CODEX_HOME_DIR/.download.XXXXXX")" || return 1
  if ! curl -fL --retry 2 --connect-timeout 15 -o "$work/codex.tgz" \
      "$CODEX_REGISTRY/@openai/codex/-/codex-$version-$platform.tgz"; then
    rm -rf "$work"
    warn "Codex CLI $version could not be downloaded. Check the internet connection."
    return 1
  fi
  if [ "sha512-$(openssl dgst -sha512 -binary "$work/codex.tgz" | base64 | tr -d '\n')" != "$integrity" ]; then
    rm -rf "$work"
    warn "The downloaded Codex CLI does not match the registry's checksum, so it was deleted."
    return 1
  fi
  if ! tar -xzf "$work/codex.tgz" -C "$work" "package/vendor/$target" ||
      ! "$work/package/vendor/$target/bin/codex" --version >/dev/null 2>&1; then
    rm -rf "$work"
    warn "The Codex CLI $version package could not be extracted or does not run."
    return 1
  fi
  rm -rf "$CODEX_HOME_DIR/$version"
  if ! mv "$work/package/vendor/$target" "$CODEX_HOME_DIR/$version"; then
    rm -rf "$work"
    return 1
  fi
  rm -rf "$work"
  printf '%s\n' "$version" > "$CODEX_CURRENT_FILE"
  for old in "$CODEX_HOME_DIR"/*/; do
    old="${old%/}"
    [ "$old" != "$CODEX_HOME_DIR/$version" ] && rm -rf "$old"
  done
  return 0
}

# First run: offers to download FrameMind's own Codex CLI. Later runs: updates it to the latest release
# (automatic, as agreed at the first download), or keeps the current copy when offline.
update_own_codex() {
  local current latest
  current="$(own_codex_version)" || current=""
  latest="$(codex_latest_version)"
  if [ -z "$latest" ]; then
    [ -n "$current" ] && info "Could not check for a newer Codex CLI (offline?). Using $current."
    [ -z "$current" ] && warn "Could not reach the npm registry to download Codex CLI (offline?)."
    return 0
  fi
  [ "$latest" = "$current" ] && return 0
  if [ -z "$current" ]; then
    info "FrameMind AI keeps its own copy of Codex CLI, the official OpenAI package (about 150 MB), in"
    info "$CODEX_HOME_DIR. It is updated to the latest release each time FrameMind AI starts,"
    info "and uses the same ChatGPT sign-in. Any other Codex on this Mac is not changed."
    ask_yes_no "Download Codex CLI $latest for FrameMind AI now?" \
      "Codex CLI runs the AI analysis with your ChatGPT account. FrameMind AI keeps its own copy (the official OpenAI package, about 150 MB) and updates it each time it starts. Any other Codex on this Mac is not changed." || { warn "Codex CLI was not downloaded."; return 0; }
  else
    info "Updating FrameMind AI's Codex CLI: $current → $latest"
  fi
  if install_own_codex "$latest"; then
    ok "Codex CLI $latest downloaded."
  elif [ -n "$current" ]; then
    info "Keeping Codex CLI $current."
  fi
}

# Codex is optional: without it FrameMind AI still opens, with AI analysis shown as disconnected.
check_codex() {
  local codex version status_text
  [ "$INSTALL" = 1 ] && update_own_codex
  codex="$(find_codex)"
  if [ -z "$codex" ]; then
    warn "Codex CLI was not found. It runs FrameMind AI's analysis with your ChatGPT account."
    warn "Continuing without Codex CLI: the app opens, AI analysis stays disconnected."
    info "Start FrameMind AI again and answer y to download it."
    return 0
  fi
  version="$("$codex" --version 2>/dev/null | head -n 1)"
  if [ -z "$version" ]; then
    warn "Codex CLI at $codex did not answer 'codex --version'. AI analysis may not work."
    return 0
  fi
  if [ "${codex#"$CODEX_HOME_DIR"/}" != "$codex" ]; then
    ok "$version (FrameMind AI's own copy)"
  else
    ok "$version: $codex"
    info "This is the Codex installed on this Mac. Start FrameMind AI again and answer y to use its own copy,"
    info "which FrameMind AI keeps up to date."
  fi
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
