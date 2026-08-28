# Weekly keyman poster - register Monday 08:00 auto run
# (ASCII only: PowerShell 5.1 reads a BOM-less UTF-8 file as cp949 and breaks on Korean)
# Run:  powershell -ExecutionPolicy Bypass -File C:\firstoa\register_task.ps1
$py = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
if (-not (Test-Path $py)) { Write-Host "python.exe not found: $py"; exit 1 }
$act = New-ScheduledTaskAction -Execute $py -Argument 'C:\firstoa\poster_send.py --weekly' -WorkingDirectory 'C:\firstoa'
$trg = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 8:00am
$set = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
$prn = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'FIRSTOA Weekly Keyman Poster' -Action $act -Trigger $trg -Settings $set -Principal $prn -Force | Out-Null
Get-ScheduledTask -TaskName 'FIRSTOA Weekly Keyman Poster' | Select-Object TaskName, State | Format-List
Write-Host ("Next run: " + (Get-ScheduledTaskInfo -TaskName 'FIRSTOA Weekly Keyman Poster').NextRunTime)
Write-Host "Test now  : Start-ScheduledTask -TaskName 'FIRSTOA Weekly Keyman Poster'"
Write-Host "Remove    : Unregister-ScheduledTask -TaskName 'FIRSTOA Weekly Keyman Poster' -Confirm:`$false"
