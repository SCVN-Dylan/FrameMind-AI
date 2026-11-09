# Shared settings and helpers for the FrameMind AI Windows launcher (Windows PowerShell 5.1 or newer).
# Dot-sourced by start.ps1 and stop.ps1 after they set $AppDir; never run directly.
#
# Keep this file ASCII only: Windows PowerShell 5.1 reads scripts without a BOM in the legacy code page.
# Rules kept everywhere: nothing is installed without a "y", nothing asks for administrator rights itself,
# and only the backend this launcher started (recorded in the PID file and re-verified) is ever stopped.

$ErrorActionPreference = 'Continue'  # native tools write to stderr; failures are checked explicitly

# --- Locations ---------------------------------------------------------------------------------------------
# User data lives outside the app folder, so the folder can be moved or replaced.
if ($env:FRAMEMIND_DATA_DIR) { $DataDir = $env:FRAMEMIND_DATA_DIR } else { $DataDir = Join-Path $env:LOCALAPPDATA 'FrameMind AI' }
$RuntimeDir = Join-Path $DataDir 'runtime'
$VenvDir = Join-Path $RuntimeDir 'venv'
$VenvPy = Join-Path $VenvDir 'Scripts\python.exe'
$VenvStamp = Join-Path $VenvDir '.framemind-requirements'
$LogDir = Join-Path $DataDir 'logs'
$BackendLog = Join-Path $LogDir 'backend.log'
$BackendErrLog = Join-Path $LogDir 'backend.err.log'
$RunDir = Join-Path $DataDir 'run'
$PidFile = Join-Path $RunDir 'backend.pid'
$OpenPage = Join-Path $RunDir 'open-framemind.html'
$ConfigFile = Join-Path $DataDir 'launcher.conf'
$PairingFile = Join-Path $DataDir 'standalone_pairing_code.txt'

$BackendDir = Join-Path $AppDir 'backend'
$Requirements = Join-Path $BackendDir 'requirements.txt'
$IndexHtml = Join-Path $AppDir 'index.html'

$AppName = 'FrameMind AI'
$DefaultPort = 8000
$PortFallbackCount = 20
if ($env:FRAMEMIND_HEALTH_TIMEOUT) { $HealthTimeoutSeconds = [int]$env:FRAMEMIND_HEALTH_TIMEOUT } else { $HealthTimeoutSeconds = 60 }
$PythonMinors = @(13, 12, 11, 10, 9)  # Python 3.9-3.13, newest first
$MinCodexVersion = [version]'0.165.0'  # keep in sync with MIN_VERSION in backend/app/services/ai/codex_cli.py

# FrameMind keeps its own copy of Codex CLI in runtime\codex\<version> and updates it to the latest release at
# each start (when online). Updating or removing any other Codex on this PC does not affect it. It shares the
# ChatGPT sign-in (~\.codex). runtime\codex\current names the version in use.
$CodexHomeDir = Join-Path $RuntimeDir 'codex'
$CodexCurrentFile = Join-Path $CodexHomeDir 'current'
$CodexRegistry = 'https://registry.npmjs.org'

# --- Output ------------------------------------------------------------------------------------------------
function Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor White }
function Info([string]$Text) { Write-Host "    $Text" }
function Ok([string]$Text) { Write-Host '    OK ' -ForegroundColor Green -NoNewline; Write-Host $Text }
function Warn([string]$Text) { Write-Host '    !  ' -ForegroundColor Yellow -NoNewline; Write-Host $Text }
function Fail-Line([string[]]$Lines) {
  Write-Host ''
  Write-Host "    ERROR: $($Lines[0])" -ForegroundColor Red
  foreach ($line in ($Lines | Select-Object -Skip 1)) { Write-Host "           $line" }
}

# Yes/No question. In a console window it is a Windows dialog with Yes / No buttons (kept on top of other
# windows). If no dialog can be shown, or input is redirected, it is asked in the console: type y.
function Ask-YesNo([string]$Question, [string]$Detail = '') {
  if ($env:FRAMEMIND_DIALOGS -ne '0' -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      $text = $Question
      if ($Detail) { $text += "`r`n`r`n" + $Detail }
      Write-Host ''
      Write-Host "    $Question (answer in the window that just opened)"
      $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
      try {
        $result = [System.Windows.Forms.MessageBox]::Show($owner, $text, 'FrameMind AI', 'YesNo', 'Question')
      } finally { $owner.Dispose() }
      if ($result -eq [System.Windows.Forms.DialogResult]::Yes) { Ok 'Yes'; return $true }
      Info 'Not now.'
      return $false
    } catch { }
  }
  $answer = Read-Host "    $Question [y/N]"
  return ($answer -match '^\s*(y|yes)\s*$')
}

