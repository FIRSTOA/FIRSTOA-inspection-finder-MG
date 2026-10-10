# FIRSTOA Worker bootstrap - for a brand-new office laptop (nothing installed yet).
# (ASCII only: PowerShell 5.1 reads BOM-less UTF-8 as cp949 and breaks on Korean)
#
# One line, in a NORMAL PowerShell window (not admin), logged in as the user that will stay logged in 24h:
#
#   [Net.ServicePointManager]::SecurityProtocol='Tls12'; irm https://raw.githubusercontent.com/FIRSTOA/FIRSTOA-inspection-finder-MG/main/tools/worker/bootstrap.ps1 | iex
#
# What it does (safe to run again - re-running updates the code and restarts the worker):
#   1. winget -> Git + Python 3.12 (only if missing; skips the Microsoft Store "python" stub)
#   2. git clone (or pull) the repo to %USERPROFILE%\FIRSTOA-inspection-finder-MG
#   3. power settings: never sleep on AC, lid close = do nothing (best effort, may need admin)
#   4. tools\worker\install.ps1 -> pip packages, one smoke cycle, scheduled task 'FIRSTOA Worker' (at logon, auto-restart)
# After it finishes: install KakaoTalk PC, log in with the bot phone's account, double-click the rooms to open them as windows.

$ErrorActionPreference = 'Continue'
$repoUrl = 'https://github.com/FIRSTOA/FIRSTOA-inspection-finder-MG.git'
$dest = Join-Path $env:USERPROFILE 'FIRSTOA-inspection-finder-MG'

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Find-Python {
  foreach ($v in '313', '312', '311') {
    $p = Join-Path $env:LOCALAPPDATA "Programs\Python\Python$v\python.exe"
    if (Test-Path $p) { return $p }
  }
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { return $cmd.Source }   # skip the Store stub
  return $null
}
function Find-Git {
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("$env:ProgramFiles\Git\cmd\git.exe", "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe")) { if (Test-Path $p) { return $p } }
  return $null
}

Write-Host ''
Write-Host '== FIRSTOA Worker bootstrap ==' -ForegroundColor Cyan
Write-Host ("user   : " + $env:USERNAME + "   machine: " + $env:COMPUTERNAME)
Write-Host ("target : " + $dest)

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
  Write-Host 'winget not found. Open Microsoft Store, install "App Installer", then run this line again.' -ForegroundColor Yellow
  exit 1
}

# 1. Git
$git = Find-Git
if (-not $git) {
  Write-Host '[1/4] installing Git ...'
  winget install -e --id Git.Git --silent --accept-source-agreements --accept-package-agreements | Out-Null
  Refresh-Path
  $git = Find-Git
  if (-not $git) { Write-Host 'Git install failed. Install from https://git-scm.com and run again.' -ForegroundColor Red; exit 1 }
} else { Write-Host ("[1/4] Git ok: " + $git) }

# 1b. Python
$py = Find-Python
if (-not $py) {
  Write-Host '[1/4] installing Python 3.12 (user) ...'
  winget install -e --id Python.Python.3.12 --scope user --silent --accept-source-agreements --accept-package-agreements | Out-Null
  Refresh-Path
  $py = Find-Python
  if (-not $py) { Write-Host 'Python install failed. Install 3.12 from https://python.org (check "Add to PATH") and run again.' -ForegroundColor Red; exit 1 }
} else { Write-Host ("[1/4] Python ok: " + $py) }

# 2. repo
if (Test-Path (Join-Path $dest '.git')) {
  Write-Host '[2/4] updating repo (git pull --ff-only) ...'
  & $git -C $dest pull --ff-only
} else {
  Write-Host '[2/4] cloning repo ...'
  & $git clone --depth 1 $repoUrl $dest
  if (-not (Test-Path (Join-Path $dest '.git'))) { Write-Host 'clone failed - check internet / proxy and run again.' -ForegroundColor Red; exit 1 }
}

# 3. power (best effort)
Write-Host '[3/4] power settings: never sleep on AC, lid = do nothing ...'
try {
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  powercfg /change monitor-timeout-ac 15 | Out-Null
  powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 | Out-Null
  powercfg /setactive SCHEME_CURRENT | Out-Null
} catch { Write-Host '  (some power settings need an admin window - set "lid close = do nothing" by hand if the laptop sleeps)' -ForegroundColor Yellow }

# 4. worker
Write-Host '[4/4] installing the worker (pip packages, smoke test, scheduled task) ...'
$installer = Join-Path $dest 'tools\worker\install.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $installer
if ($LASTEXITCODE -ne 0) { Write-Host 'install.ps1 reported a problem - read the lines above.' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host 'DONE. Next, by hand:' -ForegroundColor Green
Write-Host '  - Install KakaoTalk PC (https://www.kakaocorp.com/page/service/service/KakaoTalk), log in with the bot phone account, tick auto-login.'
Write-Host '  - Double-click each room the worker must post into (closing room, regional rooms) so it stays open as its own window.'
Write-Host '  - Install Google Drive for desktop (https://www.google.com/drive/download/), sign in with the company Google account: daily backups then go to My Drive (FIRSTOA-backup folder). Until then they stay on this PC only.'
Write-Host '  - Windows: Settings > Accounts > Sign-in options > turn OFF "require sign-in"; netplwiz > untick "users must enter a password" for auto-login after a reboot.'
Write-Host '  - Check: FIELD app > Counter SMS > settings tab should say the worker is alive within a minute.'
Write-Host ("  - Logs: " + (Join-Path $dest 'tools\worker\logs'))
Write-Host '  - Update later: run this same one-line command again.'
