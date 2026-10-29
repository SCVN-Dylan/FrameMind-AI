#!/bin/bash
# Developer tool (not shipped): builds dist/FrameMind-Portable/ and dist/FrameMind-Portable.zip from this
# repository. Only runtime files are copied — no node_modules, virtual environments, git history, .env files,
# databases, videos, frames, pairing codes or Codex sign-in files — and the result is checked for them.
set -u
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DIST="${1:-$REPO/dist}"
NAME="FrameMind-Portable"
STAGE="$DIST/$NAME"
ZIP="$DIST/$NAME.zip"

die() { printf 'build_portable: %s\n' "$*" >&2; exit 1; }

[ -f "$REPO/submission/index.html" ] || die "submission/index.html is missing."
[ -f "$REPO/backend/requirements.txt" ] || die "backend/requirements.txt is missing."

rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE/submission" "$STAGE/backend" "$STAGE/scripts" || die "cannot create $STAGE"

cp "$REPO/Start FrameMind.command" "$REPO/Stop FrameMind.command" "$STAGE/"
cp "$REPO/submission/index.html" "$STAGE/submission/"
cp "$REPO/backend/requirements.txt" "$STAGE/backend/"
rsync -a --exclude '__pycache__/' --exclude '*.pyc' --exclude '.DS_Store' "$REPO/backend/app" "$STAGE/backend/"
for script in common.sh check_dependencies.sh setup.sh start_backend.sh stop_backend.sh; do
  cp "$REPO/scripts/$script" "$STAGE/scripts/"
done
cp "$REPO/docs/PORTABLE.md" "$STAGE/README.md"
chmod 755 "$STAGE/Start FrameMind.command" "$STAGE/Stop FrameMind.command" "$STAGE"/scripts/*.sh

# Nothing private may ship.
forbidden="$(find "$STAGE" \( -name '.env' -o -name '.env.*' -o -name '*.db' -o -name '*.sqlite*' -o -name 'auth.json' \
  -o -name 'standalone_pairing_code.txt' -o -name 'node_modules' -o -name '.venv' -o -name 'venv' -o -name '.git' \
  -o -name '__pycache__' -o -name '*.mp4' -o -name '*.mov' -o -name '*.webm' -o -name '*.mkv' -o -name '*.jpg' -o -name '*.png' \) -print)"
[ -z "$forbidden" ] || die "private or unnecessary files in the package:
$forbidden"
if grep -rIlE 'sk-[A-Za-z0-9_-]{20,}|"refresh_token"|"access_token"\s*:' "$STAGE" >/dev/null; then
  die "something that looks like a credential is in the package"
fi

# ditto keeps the executable bits; --norsrc keeps macOS metadata (._ files) out of the ZIP.
(cd "$DIST" && COPYFILE_DISABLE=1 ditto -c -k --norsrc --keepParent "$NAME" "$NAME.zip") || die "zip failed"
printf 'Built %s\n' "$ZIP"
