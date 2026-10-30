@echo off
rem FrameMind AI for Windows - double-click to start.
rem Runs scripts\windows\start.ps1 with Windows PowerShell (built into Windows 10 and 11).
rem Keep this window open while using FrameMind AI. Control-C, closing the window, or
rem "Stop FrameMind.bat" stops the backend. Your data stays in %LOCALAPPDATA%\FrameMind AI.
setlocal
title FrameMind AI
if not exist "%~dp0scripts\windows\start.ps1" (
  echo.
  echo FrameMind AI cannot start: the "scripts" folder is missing next to this file.
  echo Extract FrameMind-Portable.zip again and keep all files together.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start.ps1"
set "STATUS=%ERRORLEVEL%"
echo.
pause
exit /b %STATUS%
