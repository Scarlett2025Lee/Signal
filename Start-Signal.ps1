param([switch]$SkipUpdate)
$ErrorActionPreference = 'Stop'
$projectPath = $PSScriptRoot
$transcriptStarted = $false
$serverProcess = $null
$exitCode = 0
$launchLock = $null
$restartForUpdate = $false
$pendingUpdate = $false
Write-Host 'Signal local website - starting...' -ForegroundColor Cyan
Write-Host "Folder: $projectPath"
try {
    if ([IO.Path]::GetPathRoot($projectPath) -ine 'D:\') {
        throw 'Extract the complete Signal folder onto D: first, for example D:\Signal.'
    }
    Set-Location $projectPath
    if (!(Test-Path 'package-lock.json') -or !(Test-Path 'server\index.mjs')) {
        throw 'Website files are missing. Extract the entire ZIP, not only the CMD file.'
    }
    $cachePath = Join-Path $projectPath '.cache'
    $tempPath = Join-Path $cachePath 'tmp'
    $toolsPath = Join-Path $projectPath '.tools'
    $logPath = Join-Path $cachePath 'logs'
    $pendingUpdate = Test-Path (Join-Path $cachePath 'updates\pending.json')
    New-Item -ItemType Directory -Force -Path $tempPath, $toolsPath, $logPath | Out-Null
    try { $launchLock = [IO.File]::Open((Join-Path $cachePath 'launch.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Signal is already starting or running. Use the existing browser window.' }
    $portCheck = New-Object Net.Sockets.TcpClient
    try {
        if ($portCheck.ConnectAsync('127.0.0.1', 1421).Wait(500) -and $portCheck.Connected) { throw 'Port 1421 is already active. Close the older website server before starting this version.' }
    } catch [System.AggregateException] { } finally { $portCheck.Dispose() }
    $env:TEMP = $tempPath
    $env:TMP = $tempPath
    $env:npm_config_cache = Join-Path $cachePath 'npm'
    $env:SIGNAL_DATA_DIR = Join-Path $projectPath 'data'
    $env:SIGNAL_PORT = '1421'
    Start-Transcript -Path (Join-Path $logPath 'startup.log') -Append | Out-Null
    $transcriptStarted = $true
    Write-Host "Startup log: $(Join-Path $logPath 'startup.log')"

    # Use a portable, checksum-verified Node download on the same drive.
    $nodeVersion = 'v24.19.0'
    $architecture = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $architecture = $env:PROCESSOR_ARCHITEW6432 }
    if ($architecture -ieq 'ARM64') { $nodeArchitecture = 'arm64' }
    elseif ($architecture -ieq 'AMD64') { $nodeArchitecture = 'x64' }
    else { throw "Unsupported Windows architecture: $architecture. A 64-bit Windows installation is required." }
    $archiveName = "node-$nodeVersion-win-$nodeArchitecture.zip"
    $nodePath = Join-Path $toolsPath "node-$nodeVersion-win-$nodeArchitecture"
    $nodeExe = Join-Path $nodePath 'node.exe'
    Write-Host '[1/5] Checking portable Node.js...'
    if (!(Test-Path $nodeExe)) {
        $archivePath = Join-Path $cachePath $archiveName
        $checksumsPath = Join-Path $cachePath 'SHASUMS256.txt'
        $downloadBase = "https://nodejs.org/dist/$nodeVersion"
        Write-Host 'Downloading Node.js to D:. First setup may take several minutes.'
        Invoke-WebRequest -UseBasicParsing "$downloadBase/SHASUMS256.txt" -OutFile $checksumsPath -TimeoutSec 120
        Invoke-WebRequest -UseBasicParsing "$downloadBase/$archiveName" -OutFile $archivePath -TimeoutSec 600
        $record = @(Get-Content $checksumsPath | Where-Object { $_ -match ('\s+' + [Regex]::Escape($archiveName) + '$') })
        if ($record.Count -ne 1) { throw 'Official Node checksum entry was not found.' }
        $expected = ($record[0] -split '\s+')[0]
        $actual = (Get-FileHash $archivePath -Algorithm SHA256).Hash
        if ($expected -ine $actual) { Remove-Item $archivePath; throw 'Node download failed SHA-256 verification.' }
        Write-Host 'Checksum verified. Extracting Node.js...'
        Expand-Archive -Path $archivePath -DestinationPath $toolsPath -Force
        Remove-Item $archivePath
    }
    $env:PATH = "$nodePath;$env:PATH"
    $npmCmd = Join-Path $nodePath 'npm.cmd'
    Write-Host '[2/5] Checking website dependencies...'
    $lockHash = (Get-FileHash 'package-lock.json' -Algorithm SHA256).Hash
    $stamp = Join-Path $cachePath 'installed-lock.txt'
    if (!(Test-Path 'node_modules') -or !(Test-Path $stamp) -or (Get-Content $stamp -Raw).Trim() -ne $lockHash) {
        & $npmCmd ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the error above and retry.' }
        Set-Content -Path $stamp -Value $lockHash
    }
    $pendingUpdate = Test-Path (Join-Path $cachePath 'updates\pending.json')
    if (!$SkipUpdate) {
        Write-Host 'Checking GitHub for automatic updates...'
        $updateSucceeded = $false
        try {
            $updateOutput = & $nodeExe --use-env-proxy 'scripts/update-cli.mjs' check 2> (Join-Path $logPath 'update-check.log')
            $updateSucceeded = $LASTEXITCODE -eq 0
        } catch { Write-Warning 'GitHub update check is unavailable; the installed website will still start.' }
        if ($updateSucceeded) {
            $update = ($updateOutput -join "`n") | ConvertFrom-Json
            if ($update.status -eq 'updated' -or $update.status -eq 'rolled-back') {
                Write-Host "Update result: $($update.status). Restarting the launcher..."
                $launchLock.Dispose(); $launchLock = $null
                Stop-Transcript | Out-Null; $transcriptStarted = $false
                & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -SkipUpdate
                exit $LASTEXITCODE
            }
            Write-Host "Update: $($update.status)"
        } else { Write-Warning 'Update check failed. Continuing with the installed version.' }
    }
    $pendingUpdate = Test-Path (Join-Path $cachePath 'updates\pending.json')
    Write-Host '[3/5] Building the website...'
    & $npmCmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Website build failed. Check the error above.' }

    Write-Host '[4/5] Starting the local website and SQLite...'
    $stdoutPath = Join-Path $logPath 'server.stdout.log'
    $stderrPath = Join-Path $logPath 'server.stderr.log'
    $env:SIGNAL_MANAGED_LAUNCHER = '1'
    $serverProcess = Start-Process -FilePath $nodeExe -ArgumentList '--use-env-proxy server/index.mjs' -WorkingDirectory $projectPath -NoNewWindow -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $null = $serverProcess.Handle
    $ready = $false
    $expectedVersion = (Get-Content 'package.json' -Raw | ConvertFrom-Json).version
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($serverProcess.HasExited) { throw 'Website server exited during startup. See the server error below.' }
        try {
            $health = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:1421/api/health' -TimeoutSec 1
            $result = $health.Content | ConvertFrom-Json
            if ($result.status -eq 'ok' -and $result.database -eq 'connected' -and $result.version -eq $expectedVersion) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    if (!$ready -or $serverProcess.HasExited) { throw 'Website did not become ready on port 1421. See the server error below.' }
    if ($pendingUpdate) {
        & $nodeExe --use-env-proxy 'scripts/update-cli.mjs' confirm
        if ($LASTEXITCODE -ne 0) { throw 'Could not confirm the new release; rolling back.' }
        $pendingUpdate = $false
    }
    Write-Host '[5/5] Website ready: http://127.0.0.1:1421' -ForegroundColor Green
    Write-Host "Your data: $env:SIGNAL_DATA_DIR"
    Write-Host 'Opening Google Chrome with its profile/cache on D:...'
    try { & (Join-Path $projectPath 'Open-Signal.ps1') }
    catch {
        Write-Warning $_.Exception.Message
        Write-Host 'The website is running. Open http://127.0.0.1:1421 manually if needed.'
    }
    Write-Host 'Keep this window open while using the website. Press Ctrl+C to stop.'
    while (!$serverProcess.HasExited) { Start-Sleep -Milliseconds 500 }
    $serverProcess.WaitForExit()
    $exitCode = $serverProcess.ExitCode
    if ($exitCode -eq 75) { $restartForUpdate = $true; $exitCode = 0 }
    elseif ($exitCode -ne 0) { throw "Website server stopped with exit code $exitCode." }
} catch {
    $exitCode = 1
    Write-Host ''
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    if ($logPath) {
        $serverErrors = Join-Path $logPath 'server.stderr.log'
        if (Test-Path $serverErrors) { Get-Content $serverErrors -Tail 20 }
        Write-Host "Logs are in: $logPath"
    }
    Write-Host 'Please share the error above or .cache\logs\startup.log.'
    if ($pendingUpdate -and (Test-Path $nodeExe)) {
        if ($serverProcess -and !$serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue; $serverProcess.WaitForExit() }
        Write-Host 'Restoring the previous program, dependencies and pre-update database...'
        & $nodeExe --use-env-proxy 'scripts/update-cli.mjs' rollback
        if ($LASTEXITCODE -eq 0) { $restartForUpdate = $true; $exitCode = 0 }
    }
} finally {
    if ($serverProcess -and !$serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue }
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
    if ($launchLock) { $launchLock.Dispose() }
}
if ($restartForUpdate) {
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectPath 'Start-Signal.ps1')
    exit $LASTEXITCODE
}
exit $exitCode