# --- Tools on PATH -----------------------------------------------------------------------------------------
# Installers update the registry PATH, not this window's: re-read it (and the winget / npm folders) after one.
function Update-SessionPath {
  $parts = @($env:Path -split ';')
  $parts += @([Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';')
  $parts += @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';')
  $parts += (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links')
  if ($env:APPDATA) { $parts += (Join-Path $env:APPDATA 'npm') }
  $seen = @{}
  $kept = @()
  foreach ($part in $parts) {
    if (-not $part) { continue }
    $key = $part.TrimEnd('\').ToLowerInvariant()
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $kept += $part
  }
  $env:Path = $kept -join ';'
}

# Full path of a program on PATH (.exe / .cmd / .bat only), or $null.
function Find-Program([string]$Name) {
  foreach ($cmd in @(Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue)) {
    if ($cmd.Source -match '\.(exe|cmd|bat)$') { return $cmd.Source }
  }
  return $null
}

# "3 12 C:\...\python.exe" from a Python candidate, or $null. The Microsoft Store "python" alias prints nothing.
function Get-PythonInfo([string]$Exe, [string[]]$Prefix) {
  try {
    $out = & $Exe @Prefix -c 'import sys; print(sys.version_info[0], sys.version_info[1], sys.executable)' 2>$null
  } catch { return $null }
  if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
  $fields = ([string]($out | Select-Object -First 1)).Trim() -split ' ', 3
  if ($fields.Count -lt 3) { return $null }
  return [pscustomobject]@{ Major = [int]$fields[0]; Minor = [int]$fields[1]; Path = $fields[2] }
}

function Test-PythonVersionOk($Info) {
  return ($null -ne $Info -and $Info.Major -eq 3 -and $PythonMinors -contains $Info.Minor)
}

# A supported Python (3.9-3.13), preferring the newest; $null if none.
function Find-Python {
  $py = Find-Program 'py'
  if ($py) {
    foreach ($minor in $PythonMinors) {
      $found = Get-PythonInfo $py @("-3.$minor")
      if (Test-PythonVersionOk $found) { return $found }
    }
  }
  $candidates = @()
  foreach ($name in @('python', 'python3')) {
    foreach ($cmd in @(Get-Command $name -CommandType Application -ErrorAction SilentlyContinue)) {
      if ($cmd.Source -notmatch '\\WindowsApps\\') { $candidates += $cmd.Source }  # skip the Store alias
    }
  }
  foreach ($minor in $PythonMinors) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Programs\Python\Python3$minor\python.exe")
  }
  foreach ($candidate in $candidates) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    $found = Get-PythonInfo $candidate @()
    if (Test-PythonVersionOk $found) { return $found }
  }
  return $null
}

# The Codex CLI to run: FrameMind's own copy if it has been downloaded, else the one on PATH (npm installs
# codex.cmd, other installers codex.exe).
function Find-Codex {
  $version = Get-OwnCodexVersion
  if ($version) { return (Join-Path $CodexHomeDir "$version\bin\codex.exe") }
  foreach ($name in @('codex.exe', 'codex.cmd')) {
    $found = Find-Program $name
    if ($found) { return $found }
  }
  return $null
}

# The version of FrameMind's own Codex in use, or $null if none was downloaded.
function Get-OwnCodexVersion {
  if (-not (Test-Path -LiteralPath $CodexCurrentFile)) { return $null }
  $version = "$(Get-Content -LiteralPath $CodexCurrentFile -TotalCount 1)".Trim()
  if ($version -notmatch '^\d+\.\d+\.\d+$') { return $null }
  if (-not (Test-Path -LiteralPath (Join-Path $CodexHomeDir "$version\bin\codex.exe"))) { return $null }
  return $version
}

