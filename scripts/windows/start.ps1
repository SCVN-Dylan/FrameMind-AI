# FrameMind AI for Windows: run by "Start FrameMind.bat".
#
# First launch: checks this PC, offers to install what is missing (asks before each installation, using
# winget and npm), creates a private Python environment, then starts the local backend and opens the app.
# Later launches reuse everything that is already set up.
#
# Keep the window open while using FrameMind AI. Control-C, closing the window, or "Stop FrameMind.bat"
# stops the backend. Your data stays in %LOCALAPPDATA%\FrameMind AI.

$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $PSScriptRoot 'common.ps1')

function Exit-WithError([string[]]$Lines) {
  Fail-Line $Lines
  Write-Host ''
  Write-Host 'FrameMind AI did not start. Fix the problem above, then double-click Start FrameMind.bat again.' -ForegroundColor White
  if (Test-Path -LiteralPath $BackendErrLog) { Write-Host "Backend log: $BackendErrLog" }
  exit 1
}

# --- Checks ------------------------------------------------------------------------------------------------
function Test-Windows {
  $os = [Environment]::OSVersion.Version
  if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or $os.Major -lt 10) {
    Exit-WithError @("Windows $os is not supported.", 'FrameMind AI needs Windows 10 or 11.')
  }
  Ok "Windows $($os.Major).$($os.Minor) build $($os.Build) ($env:PROCESSOR_ARCHITECTURE)"
}

function Test-PackageFiles {
  $missing = @()
  foreach ($file in @($IndexHtml, (Join-Path $BackendDir 'app\main.py'), $Requirements)) {
    if (-not (Test-Path -LiteralPath $file)) { $missing += $file }
  }
  if ($missing.Count) {
    Exit-WithError (@('The app folder is incomplete. Extract FrameMind-Portable.zip again. Missing:') + $missing)
  }
  Ok "App files found in: $AppDir"
}

function Get-RequiredPython {
  $python = Find-Python
  if (-not $python) {
    Warn 'Python 3.9-3.13 was not found. It runs the FrameMind AI backend.'
    Install-WithWinget 'Python 3.12' 'Python.Python.3.12' @('--scope', 'user') | Out-Null
    $python = Find-Python
  }
  if (-not $python) {
    Exit-WithError @('Python 3.9-3.13 is required.',
      'Install it with: winget install --id Python.Python.3.12 --exact --scope user',
      'or from https://www.python.org/downloads/windows/ , then start again.')
  }
  Ok "Python $($python.Major).$($python.Minor): $($python.Path)"
  return $python
}

function Test-FFmpeg {
  if (-not ((Find-Program 'ffmpeg') -and (Find-Program 'ffprobe'))) {
    Warn 'FFmpeg was not found. It reads videos and extracts frames.'
    Install-WithWinget 'FFmpeg' 'Gyan.FFmpeg' @() | Out-Null
  }
  $ffmpeg = Find-Program 'ffmpeg'
  if (-not ($ffmpeg -and (Find-Program 'ffprobe'))) {
    Exit-WithError @('FFmpeg is required.', 'Install it with: winget install --id Gyan.FFmpeg --exact',
      'If you just installed it, close this window and start FrameMind AI again.')
  }
  Ok "FFmpeg: $ffmpeg"
}

# $Question: "Install Codex CLI now?" or "Update Codex CLI now?"
function Install-CodexWithNpm([string]$Question) {
  $npm = Find-Program 'npm'
  if (-not $npm) {
    Warn 'Codex CLI is installed with npm, which comes with Node.js.'
    Install-WithWinget 'Node.js LTS' 'OpenJS.NodeJS.LTS' @() | Out-Null
    $npm = Find-Program 'npm'
    if (-not $npm) { Warn 'npm is still not available. If Node.js was just installed, start FrameMind AI again.'; return }
  }
  Info 'Command: npm install -g @openai/codex@latest'
  if (-not (Ask-YesNo $Question)) { Warn 'Codex CLI was not changed.'; return }
  & $npm install -g '@openai/codex@latest' | Out-Host
  if ($LASTEXITCODE -ne 0) { Warn 'npm could not install Codex CLI.' }
  Update-SessionPath
}

