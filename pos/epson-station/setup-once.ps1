# Persen Apparel Epson TM-T20IV one-time Windows installer.
# STAGING ONLY. Installs a pinned revision of the private local Epson agent.
# No database mutation, no old-job replay, no receipt claims during setup.
$ErrorActionPreference = 'Stop'
$Root = Join-Path $env:LOCALAPPDATA 'PersenApparel\EpsonStation'
$SourceCommit = '72e1db7a91a2fa4e70ba8ae2b54b853153b16327'
$RepoUrl = "https://raw.githubusercontent.com/persenapparel/Commandcenter/$SourceCommit/pos/epson-station"
$PublishableKey = 'sb_publishable_2dmFx3Vnsz7eU8dxAxCXPQ_8wNuCiLO'
Write-Host '=== Persen Apparel Epson printer setup (staging) ===' -ForegroundColor Cyan
Write-Host 'This uses Epson only. No settings for legacy printers will be installed.'
if (-not (Get-Command Get-Printer -ErrorAction SilentlyContinue)) {
 throw 'The Windows PrintManagement module is unavailable. Please use the Windows laptop with the Epson installed.'
}
$printers = @(Get-Printer | Where-Object { $_.Name -match '(?i)epson|TM[- ]?T20IV' })
if ($printers.Count -eq 0) {
 throw 'No Epson printer queue found. Connect the Epson by USB, power it on, then run this same setup command again.'
}
if ($printers.Count -eq 1) {
 $chosen = $printers[0]
} else {
 Write-Host 'More than one Epson printer was found:'
 for ($i=0; $i -lt $printers.Count; $i++) {
   Write-Host ("  {0}: {1}" -f ($i + 1), $printers[$i].Name)
 }
 $choice = Read-Host 'Enter the number for your TM-T20IV'
 $index = 0
 if (-not [int]::TryParse($choice, [ref]$index) -or $index -lt 1 -or $index -gt $printers.Count) {
   throw 'Printer selection cancelled; no settings were changed.'
 }
 $chosen = $printers[$index - 1]
}
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
 throw 'Node.js is not installed or is not on PATH. Install Node.js 22 LTS from its official site, then run this same setup command again.'
}
$versionText = (& node.exe --version).Trim()
$nodeMajor = [int]($versionText.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) {
 throw ("Node.js 22 or later is required; this laptop has " + $versionText + '.')
}
New-Item -Path $Root -ItemType Directory -Force | Out-Null
foreach($name in @('agent.cjs','send-raw.ps1')) {
  $url = "$RepoUrl/$name"
  $destination = Join-Path $Root $name
  Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing
  if ((Get-Item -LiteralPath $destination).Length -lt 100) {
    throw ("Download incomplete: " + $name)
  }
}
$env:PERSEN_WINDOWS_PRINTER = $chosen.Name
$env:PERSEN_POS_PUBLISHABLE_KEY = $PublishableKey
Write-Host ("Epson Windows queue: " + $chosen.Name) -ForegroundColor Green
Write-Host ("Node.js: " + $versionText)
$StartPath = Join-Path $Root 'Start-Persen-Epson.ps1'
$Launcher = @'
$ErrorActionPreference = 'Stop'
$env:PERSEN_WINDOWS_PRINTER = '__PRINTER__'
$env:PERSEN_POS_PUBLISHABLE_KEY = '__PUBLIC_KEY__'
$env:PERSEN_DRAWER_ARMED = 'YES'
$env:PERSEN_RECEIPTS_ARMED = 'YES'
# Prevent two Windows logon/desktop launches from processing the same queues.
$mutex = [System.Threading.Mutex]::new($false, 'Local\PersenPOSStagingEpsonStation')
$ownsMutex = $false
try {
  try { $ownsMutex = $mutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) {
    Write-Host 'Persen Epson station is already running on this Windows session. Do not start a second copy.' -ForegroundColor Yellow
  } else {
    Write-Host 'Persen Apparel Epson station - STAGING ONLY' -ForegroundColor Cyan
    Write-Host 'Leave this window open during sales. Sign in locally using your staging owner email and password.'
    Write-Host 'Both receipts and the previously working cash drawer will be armed after successful sign-in.'
    & node.exe (Join-Path $PSScriptRoot 'agent.cjs')
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Epson station stopped. See error above; do not restart repeatedly or retry uncertain jobs.' }
  }
} finally {
  if ($ownsMutex) { [void]$mutex.ReleaseMutex() }
  $mutex.Dispose()
}
'@
$Launcher = $Launcher.Replace('__PRINTER__', $chosen.Name.Replace("'","''")).Replace('__PUBLIC_KEY__',$PublishableKey)
# Quoting: use single quotes in launcher because Windows printer names may include double quotes.
Set-Content -LiteralPath $StartPath -Value $Launcher -Encoding UTF8
$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop 'Start Persen Epson.lnk'
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = (Join-Path $PSHOME 'powershell.exe')
$Shortcut.Arguments = ('-NoProfile -NoExit -ExecutionPolicy Bypass -File "' + $StartPath + '"')
$Shortcut.WorkingDirectory = $Root
$Shortcut.Description = 'Persen POS staging Epson automatic receipt and cash drawer agent'
$Shortcut.Save()
# Start an interactive sign-in window at each Windows login, with no stored password.
# Copying the same shortcut means the desktop and startup launch the same saved agent.
$StartupDir = [Environment]::GetFolderPath('Startup')
$StartupShortcut = Join-Path $StartupDir 'Start Persen Epson.lnk'
New-Item -Path $StartupDir -ItemType Directory -Force | Out-Null
Copy-Item -LiteralPath $ShortcutPath -Destination $StartupShortcut -Force
Write-Host ''
Write-Host 'SETUP SAVED. Your desktop now has: Start Persen Epson' -ForegroundColor Green
Write-Host 'The Epson station window will also open automatically when you sign into Windows.' -ForegroundColor Green
Write-Host 'Sign in with your staging owner email and password when that window appears, then leave it open during sales.'
Write-Host 'Your printer and public key settings are saved locally. Your owner password is NOT stored.'
Write-Host 'If Windows already opened the agent, do not manually open a second copy.'
Write-Host ''
Write-Host 'Before the first raw print test, verify the Epson driver is NOT configured to open the drawer on every print.' -ForegroundColor Yellow
$ok = Read-Host 'Type TEST to send one zero-dollar sample directly to the Epson, or press Enter to finish setup without printing'
if ($ok -ceq 'TEST') {
  & node.exe (Join-Path $Root 'agent.cjs') --printer-test
  if ($LASTEXITCODE -eq 0) {
   Write-Host 'RAW sample was submitted to Windows. Check whether paper printed and cut; Windows acceptance alone is not proof.' -ForegroundColor Green
  } else {
   Write-Warning 'RAW test failed. Send the displayed error (without any login/password) for diagnosis.'
  }
}
Write-Host 'You can use the desktop shortcut if the automatic Windows-startup window was closed. Never run two agents together.'