# The Codex package for this PC: npm platform and Rust target.
function Get-CodexPlatform {
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
    return [pscustomobject]@{ Platform = 'win32-arm64'; Target = 'aarch64-pc-windows-msvc' }
  }
  return [pscustomobject]@{ Platform = 'win32-x64'; Target = 'x86_64-pc-windows-msvc' }
}

function Get-CodexVersion([string]$Codex) {
  try { $out = & $Codex --version 2>$null } catch { return $null }
  if ("$out" -match '(\d+)\.(\d+)\.(\d+)') { return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" }
  return $null
}

# winget install, only after a "y". Returns $true on success.
function Install-WithWinget([string]$Name, [string]$Id, [string[]]$Extra) {
  if (-not (Find-Program 'winget')) {
    Fail-Line @("$Name is missing and winget (App Installer) is not available to install it.",
      'Install "App Installer" from the Microsoft Store, or install the tool yourself, then start again.')
    return $false
  }
  Info "It will be installed with: winget install --id $Id --exact $($Extra -join ' ')"
  Info "(This accepts the package's license through winget. Windows may ask for permission.)"
  if (-not (Ask-YesNo "Install $Name now?" "FrameMind AI needs it. It will be installed with: winget install --id $Id --exact")) { Warn "$Name was not installed."; return $false }
  & winget install --id $Id --exact --accept-package-agreements --accept-source-agreements @Extra | Out-Host
  $code = $LASTEXITCODE
  Update-SessionPath
  if ($code -ne 0) { Warn "winget finished with code $code." }
  return $true  # the caller checks again whether the tool is now usable
}

# --- Data folder and configuration -------------------------------------------------------------------------
function Initialize-DataDirs {
  foreach ($dir in @($DataDir, $RuntimeDir, $LogDir, $RunDir)) {
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  }
}

# PORT from $env:FRAMEMIND_PORT or launcher.conf (a line "PORT=8765"); $null if the value is invalid.
function Get-ConfiguredPort {
  $port = $env:FRAMEMIND_PORT
  if (-not $port -and (Test-Path -LiteralPath $ConfigFile)) {
    foreach ($line in Get-Content -LiteralPath $ConfigFile) {
      $line = $line.Trim()
      if (-not $line -or $line.StartsWith('#')) { continue }
      $key, $value = $line -split '=', 2
      if ($key.Trim() -eq 'PORT') { $port = "$value".Trim() } else { Warn "Ignoring unknown setting `"$($key.Trim())`" in $ConfigFile" }
    }
  }
  if (-not $port) { return $DefaultPort }
  $number = 0
  if (-not [int]::TryParse($port, [ref]$number) -or $number -lt 1024 -or $number -gt 65535) {
    Fail-Line @("Invalid configuration: PORT=`"$port`".", 'PORT must be a number from 1024 to 65535.',
      "Fix or delete: $ConfigFile (or the FRAMEMIND_PORT variable).")
    return $null
  }
  return $number
}

function Test-PortFree([int]$Port) {
  $listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback, $Port)
  try { $listener.Start(); return $true } catch { return $false } finally { try { $listener.Stop() } catch {} }
}

# --- Backend process ---------------------------------------------------------------------------------------
# The PID file holds "<pid> <port>" for the backend this launcher started.
function Read-PidFile {
  if (-not (Test-Path -LiteralPath $PidFile)) { return $null }
  $fields = ([string](Get-Content -LiteralPath $PidFile -TotalCount 1)).Trim() -split '\s+'
  $backendPid = 0; $port = 0
  if ($fields.Count -ne 2 -or -not [int]::TryParse($fields[0], [ref]$backendPid) -or -not [int]::TryParse($fields[1], [ref]$port)) {
    return $null
  }
  return [pscustomobject]@{ Pid = $backendPid; Port = $port }
}

# The /api/health answer if a FrameMind AI backend answers on <port>, else $null.
function Get-FrameMindHealth([int]$Port) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3 -ErrorAction Stop
    if ($health.app_name -eq $AppName) { return $health }
  } catch {}
  return $null
}

