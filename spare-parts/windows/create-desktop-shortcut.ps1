# Creates "Start ARACO Spare Parts" and "Stop ARACO Spare Parts" shortcuts on the desktop.
# Run once:  powershell -ExecutionPolicy Bypass -File .\windows\create-desktop-shortcut.ps1
$here = $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function MakeShortcut($name, $script, $icon, $description) {
    $lnk = $shell.CreateShortcut((Join-Path $desktop "$name.lnk"))
    $lnk.TargetPath = $ps
    $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $here $script)`""
    $lnk.WorkingDirectory = Split-Path -Parent $here
    $lnk.IconLocation = "$(Join-Path $here $icon),0"
    $lnk.Description = $description
    $lnk.Save()
    Write-Host "Created: $name"
}

MakeShortcut 'Start ARACO Spare Parts' 'start-app.ps1' 'araco-start.ico' 'Start ARACO Spare Parts and open it in the browser'
MakeShortcut 'Stop ARACO Spare Parts' 'stop-app.ps1' 'araco-stop.ico' 'Stop ARACO Spare Parts (data is kept)'
Write-Host 'Done. Double-click "Start ARACO Spare Parts" on your desktop.' -ForegroundColor Green
