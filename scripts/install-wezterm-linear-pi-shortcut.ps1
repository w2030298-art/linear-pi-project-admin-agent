param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$WezTermGui = 'C:\Program Files\WezTerm\wezterm-gui.exe'
)

$ErrorActionPreference = 'Stop'

$configPath = Join-Path $RepoRoot 'config\wezterm-linear-pi.lua'
$iconPath = Join-Path $RepoRoot 'assets\icons\linear-project-admin-pi.ico'

if (-not (Test-Path -LiteralPath $WezTermGui)) {
  throw "WezTerm GUI executable not found: $WezTermGui"
}
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "WezTerm Pi config not found: $configPath"
}

$arguments = @(
  '--config-file', "`"$configPath`"",
  'start',
  '--always-new-process',
  '--cwd', "`"$RepoRoot`"",
  'powershell.exe',
  '-NoLogo',
  '-NoExit',
  '-Command',
  '"pi"'
) -join ' '

$shortcutPaths = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Linear Project Admin Pi (WezTerm).lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm).lnk')
)

$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in $shortcutPaths) {
  $shortcutDir = Split-Path -Parent $shortcutPath
  if (-not (Test-Path -LiteralPath $shortcutDir)) {
    New-Item -ItemType Directory -Path $shortcutDir -Force | Out-Null
  }

  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $WezTermGui
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $RepoRoot
  if (Test-Path -LiteralPath $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
  }
  $shortcut.Save()
}

[pscustomobject]@{
  ok = $true
  target = $WezTermGui
  arguments = $arguments
  shortcuts = $shortcutPaths
} | ConvertTo-Json -Depth 3