# True only if <pid> is alive, is this data folder's venv Python, and FrameMind answers on <port>.
# Never trust a PID alone: after a restart the number may belong to an unrelated process.
function Test-OurBackend([int]$BackendPid, [int]$Port) {
  $proc = Get-Process -Id $BackendPid -ErrorAction SilentlyContinue
  if (-not $proc) { return $false }
  $path = $null
  try { $path = $proc.Path } catch {}
  if (-not $path -or ($path -ne $VenvPy -and -not $path.StartsWith($VenvDir, [StringComparison]::OrdinalIgnoreCase))) { return $false }
  return ($null -ne (Get-FrameMindHealth $Port))
}

# Ends the process and its children (the venv python.exe starts the real interpreter as a child).
function Stop-ProcessTree([int]$ProcessId) {
  & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
}

# Stops the backend recorded in the PID file, only after verifying it is ours.
function Stop-OwnedBackend {
  $recorded = Read-PidFile
  if (-not $recorded) { Info 'No FrameMind AI backend was started by this launcher.'; return }
  if (-not (Test-OurBackend $recorded.Pid $recorded.Port)) {
    Info "The recorded backend (PID $($recorded.Pid)) is no longer running."
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    return
  }
  Info "Stopping the FrameMind AI backend (PID $($recorded.Pid), port $($recorded.Port))..."
  # Removed first: tells the launcher window watching this PID that the stop was requested, not a crash.
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
  Stop-ProcessTree $recorded.Pid
  Ok 'Backend stopped.'
}

# --- Opening the page --------------------------------------------------------------------------------------
# Browsers drop the #fragment when Windows hands them a file:// URL, so a tiny private helper page in the data
# folder saves the backend address and pairing code, then forwards to index.html#pairing=...&api=...
function Write-OpenPage([int]$Port) {
  $code = ''
  if (Test-Path -LiteralPath $PairingFile) { $code = ([string](Get-Content -LiteralPath $PairingFile -TotalCount 1)).Trim() }
  if ($code -notmatch '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$') {
    Fail-Line @("The backend did not create a valid pairing code in $PairingFile")
    return $false
  }
  $api = "http://127.0.0.1:$Port"
  $target = ([System.Uri]$IndexHtml).AbsoluteUri + '#pairing=' + [System.Uri]::EscapeDataString($code) + '&api=' + [System.Uri]::EscapeDataString($api)
  $js = { param($value) (ConvertTo-Json $value).Replace('<', '\u003c') }
  $html = @"
<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>Opening FrameMind AI...</title>
<script>
try { localStorage.setItem("framemind-standalone-api", $(& $js $api)); localStorage.setItem("framemind-standalone-pairing", $(& $js $code)); } catch (e) {}
location.replace($(& $js $target));
</script>
<p style="font-family:Segoe UI,sans-serif">Opening FrameMind AI... If it does not open, open <code>$([System.Net.WebUtility]::HtmlEncode($IndexHtml))</code>. This tab can be closed.</p>
"@
  [System.IO.File]::WriteAllText($OpenPage, $html, (New-Object System.Text.UTF8Encoding $false))
  return $true
}

# The browser that opens https:// links, so the page opens in a browser even if .html files open in an editor.
function Get-DefaultBrowser {
  try {
    $progId = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' -ErrorAction Stop).ProgId
    $command = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -ErrorAction Stop).'(default)'
    if ($command -match '^\s*"([^"]+)"' -or $command -match '^\s*(\S+)') {
      if (Test-Path -LiteralPath $Matches[1]) { return $Matches[1] }
    }
  } catch {}
  return $null
}

function Open-Frontend([int]$Port) {
  if (-not (Write-OpenPage $Port)) { return $false }
  if ($env:FRAMEMIND_OPEN_BROWSER -eq '0') { Info "Not opening a browser (FRAMEMIND_OPEN_BROWSER=0). Helper page: $OpenPage"; return $true }
  $browser = Get-DefaultBrowser
  if ($browser) {
    try {
      Start-Process -FilePath $browser -ArgumentList "`"$OpenPage`"" -ErrorAction Stop
      Ok "Opened FrameMind AI in $([System.IO.Path]::GetFileNameWithoutExtension($browser))."
      return $true
    } catch {}
  }
  try {
    Start-Process -FilePath $OpenPage -ErrorAction Stop
    Ok 'Opened FrameMind AI in the default app for web pages.'
    return $true
  } catch {
    Fail-Line @('Could not open the browser.', "Open this file in Edge, Chrome or Firefox: $IndexHtml")
    return $false
  }
}
