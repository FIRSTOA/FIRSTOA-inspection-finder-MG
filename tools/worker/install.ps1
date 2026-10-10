# FIRSTOA Worker - install on the office laptop (24h PC)
# (ASCII only: PowerShell 5.1 reads BOM-less UTF-8 as cp949 and breaks on Korean)
#
# Run (PowerShell, as the normal login user - NOT admin):
#   powershell -ExecutionPolicy Bypass -File <repo>\tools\worker\install.ps1
# Options:
#   -NoStart      register only, do not start now
#   -Uninstall    remove the scheduled task
param([switch]$NoStart, [switch]$Uninstall)

$name = 'FIRSTOA Worker'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here 'worker.py'

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed: $name"
  exit 0
}

# python: prefer the launcher, then PATH
$py = $null
foreach ($cand in @("$env:LOCALAPPDATA\Programs\Python\Python313\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe")) {
  if (Test-Path $cand) { $py = $cand; break }
}
if (-not $py) { $cmd = Get-Command python -ErrorAction SilentlyContinue; if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { $py = $cmd.Source } }  # skip the Store stub
if (-not $py) { Write-Host "python.exe not found. Install Python 3.11+ from python.org (check 'Add to PATH')."; exit 1 }
Write-Host "python: $py"

# packages for Kakao PC relay/poster (pure REST parts need nothing)
& $py -m pip install --quiet --disable-pip-version-check pywin32 pillow pyautogui 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "pip install warning - relay/poster may not work until pywin32/pillow/pyautogui are installed" }

# smoke test: one cycle
Write-Host "smoke test (one cycle)..."
& $py $script --once
if ($LASTEXITCODE -ne 0) { Write-Host "worker.py --once failed - fix before registering"; exit 1 }

# scheduled task: at logon, unlimited, auto-restart
$act = New-ScheduledTaskAction -Execute $py -Argument ('"' + $script + '"') -WorkingDirectory $here
$trg = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$prn = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -Principal $prn -Force | Out-Null
Write-Host "Registered: $name (at logon, restarts itself)"
if (-not $NoStart) {
  Start-ScheduledTask -TaskName $name
  Start-Sleep -Seconds 3
  Write-Host ("State: " + (Get-ScheduledTask -TaskName $name).State)
}
Write-Host "Logs : $here\logs\worker-YYYY-MM-DD.txt"
Write-Host "Stop : Stop-ScheduledTask -TaskName '$name'"
Write-Host "Start: Start-ScheduledTask -TaskName '$name'"
