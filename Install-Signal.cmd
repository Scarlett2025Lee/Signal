@echo off
echo Signal: install automatic updates on D:
echo Close any running Signal website server first.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p='D:\Signal\.cache\installer'; New-Item -ItemType Directory -Force -Path $p | Out-Null; $env:TEMP=$p; $env:TMP=$p; $f=Join-Path $p 'Install-Signal.ps1'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Scarlett2025Lee/AI-Fintech-funding-leads/codex/signal-web/downloads/Install-Signal.ps1' -OutFile $f -TimeoutSec 120; if ((Get-FileHash $f -Algorithm SHA256).Hash -ine '23a47356fb74050109cce759a604a6f908c7e4306392d557910c530ae222ce97') { throw 'Installer checksum mismatch. Download the latest Install-Signal.cmd.' }; & $f; if (!$?) { exit 1 }"
if errorlevel 1 pause
