#!/bin/bash
# Prepares FrameMind AI's private runtime on this Mac:
#   - the data folder (database, videos, frames, logs): ~/Library/Application Support/FrameMind AI
#   - a Python virtual environment in <data folder>/runtime/venv with backend/requirements.txt installed
# Safe to run every launch: an up-to-date environment is reused, existing data is never touched.
# The system Python is never modified (packages go into the virtual environment only).
set -u
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
. "$APP_DIR/scripts/common.sh"

# Identifies the installed package set: requirements.txt content + Python version.
requirements_fingerprint() {
  printf '%s\n%s\n' "$(shasum -a 256 "$REQUIREMENTS" | cut -d ' ' -f 1)" "$1"
}

venv_works() {
  [ -x "$VENV_PY" ] && "$VENV_PY" -c 'import fastapi, uvicorn, sqlalchemy, pydantic_settings' >/dev/null 2>&1
}

create_venv() {
  local python="$1"
  if [ -e "$VENV_DIR" ]; then
    # Only the virtual environment is replaced: it holds installed packages, no user data.
    info "Rebuilding the Python environment (Python changed or the environment is damaged)..."
    rm -rf "$VENV_DIR"
  fi
  info "Creating the Python environment with $python ..."
  if ! "$python" -m venv "$VENV_DIR"; then
    error "Could not create the Python virtual environment in:" "$VENV_DIR" \
      "Check that there is free disk space, then run Start FrameMind.command again."
    return 1
  fi
}

install_packages() {
  info "Installing the backend's Python packages (first launch only; needs internet, about 1 minute)..."
  if ! "$VENV_PY" -m pip install --disable-pip-version-check --no-input -q -r "$REQUIREMENTS"; then
    rm -f "$VENV_STAMP"
    error "Installing the Python packages failed." \
      "Usually this means there is no internet connection, or a proxy/firewall blocks https://pypi.org." \
      "Connect to the internet and run Start FrameMind.command again; finished downloads are reused."
    return 1
  fi
  if ! venv_works; then
    error "The Python packages were installed but the backend's modules cannot be imported." \
      "Delete the folder below and run Start FrameMind.command again:" "$VENV_DIR"
    return 1
  fi
}

main() {
  extend_path
  step "Preparing local storage"
  if ! ensure_data_dirs; then
    error "Could not create the data folder:" "$DATA_DIR" "Check the permissions of ~/Library/Application Support."
    return 1
  fi
  ok "Data folder: $DATA_DIR"
  if [ -f "$DATA_DIR/framemind.db" ]; then
    ok "Existing database and history kept."
  fi

  step "Preparing the Python environment"
  local python python_version wanted
  python="$(find_python)" || {
    error "Python 3.9–3.13 was not found." "Run Start FrameMind.command again and allow it to install Python."
    return 1
  }
  python_version="$(python_version_of "$python")"

  if [ -x "$VENV_PY" ]; then
    local venv_version
    venv_version="$(python_version_of "$VENV_PY")" || venv_version=""
    if [ -z "$venv_version" ] || ! python_version_ok "$venv_version"; then
      create_venv "$python" || return 1
    else
      python_version="$venv_version"  # keep using a working environment even if a newer Python appeared
    fi
  else
    create_venv "$python" || return 1
  fi

  wanted="$(requirements_fingerprint "$python_version")"
  if [ -f "$VENV_STAMP" ] && [ "$(cat "$VENV_STAMP")" = "$wanted" ] && venv_works; then
    ok "Python $python_version environment is up to date (reused)."
    return 0
  fi
  install_packages || return 1
  printf '%s\n' "$wanted" > "$VENV_STAMP"
  ok "Python $python_version environment ready: $VENV_DIR"
}

main
