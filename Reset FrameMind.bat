@echo off
rem FrameMind AI for Windows - double-click to remove what FrameMind AI set up, so Start FrameMind.bat installs
rem it again. Asks first: either only the Python environment and Codex CLI (your data is kept), or everything.
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\reset.ps1"
echo.
pause