# Codex is optional: without it FrameMind AI still opens, with AI analysis shown as disconnected.
function Get-OptionalCodex {
  $codex = Find-Codex
  if (-not $codex) {
    Warn 'Codex CLI was not found. It runs FrameMind AI analysis with your ChatGPT account.'
    Install-CodexWithNpm 'Install Codex CLI now?'
    $codex = Find-Codex
    if (-not $codex) {
      Warn 'Continuing without Codex CLI: the app opens, AI analysis stays disconnected.'
      Info 'Install later with: npm install -g @openai/codex'
      return $null
    }
  }
  $version = Get-CodexVersion $codex
  if ($version -and $version -lt $MinCodexVersion) {
    Warn "Codex CLI $version is too old for FrameMind AI ($MinCodexVersion or newer is needed)."
    Install-CodexWithNpm 'Update Codex CLI now?'
    $codex = Find-Codex
    $version = Get-CodexVersion $codex
  }
  if (-not $version) {
    Warn "Codex CLI at $codex did not answer 'codex --version'. AI analysis may not work."
    return $codex
  }
  if ($version -lt $MinCodexVersion) {
    Warn "Codex CLI $version is still too old: AI analysis will not run until it is updated (npm install -g @openai/codex@latest)."
  } else {
    Ok "Codex CLI ${version}: $codex"
  }
  # Only the sign-in mode is shown; the raw output can contain a masked key and is not printed.
  $status = (& $codex login status 2>&1 | Out-String).ToLowerInvariant()
  if ($status -match 'not logged in') { Warn 'Codex is not signed in. Use Settings > AI Provider > Login with ChatGPT in FrameMind AI.' }
  elseif ($status -match 'logged in using chatgpt') { Ok 'Codex is signed in with ChatGPT.' }
  elseif ($status -match 'logged in' -and $status -match 'api key') { Warn 'Codex is signed in with an API key. FrameMind AI will not use it; sign in with ChatGPT in Settings.' }
  else { Warn 'Could not read the Codex sign-in status. Check it in FrameMind AI > Settings.' }
  return $codex
}

# --- Python environment ------------------------------------------------------------------------------------
function Initialize-Venv($Python) {
  $hash = (Get-FileHash -LiteralPath $Requirements -Algorithm SHA256).Hash
  $wanted = "python=$($Python.Major).$($Python.Minor) requirements=$hash"
  if ((Test-Path -LiteralPath $VenvPy) -and (Test-Path -LiteralPath $VenvStamp) -and
      ((Get-Content -LiteralPath $VenvStamp -TotalCount 1) -eq $wanted)) {
    & $VenvPy -c 'import fastapi, uvicorn, sqlalchemy, pydantic_settings' 2>$null
    if ($LASTEXITCODE -eq 0) { Ok "Python environment ready: $VenvDir"; return }
  }
  if (Test-Path -LiteralPath $VenvDir) {
    Info 'Rebuilding the Python environment (Python or the package list changed)...'
    Remove-Item -LiteralPath $VenvDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  Info "Creating the Python environment with $($Python.Path) ..."
  & $Python.Path -m venv $VenvDir
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $VenvPy)) {
    Exit-WithError @('Could not create the Python virtual environment in:', $VenvDir)
  }
  Info "Installing the backend's Python packages (first launch only; needs internet, about 1 minute)..."
  & $VenvPy -m pip install --disable-pip-version-check --no-input -q -r $Requirements
  if ($LASTEXITCODE -ne 0) {
    Exit-WithError @('Installing the Python packages failed.',
      'Usually there is no internet, or a proxy blocks pypi.org. Connect and start again.')
  }
  [System.IO.File]::WriteAllText($VenvStamp, $wanted)
  Ok "Python environment ready: $VenvDir"
}

# --- Backend -----------------------------------------------------------------------------------------------
function Select-Port([int]$Port) {
  for ($candidate = $Port; $candidate -le $Port + $PortFallbackCount; $candidate++) {
    if (Test-PortFree $candidate) {
      if ($candidate -ne $Port) { Warn "Port $Port is used by another program. Using port $candidate instead." }
      return $candidate
    }
  }
  Exit-WithError @("No free port between $Port and $($Port + $PortFallbackCount).",
    "Close some programs, or set another port: create $ConfigFile with a line such as PORT=8765")
}

