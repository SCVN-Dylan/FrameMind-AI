# FrameMind AI for Windows: run by "Reset FrameMind.bat". Removes what FrameMind AI set up on this PC, so the
# next Start FrameMind.bat sets everything up again. Asks first. Only FrameMind AI's own data folder is touched:
# tools installed with winget, any other Codex and the ChatGPT sign-in (~\.codex) are kept.

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'common.ps1')

Step 'Reset FrameMind AI'
if (-not (Test-Path -LiteralPath $DataDir)) { Ok "Nothing to remove: $DataDir does not exist."; exit 0 }
# Guard against a mistyped FRAMEMIND_DATA_DIR: only a folder named "FrameMind AI" is ever deleted.
if ((Split-Path -Leaf $DataDir) -ne 'FrameMind AI') {
  Fail-Line @("Refusing to reset ${DataDir}: the folder must be named ""FrameMind AI"".")
  exit 1
}

Info "Folder: $DataDir"
Info ''
Info "1) Reinstall: removes the Python environment and FrameMind AI's Codex CLI (runtime\)."
Info '   Sessions, videos, feedback and settings are kept.'
Info '2) Remove everything: also deletes all sessions, videos, frames, feedback, settings and logs.'
Info '   This cannot be undone.'
Info ''
Info 'winget tools, any other Codex and your ChatGPT sign-in are not touched.'
$choice = Read-Host '    Type 1 or 2 and press Enter (just Enter cancels)'
if ($choice -match '^\s*1\s*$') {
  $target = $RuntimeDir; $what = 'the Python environment and Codex CLI'
} elseif ($choice -match '^\s*2\s*$') {
  $confirm = Read-Host '    Type DELETE to delete all FrameMind AI data'
  if ($confirm -cne 'DELETE') { Info 'Nothing was removed.'; exit 0 }
  $target = $DataDir; $what = 'all FrameMind AI data'
} else {
  Info 'Nothing was removed.'; exit 0
}

Step 'Stopping FrameMind AI'
Stop-OwnedBackend

Step "Removing $what"
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $target) {
  Fail-Line @("Could not remove everything in $target.", 'Close FrameMind AI and its windows, then try again.')
  exit 1
}
Ok "Removed: $target"
Info ''
Info 'Double-click Start FrameMind.bat to set FrameMind AI up again.'
