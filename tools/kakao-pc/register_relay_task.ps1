# Outbox relay - run every 5 minutes so stuck kakao messages get sent from PC
# (ASCII only: PowerShell 5.1 reads BOM-less UTF-8 as cp949 and breaks on Korean)
# Run:  powershell -ExecutionPolicy Bypass -File C:\firstoa\register_relay_task.ps1
$py = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
if (-not (Test-Path $py)) { Write-Host "python.exe not found: $py"; exit 1 }
$name = 'FIRSTOA Outbox Relay'
$act = New-ScheduledTaskAction -Execute $py -Argument 'C:\firstoa\outbox_relay.py' -WorkingDirectory 'C:\firstoa'
$trg = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -MultipleInstances IgnoreNew
$prn = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -Principal $prn -Force | Out-Null
Write-Host "Registered: $name (every 5 min)"
Write-Host ("Next run: " + (Get-ScheduledTaskInfo -TaskName $name).NextRunTime)
Write-Host "Remove:   Unregister-ScheduledTask -TaskName '$name' -Confirm:`$false"
