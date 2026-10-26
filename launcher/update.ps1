# Shiftyar launcher updater (Windows, no install, no admin).
# Called by shiftyar-launcher.cmd before starting the server.
# Behavior:
#  - Migrates a legacy app\data\shiftyar.db to data\shiftyar.db when the
#    outside copy does not exist yet. Data lives OUTSIDE app\ so updates
#    never touch it. A failed migration prints DBFAIL and the launcher
#    refuses to start (starting would use an empty database).
#    The WAL sidecars (-wal, -shm) move with the main file, and the
#    migration is skipped with DBFAIL while a server listens on port 3000.
#  - Reads the latest FULL release from GitHub (the /releases/latest
#    endpoint ignores drafts and prereleases).
#  - If the release is newer than app\version.txt, downloads the
#    shiftyar-app.zip asset, stops a running background server, swaps
#    app\ (previous version kept as app_old\), and makes sure
#    app\version.txt exists. Concurrent updater runs are serialized with
#    a lock file and each run uses its own per-process temp dir.
#  - Prints exactly one word: OK, UPDATED, NOASSET, DBFAIL, or OFFLINE.
#  - Any other failure prints OFFLINE and never blocks the server start.
#  - Secure connections on some networks fail intermittently (TLS
#    handshakes aborted mid-flight, succeeding after a few retries):
#    the release check and the download are each retried up to 6 times
#    with a 3-second pause, and OFFLINE is printed only when every
#    attempt fails.
param(
  [string]$AppDir,
  [string]$PidFile
)
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$repo = 'mcuteangel/shiftyar-node'

function Invoke-WithRetry {
  param([scriptblock]$Action, [int]$MaxAttempts = 6, [int]$DelaySeconds = 3)
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      return & $Action
    } catch {
      if ($attempt -ge $MaxAttempts) { throw }
      Start-Sleep -Seconds $DelaySeconds
    }
  }
}

try {
  $parent = Split-Path $AppDir -Parent
  $dataFile = Join-Path $parent 'data\shiftyar.db'
  $legacyDb = Join-Path $AppDir 'data\shiftyar.db'
  if ((Test-Path $legacyDb) -and -not (Test-Path $dataFile)) {
    $inUse = $false
    try {
      $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop
      if ($listener) { $inUse = $true }
    } catch { }
    if ($inUse) {
      Write-Output 'DBFAIL'
      exit 0
    }
    try {
      $dataDir = Split-Path $dataFile -Parent
      if (-not (Test-Path $dataDir)) { New-Item $dataDir -ItemType Directory | Out-Null }
      Move-Item $legacyDb $dataFile
      foreach ($suffix in @('-wal', '-shm')) {
        $sidecar = $legacyDb + $suffix
        if (Test-Path $sidecar) { Move-Item $sidecar ($dataFile + $suffix) }
      }
    } catch {
      Write-Output 'DBFAIL'
      exit 0
    }
  }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $rel = Invoke-WithRetry -Action { Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -TimeoutSec 20 -Headers @{ 'User-Agent' = 'shiftyar-launcher' } }
  # A full release may still carry an rc-style tag (v1.2.3-rc.1);
  # compare the numeric prefix only.
  $remoteTag = $rel.tag_name.TrimStart('v')
  $dash = $remoteTag.IndexOf('-')
  if ($dash -ge 0) { $remoteTag = $remoteTag.Substring(0, $dash) }
  $remote = [version]'0.0.0'
  if (-not [version]::TryParse($remoteTag, [ref]$remote)) {
    Write-Output 'OFFLINE'
    exit 0
  }
  $local = [version]'0.0.0'
  $verFile = Join-Path $AppDir 'version.txt'
  if (Test-Path $verFile) {
    $raw = (Get-Content $verFile -Raw).Trim().TrimStart('v')
    $parsed = [version]'0.0.0'
    if ([version]::TryParse($raw, [ref]$parsed)) { $local = $parsed }
  }
  if ($remote -le $local) { Write-Output 'OK'; exit 0 }
  $asset = $rel.assets | Where-Object { $_.name -eq 'shiftyar-app.zip' } | Select-Object -First 1
  if (-not $asset) { Write-Output 'NOASSET'; exit 0 }
  # Stop a running background server before touching app\.
  if (Test-Path $PidFile) {
    $rawPid = (Get-Content $PidFile -Raw).Trim()
    $procId = 0
    if ([int]::TryParse($rawPid, [ref]$procId)) {
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      $cmdline = $null
      if ($p) {
        try { $cmdline = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction Stop).CommandLine } catch { }
      }
      if ($p -and $p.ProcessName -eq 'node' -and $cmdline -and $cmdline.Contains('server\index.js')) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
      }
    }
  }
  # Serialize concurrent updater runs; the handle is released when this
  # process exits, so a stale lock cannot persist.
  $lockPath = Join-Path $env:TEMP 'shiftyar-update.lock'
  $lockStream = $null
  try {
    $lockStream = [System.IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
  } catch {
    Write-Output 'OFFLINE'
    exit 0
  }
  $tmp = Join-Path $env:TEMP ('shiftyar-update-' + $PID)
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item $tmp -ItemType Directory | Out-Null
  $zip = Join-Path $tmp 'app.zip'
  Invoke-WithRetry -Action {
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -TimeoutSec 300 -Headers @{ 'User-Agent' = 'shiftyar-launcher' }
  }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $newApp = Join-Path $tmp 'app'
  if (-not (Test-Path $newApp)) { throw 'package has no app folder' }
  $oldApp = Join-Path $parent 'app_old'
  if (Test-Path $oldApp) { Remove-Item $oldApp -Recurse -Force }
  $moved = $false
  try {
    if (Test-Path $AppDir) { Move-Item $AppDir $oldApp; $moved = $true }
    Move-Item $newApp $AppDir
  } catch {
    if ($moved -and -not (Test-Path $AppDir) -and (Test-Path $oldApp)) { Move-Item $oldApp $AppDir }
    throw
  }
  $newVerFile = Join-Path $AppDir 'version.txt'
  if (-not (Test-Path $newVerFile)) { $remote.ToString() | Out-File -FilePath $newVerFile -Encoding ascii }
  if ($lockStream) { $lockStream.Close() }
  Write-Output 'UPDATED'
} catch {
  Write-Output 'OFFLINE'
}
