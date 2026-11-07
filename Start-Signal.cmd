@echo off
setlocal
cd /d "%~dp0"
title Signal - Start
echo Signal: start local website
echo Folder: %CD%
if not exist "%~dp0Start-Signal.ps1" (
  echo ERROR: Extract the entire ZIP first. Do not run this file inside the ZIP.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Signal.ps1"
set "SIGNAL_EXIT=%ERRORLEVEL%"
echo.
echo Signal finished with exit code %SIGNAL_EXIT%.
echo If the website did not open, share the error shown above.
pause
exit /b %SIGNAL_EXIT%
