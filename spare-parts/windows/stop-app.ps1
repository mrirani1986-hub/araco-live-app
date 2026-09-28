# Stops ARACO Spare Parts. All data is kept (the database and pictures stay in Docker volumes).
$appDir = Split-Path -Parent $PSScriptRoot
Set-Location $appDir
Write-Host 'Stopping ARACO Spare Parts (your data is kept)...'
docker compose stop
Write-Host 'Stopped.' -ForegroundColor Green
Start-Sleep -Seconds 3