function Wait-ForHealth($Process, [int]$Port) {
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($Process.HasExited) { return $false }
    if (Get-FrameMindHealth $Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Show-LogTail {
  foreach ($log in @($BackendErrLog, $BackendLog)) {
    if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 25 | ForEach-Object { Write-Host "    $_" } }
  }
}

function Start-Backend([int]$Port, [string]$Codex) {
  foreach ($log in @($BackendLog, $BackendErrLog)) {
    if (Test-Path -LiteralPath $log) { Move-Item -LiteralPath $log -Destination "$log.1" -Force -ErrorAction SilentlyContinue }
  }
  # API-key variables are removed so Codex can only use the ChatGPT sign-in (the backend scrubs them too).
  foreach ($name in @('OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL')) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  $env:STORAGE_DIR = $DataDir
  $env:ENVIRONMENT = 'portable'
  $env:STANDALONE_FRONTEND_ENABLED = 'true'
  $env:STANDALONE_LOG_PAIRING_CODE = 'false'
  $env:CODEX_ALLOW_API_KEY_AUTH = 'false'
  if ($Codex) { $env:CODEX_CLI_PATH = $Codex } else { $env:CODEX_CLI_PATH = 'codex' }
  $env:PYTHONDONTWRITEBYTECODE = '1'
  $env:PYTHONUNBUFFERED = '1'
  # Windows PowerShell joins arguments with spaces without quoting them, so paths are quoted here.
  $arguments = @('-m', 'uvicorn', 'app.main:app', '--app-dir', "`"$BackendDir`"", '--host', '127.0.0.1', '--port', "$Port")
  # Same console (-NoNewWindow): Control-C and closing the window reach the backend too.
  $process = Start-Process -FilePath $VenvPy -ArgumentList $arguments -WorkingDirectory $DataDir -NoNewWindow -PassThru `
    -RedirectStandardOutput $BackendLog -RedirectStandardError $BackendErrLog
  [System.IO.File]::WriteAllText($PidFile, "$($process.Id) $Port")
  Info "Starting the backend on http://127.0.0.1:$Port (PID $($process.Id))..."
  if (-not (Wait-ForHealth $process $Port)) {
    if (-not $process.HasExited) { Stop-ProcessTree $process.Id }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Show-LogTail
    Exit-WithError @('The backend did not answer its health check (see the lines above).')
  }
  Ok "Backend is running and healthy: http://127.0.0.1:$Port"
  $health = Get-FrameMindHealth $Port
  if ($health -and -not $health.ffmpeg) { Warn 'The backend cannot find FFmpeg: video upload will not work.' }
  return $process
}

# --- Main --------------------------------------------------------------------------------------------------
Write-Host 'FrameMind AI - local launcher for Windows' -ForegroundColor White
Write-Host "App folder:  $AppDir"
Write-Host "Data folder: $DataDir"
if (Test-Path -LiteralPath $VenvStamp) { Info 'Welcome back. Reusing the existing setup.' }
else { Info 'First launch on this PC: setup can take a few minutes. You will be asked before anything is installed.' }

Update-SessionPath

Step 'Checking this PC'
Test-Windows
Test-PackageFiles

Step 'Checking required tools'
$python = Get-RequiredPython
Test-FFmpeg

Step 'Checking Codex CLI (optional, for AI analysis)'
$codex = Get-OptionalCodex

Step 'Preparing local storage'
Initialize-DataDirs
Ok "Data folder: $DataDir"

Step 'Preparing the Python environment'
Initialize-Venv $python

Step 'Starting the FrameMind AI backend'
$port = Get-ConfiguredPort
if ($null -eq $port) { Exit-WithError @('Invalid launcher configuration (see above).') }

$recorded = Read-PidFile
if ($recorded -and (Test-OurBackend $recorded.Pid $recorded.Port)) {
  Ok "FrameMind AI is already running (PID $($recorded.Pid)): http://127.0.0.1:$($recorded.Port)"
  Step 'Opening FrameMind AI'
  if (-not (Open-Frontend $recorded.Port)) { exit 1 }
  Write-Host ''
  Write-Host 'FrameMind AI was already running (started from another window). This window can be closed.' -ForegroundColor Green
  exit 0
}
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue  # stale: that process is gone

$port = Select-Port $port
$backend = Start-Backend $port $codex

Step 'Opening FrameMind AI'
if (-not (Open-Frontend $port)) { Stop-OwnedBackend; exit 1 }
Info "Pairing code (only needed if you open the page in another browser): $(([string](Get-Content -LiteralPath $PairingFile -TotalCount 1)).Trim())"

Write-Host ''
Write-Host "FrameMind AI is running at http://127.0.0.1:$port" -ForegroundColor Green
Info 'Keep this window open while you use the app.'
Info 'To stop: press Control-C, close this window, or double-click Stop FrameMind.bat.'
Info "Backend log: $BackendErrLog"

$stoppedNormally = $false
$loopEnded = $false
try {
  while (-not $backend.HasExited) { Start-Sleep -Seconds 1 }
  $loopEnded = $true
  if (-not (Test-Path -LiteralPath $PidFile)) { $stoppedNormally = $true }  # Stop FrameMind.bat removed it first
} finally {
  if (-not $loopEnded) {
    # Control-C: the backend got the same Control-C and shuts down by itself. Make sure it is gone.
    Write-Host ''
    if (-not $backend.HasExited) { Start-Sleep -Seconds 3 }
    if (-not $backend.HasExited) { Stop-ProcessTree $backend.Id }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'The FrameMind AI backend was stopped.'
  }
}

if ($stoppedNormally) {
  Write-Host ''
  Write-Host 'The FrameMind AI backend was stopped. This window can be closed.'
  exit 0
}
Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
Show-LogTail
Exit-WithError @('The FrameMind AI backend stopped unexpectedly.')
