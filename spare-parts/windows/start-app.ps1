# Starts ARACO Spare Parts on this Windows PC and opens it in the browser.
# Used by the "Start ARACO Spare Parts" desktop shortcut (see create-desktop-shortcut.ps1).
$ErrorActionPreference = 'Continue'  # docker writes progress to stderr; exit codes are checked instead
$appDir = Split-Path -Parent $PSScriptRoot   # ...\spare-parts
Set-Location $appDir
$Host.UI.RawUI.WindowTitle = 'ARACO Spare Parts'

function Fail($msg) {
    Write-Host ''
    Write-Host $msg -ForegroundColor Red
    Write-Host ''
    Read-Host 'Press Enter to close'
    exit 1
}

if (-not (Test-Path (Join-Path $appDir '.env'))) {
    Fail "The settings file .env is missing in $appDir. Copy .env.example to .env and fill in DB_PASSWORD, JWT_SECRET and ADMIN_PASSWORD."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail 'Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and try again.'
}

# 1. Docker Desktop must be running
function EngineUp { docker info *> $null; return ($LASTEXITCODE -eq 0) }
if (-not (EngineUp)) {
    Write-Host 'Starting Docker Desktop...'
    $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dd) { Start-Process $dd }
    $deadline = (Get-Date).AddMinutes(4)
    while (-not (EngineUp)) {
        if ((Get-Date) -gt $deadline) { Fail 'Docker Desktop did not start. Open Docker Desktop, wait for "Engine running", then use the shortcut again.' }
        Start-Sleep -Seconds 3
    }
}

# 2. Start the app (the first time this builds it, which takes several minutes)
Write-Host 'Starting ARACO Spare Parts (the first time this takes 5-15 minutes)...'
docker compose up -d --build   # rebuilds only what changed (e.g. after git pull)
if ($LASTEXITCODE -ne 0) { Fail 'Could not start the app. Send a screenshot of this window to the developer.' }

# 3. Wait until it answers, then open the browser
$port = 4100
$line = Select-String -Path (Join-Path $appDir '.env') -Pattern '^\s*APP_PORT\s*=\s*(\d+)' | Select-Object -First 1
if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
$url = "http://localhost:$port"
Write-Host "Waiting for $url ..."
$deadline = (Get-Date).AddMinutes(10)
while ($true) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "$url/api/health" | Out-Null; break } catch { }
    if ((Get-Date) -gt $deadline) {
        docker compose logs app --tail 40
        Fail 'The app did not answer in time. Send a screenshot of this window to the developer.'
    }
    Start-Sleep -Seconds 3
}
Start-Process $url
Write-Host "ARACO Spare Parts is running at $url" -ForegroundColor Green
Start-Sleep -Seconds 4
