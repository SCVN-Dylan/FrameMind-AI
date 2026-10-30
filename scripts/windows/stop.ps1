# FrameMind AI for Windows: run by "Stop FrameMind.bat". Stops only the backend Start FrameMind.bat started.

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'common.ps1')

Step 'Stopping FrameMind AI'
Stop-OwnedBackend
