@echo off
rem FrameMind AI for Windows - double-click to stop the backend started by Start FrameMind.bat.
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\stop.ps1"
echo.
pause
