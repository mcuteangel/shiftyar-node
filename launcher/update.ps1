# Shiftyar launcher updater (Windows, no install, no admin).
# Called by shiftyar-launcher.cmd before starting the server.
# Behavior:
#  - Migrates a legacy app\data\shiftyar.db to data\shiftyar.db when the
#    outside copy does not exist yet. Data lives OUTSIDE app\ so updates
#    never touch it. A failed migration prints DBFAIL and the launcher
#    refuses to start (starting would use an empty database).
#  - Reads the latest FULL release from GitHub (the /releases/latest
#    endpoint ignores drafts and prereleases).
#  - If the release is newer than app\version.txt, downloads the
#    shiftyar-app.zip asset, stops a running background server, swaps
#    app\ (previous version kept as app_old\), and makes sure
#    app\version.txt exists.
#  - Prints exactly one word: OK, UPDATED, NOASSET, DBFAIL, or OFFLINE.
#  - Any other failure prints OFFLINE and never blocks the server start.
param(
  [string]$AppDir,
  [string]$PidFile
)
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
$repo = 'mcuteangel/shiftyar-node'
try {
  $parent = Split-Path $AppDir -Parent
  $dataFile = Join-Path $parent 'data\shiftyar.db'
  $legacyDb = Join-Path $AppDir 'data\shiftyar.db'
  if ((Test-Path $legacyDb) -and -not (Test-Path $dataFile)) {
    try {
      $dataDir = Split-Path $dataFile -Parent
      if (-not (Test-Path $dataDir)) { New-Item $dataDir -ItemType Directory | Out-Null }
      Move-Item $legacyDb $dataFile
    } catch {
      Write-Output 'DBFAIL'
      exit 0
    }
  }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -TimeoutSec 20 -Headers @{ 'User-Agent' = 'shiftyar-launcher' }
  $remote = [version]($rel.tag_name.TrimStart('v'))
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
      if ($p -and $p.ProcessName -eq 'node') {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
      }
    }
  }
  $tmp = Join-Path $env:TEMP 'shiftyar-update'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item $tmp -ItemType Directory | Out-Null
  $zip = Join-Path $tmp 'app.zip'
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -TimeoutSec 300 -Headers @{ 'User-Agent' = 'shiftyar-launcher' }
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
  Write-Output 'UPDATED'
} catch {
  Write-Output 'OFFLINE'
}
