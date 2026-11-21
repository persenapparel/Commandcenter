# Persen Apparel Epson TM-T20IV one-time Windows installer.
# STAGING ONLY. Installs a pinned revision of the private local Epson agent.
# No database mutation, no old-job replay, no receipt claims during setup.
$ErrorActionPreference = 'Stop'
$Root = Join-Path $env:LOCALAPPDATA 'PersenApparel\EpsonStation'
$SourceCommit = '2dfb99ae9bef3c72a88573088d2e25dcb39abbba'
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
Write-Host 'Persen Apparel Epson station - STAGING ONLY' -ForegroundColor Cyan
Write-Host 'Leave this window open during sales. Sign in locally using your staging owner email and password.'
Write-Host 'Both receipts and the previously working cash drawer will be armed after successful sign-in.'
& node.exe (Join-Path $PSScriptRoot 'agent.cjs')
if ($LASTEXITCODE -ne 0) { Write-Warning 'Epson station stopped. See error above; do not restart repeatedly or retry uncertain jobs.' }
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
Write-Host ''
Write-Host 'SETUP SAVED. Your desktop now has: Start Persen Epson' -ForegroundColor Green
Write-Host 'Use that shortcut whenever you start the register. Your Windows printer and public key settings are saved locally.'
Write-Host 'Your staging owner password is NOT saved; you will enter it locally to start the agent.'
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
Write-Host 'When ready for staging checkout, open the desktop shortcut. Do not open it twice.'
