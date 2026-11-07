$ErrorActionPreference = 'Stop'
if ([IO.Path]::GetPathRoot($PSScriptRoot) -ine 'D:\') { throw 'Move this Signal folder to D: first.' }
$browserCache = Join-Path $PSScriptRoot '.cache\browser\chrome'
$tempPath = Join-Path $PSScriptRoot '.cache\tmp'
New-Item -ItemType Directory -Force -Path $browserCache, $tempPath | Out-Null
$env:TEMP = $tempPath
$env:TMP = $tempPath
try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:1421/api/health' -TimeoutSec 3 | Out-Null }
catch { throw 'Start-Signal.cmd must be running first. Wait for its local website address, then try again.' }
$chromePaths = @()
# Include registered custom install locations, not just the usual C: paths.
foreach ($registryPath in @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
)) {
    if (Test-Path -LiteralPath $registryPath) {
        $chromePaths += (Get-Item -LiteralPath $registryPath).GetValue('')
    }
}
$chromeCommand = Get-Command 'chrome.exe' -CommandType Application -ErrorAction SilentlyContinue
if ($chromeCommand) { $chromePaths += $chromeCommand.Source }
$chromePaths += @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromePaths | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (!$chrome) { throw 'Google Chrome was not found. Open Chrome and enter http://127.0.0.1:1421 manually. Its normal profile may use C:.' }
$profilePath = Join-Path $browserCache 'profile'
$diskCachePath = Join-Path $browserCache 'disk'
Start-Process -FilePath $chrome -ArgumentList @(
    "--user-data-dir=`"$profilePath`"",
    "--disk-cache-dir=`"$diskCachePath`"",
    '--no-first-run',
    'http://127.0.0.1:1421'
)
