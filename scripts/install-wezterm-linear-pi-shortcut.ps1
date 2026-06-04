param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'LinearProjectAdminPi'),
  [string]$RuntimeRoot = (Join-Path $env:USERPROFILE 'linear-pi-project-admin-agent-runtime'),
  [string]$StableBranch = 'master',
  [string]$WezTermGui = 'C:\Program Files\WezTerm\wezterm-gui.exe',
  [switch]$SkipRuntimeInit,
  [switch]$SelfTestAllowedRuntimeDirty
)

$ErrorActionPreference = 'Stop'

$RuntimeLocalExcludeEntries = @('nul', 'state/linear-apply-progress/')

function ConvertTo-PowerShellLiteral([string]$Value) {
  return "'" + ($Value -replace "'", "''") + "'"
}

function Invoke-GitValue([string[]]$Arguments) {
  $output = & git @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed: $output"
  }
  return (($output | Out-String).Trim())
}

function Test-AllowedRuntimeDirty([string]$StatusText) {
  $allowedPatterns = @(
    'state/portfolio-review/*.json',
    'state/fact-packs/*.json',
    'state/write-plans/*',
    'state/audit-reports/*',
    'state/linear-apply-progress/*',
    'state/*.jsonl',
    'state/repo-map.draft.yaml',
    'state/repo-map-audit.jsonl',
    '.pi/sessions/*'
  )
  $lines = @($StatusText -split "`r?`n" | Where-Object { $_.Trim() })
  if (-not $lines.Length) {
    return $true
  }
  foreach ($line in $lines) {
    if ($line.Length -lt 4) {
      return $false
    }
    $statusPath = $line.Substring(3).Trim()
    if ($statusPath -match ' -> ') {
      return $false
    }
    $normalized = $statusPath -replace '\\', '/'
    $allowed = $false
    foreach ($pattern in $allowedPatterns) {
      if ($normalized -like $pattern) {
        $allowed = $true
        break
      }
    }
    if (-not $allowed) {
      return $false
    }
  }
  return $true
}

function Update-RuntimeLocalExclude([string]$GitRoot) {
  $excludePath = Join-Path $GitRoot '.git\info\exclude'
  $excludeDir = Split-Path -Parent $excludePath
  if (-not (Test-Path -LiteralPath $excludeDir)) {
    return $false
  }

  $existing = @()
  if (Test-Path -LiteralPath $excludePath) {
    $existing = @(Get-Content -LiteralPath $excludePath)
  }
  $changed = $false
  foreach ($entry in $RuntimeLocalExcludeEntries) {
    if ($existing -contains $entry) {
      continue
    }
    $existing += $entry
    $changed = $true
  }
  if ($changed) {
    Set-Content -LiteralPath $excludePath -Value $existing -Encoding UTF8
  }
  return ($existing -contains 'nul')
}

$repoRootFull = (Resolve-Path -LiteralPath $RepoRoot).Path
$configPath = Join-Path $repoRootFull 'config\wezterm-linear-pi.lua'
$iconPath = Join-Path $repoRootFull 'assets\icons\linear-project-admin-pi.ico'
$launcherPath = Join-Path $InstallRoot 'launch-linear-pi-runtime.ps1'
$installedConfigPath = Join-Path $InstallRoot 'wezterm-linear-pi.lua'
$installedIconPath = Join-Path $InstallRoot 'linear-project-admin-pi.ico'
$remoteUrl = Invoke-GitValue @('-C', $repoRootFull, 'remote', 'get-url', 'origin')

if (-not (Test-Path -LiteralPath $WezTermGui)) {
  throw "WezTerm GUI executable not found: $WezTermGui"
}
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "WezTerm Pi config not found: $configPath"
}

if ($SelfTestAllowedRuntimeDirty) {
  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "linear-pi-runtime-exclude-$([System.Guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path (Join-Path $tempRoot '.git\info') -Force | Out-Null
  $nulLocalExcludeConfigured = Update-RuntimeLocalExclude $tempRoot
  Remove-Item -LiteralPath $tempRoot -Recurse -Force
  [pscustomobject]@{
    ok = $true
    ignoredRuntimeDirtyAllowed = (Test-AllowedRuntimeDirty " M state/portfolio-review/portfolio-snapshot-2026-05-28.json")
    linearApplyProgressDirtyAllowed = (Test-AllowedRuntimeDirty "?? state/linear-apply-progress/")
    nulLocalExcludeConfigured = $nulLocalExcludeConfigured
    codeDirtyAllowed = (Test-AllowedRuntimeDirty " M scripts/linear-cli.mjs")
  } | ConvertTo-Json -Depth 4
  exit 0
}

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
Copy-Item -LiteralPath $configPath -Destination $installedConfigPath -Force
if (Test-Path -LiteralPath $iconPath) {
  Copy-Item -LiteralPath $iconPath -Destination $installedIconPath -Force
}

$launcherTemplate = @'
param(
  [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'

$RemoteUrl = __REMOTE_URL__
$RuntimeRoot = __RUNTIME_ROOT__
$StableBranch = __STABLE_BRANCH__
$WezTermGui = __WEZTERM_GUI__
$ConfigPath = __CONFIG_PATH__
$InstallRoot = __INSTALL_ROOT__
$LogPath = Join-Path $InstallRoot 'launch.log'
$LocalRepoMapPath = Join-Path $InstallRoot 'repo-map.local.yaml'
$RuntimeLocalExcludeEntries = @('nul', 'state/linear-apply-progress/')
$GeneratedStateStashMessage = 'linear-pi-runtime-generated-state-before-launch'
$CodeDriftStashMessage = 'linear-pi-runtime-code-drift-before-launch'

function Write-LaunchLog([string]$Message) {
  $timestamp = Get-Date -Format o
  Add-Content -LiteralPath $LogPath -Value "[$timestamp] $Message"
}

function Join-ProcessArguments([string[]]$Arguments) {
  return ($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }) -join ' '
}

function Resolve-CommandFile([string]$Command) {
  if ([System.IO.Path]::IsPathRooted($Command) -or $Command -match '[\\/]') {
    return $Command
  }

  $extension = [System.IO.Path]::GetExtension($Command)
  $candidateNames = if ($extension) {
    @($Command)
  } else {
    @("$Command.exe", "$Command.cmd", "$Command.bat", $Command)
  }

  foreach ($candidateName in $candidateNames) {
    $resolved = Get-Command $candidateName -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($resolved) {
      return $resolved.Source
    }
  }

  throw "Command executable not found: $Command"
}

function Test-AllowedRuntimeDirty([string]$StatusText) {
  $allowedPatterns = @(
    'state/portfolio-review/*.json',
    'state/fact-packs/*.json',
    'state/write-plans/*',
    'state/audit-reports/*',
    'state/linear-apply-progress/*',
    'state/*.jsonl',
    'state/repo-map.draft.yaml',
    'state/repo-map-audit.jsonl',
    '.pi/sessions/*'
  )
  $lines = @($StatusText -split "`r?`n" | Where-Object { $_.Trim() })
  if (-not $lines.Length) {
    return $true
  }
  foreach ($line in $lines) {
    if ($line.Length -lt 4) {
      return $false
    }
    $statusPath = $line.Substring(3).Trim()
    if ($statusPath -match ' -> ') {
      return $false
    }
    $normalized = $statusPath -replace '\\', '/'
    $allowed = $false
    foreach ($pattern in $allowedPatterns) {
      if ($normalized -like $pattern) {
        $allowed = $true
        break
      }
    }
    if (-not $allowed) {
      return $false
    }
  }
  return $true
}

function Update-RuntimeLocalExclude([string]$GitRoot) {
  $excludePath = Join-Path $GitRoot '.git\info\exclude'
  $excludeDir = Split-Path -Parent $excludePath
  if (-not (Test-Path -LiteralPath $excludeDir)) {
    return $false
  }

  $existing = @()
  if (Test-Path -LiteralPath $excludePath) {
    $existing = @(Get-Content -LiteralPath $excludePath)
  }
  $changed = $false
  foreach ($entry in $RuntimeLocalExcludeEntries) {
    if ($existing -contains $entry) {
      continue
    }
    $existing += $entry
    $changed = $true
  }
  if ($changed) {
    Set-Content -LiteralPath $excludePath -Value $existing -Encoding UTF8
  }
  return ($existing -contains 'nul')
}

function Save-RuntimeDirtyState([string]$DirtyStatus) {
  if (Test-AllowedRuntimeDirty $DirtyStatus) {
    Write-LaunchLog "Runtime clone has allowed local state changes; stashing generated state before update."
    $message = $GeneratedStateStashMessage
  } else {
    Write-LaunchLog "Runtime clone has code/config changes; stashing them before update. Review with: git -C `"$RuntimeRoot`" stash list"
    $message = $CodeDriftStashMessage
  }
  $null = Invoke-CheckedCommand 'git' @('-C', $RuntimeRoot, 'stash', 'push', '--include-untracked', '-m', $message)
}

function Invoke-CheckedCommand([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory = '') {
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo.FileName = Resolve-CommandFile $Command
  $process.StartInfo.Arguments = Join-ProcessArguments $Arguments
  if ($WorkingDirectory) {
    $process.StartInfo.WorkingDirectory = $WorkingDirectory
  }
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true

  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  $output = @($stdout, $stderr) -join "`n"
  if ($output.Trim()) {
    Write-LaunchLog $output.Trim()
  }
  if ($process.ExitCode -ne 0) {
    throw "$Command $($Arguments -join ' ') failed with exit code $($process.ExitCode)"
  }
  return $output
}

function Ensure-RuntimeClone {
  $runtimeGit = Join-Path $RuntimeRoot '.git'
  if (-not (Test-Path -LiteralPath $runtimeGit)) {
    if ((Test-Path -LiteralPath $RuntimeRoot) -and (Get-ChildItem -LiteralPath $RuntimeRoot -Force | Select-Object -First 1)) {
      throw "Runtime root exists but is not an empty directory or managed runtime clone: $RuntimeRoot"
    }
    $runtimeParent = Split-Path -Parent $RuntimeRoot
    New-Item -ItemType Directory -Path $runtimeParent -Force | Out-Null
    # git clone keeps runtime execution separate from the development repo.
    $null = Invoke-CheckedCommand 'git' @('clone', '--branch', $StableBranch, '--single-branch', $RemoteUrl, $RuntimeRoot)
    $null = Update-RuntimeLocalExclude $RuntimeRoot
  } else {
    $null = Update-RuntimeLocalExclude $RuntimeRoot
    $dirty = Invoke-CheckedCommand 'git' @('-C', $RuntimeRoot, 'status', '--porcelain')
    if (($dirty | Out-String).Trim()) {
      Save-RuntimeDirtyState $dirty
    }
    $null = Invoke-CheckedCommand 'git' @('-C', $RuntimeRoot, 'fetch', 'origin', $StableBranch)
    $null = Invoke-CheckedCommand 'git' @('-C', $RuntimeRoot, 'switch', $StableBranch)
    # git pull --ff-only keeps runtime on the stable branch without creating merge commits.
    $null = Invoke-CheckedCommand 'git' @('-C', $RuntimeRoot, 'pull', '--ff-only', 'origin', $StableBranch)
  }
}

function Ensure-NodeDependencies {
  $packageJson = Join-Path $RuntimeRoot 'package.json'
  if (-not (Test-Path -LiteralPath $packageJson)) {
    return
  }

  $nodeModules = Join-Path $RuntimeRoot 'node_modules'
  $stamp = Join-Path $nodeModules '.linear-pi-runtime-deps.stamp'
  $needsInstall = -not (Test-Path -LiteralPath $nodeModules) -or -not (Test-Path -LiteralPath $stamp)
  foreach ($manifestName in @('package-lock.json', 'package.json')) {
    $manifest = Join-Path $RuntimeRoot $manifestName
    if ((Test-Path -LiteralPath $manifest) -and (Test-Path -LiteralPath $stamp)) {
      if ((Get-Item -LiteralPath $manifest).LastWriteTimeUtc -gt (Get-Item -LiteralPath $stamp).LastWriteTimeUtc) {
        $needsInstall = $true
      }
    }
  }

  if (-not $needsInstall) {
    return
  }

  if (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'package-lock.json')) {
    $null = Invoke-CheckedCommand 'npm' @('ci') $RuntimeRoot
  } else {
    $null = Invoke-CheckedCommand 'npm' @('install') $RuntimeRoot
  }
  New-Item -ItemType File -Path $stamp -Force | Out-Null
}

function Invoke-RuntimeValidation {
  if (-not (Test-Path -LiteralPath (Join-Path $RuntimeRoot 'package.json'))) {
    return
  }
  Write-LaunchLog 'Running runtime validation: npm run validate'
  $null = Invoke-CheckedCommand 'npm' @('run', 'validate') $RuntimeRoot
}

try {
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  Write-LaunchLog "Preparing Linear Project Admin Pi runtime on branch $StableBranch at $RuntimeRoot"
  Ensure-RuntimeClone
  Ensure-NodeDependencies
  Invoke-RuntimeValidation

  if ($PrepareOnly) {
    Write-LaunchLog 'PrepareOnly completed'
    exit 0
  }

  $env:LINEAR_PI_RUNTIME_ROOT = $RuntimeRoot
  $env:REPO_MAP_LOCAL_PATH = $LocalRepoMapPath
  $wezArgs = @(
    '--config-file', $ConfigPath,
    'start',
    '--always-new-process',
    '--cwd', $RuntimeRoot,
    'powershell.exe',
    '-NoLogo',
    '-NoExit',
    '-Command',
    'pi'
  )
  Write-LaunchLog "Starting WezTerm with runtime root $RuntimeRoot and local repo-map overlay $LocalRepoMapPath"
  Start-Process -FilePath $WezTermGui -ArgumentList (Join-ProcessArguments $wezArgs) -WorkingDirectory $RuntimeRoot
} catch {
  Write-LaunchLog "ERROR: $($_.Exception.Message)"
  throw
}
'@

$launcherContent = $launcherTemplate.
  Replace('__REMOTE_URL__', (ConvertTo-PowerShellLiteral $remoteUrl)).
  Replace('__RUNTIME_ROOT__', (ConvertTo-PowerShellLiteral $RuntimeRoot)).
  Replace('__STABLE_BRANCH__', (ConvertTo-PowerShellLiteral $StableBranch)).
  Replace('__WEZTERM_GUI__', (ConvertTo-PowerShellLiteral $WezTermGui)).
  Replace('__CONFIG_PATH__', (ConvertTo-PowerShellLiteral $installedConfigPath)).
  Replace('__INSTALL_ROOT__', (ConvertTo-PowerShellLiteral $InstallRoot))

Set-Content -LiteralPath $launcherPath -Value $launcherContent -Encoding UTF8

if (-not $SkipRuntimeInit) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcherPath -PrepareOnly
  if ($LASTEXITCODE -ne 0) {
    throw "Runtime initialization failed. See $(Join-Path $InstallRoot 'launch.log')"
  }
}

$shortcutPaths = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Linear Project Admin Pi (WezTerm).lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm).lnk')
)

$powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcutArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""

$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in $shortcutPaths) {
  $shortcutDir = Split-Path -Parent $shortcutPath
  if (-not (Test-Path -LiteralPath $shortcutDir)) {
    New-Item -ItemType Directory -Path $shortcutDir -Force | Out-Null
  }

  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $powerShellPath
  $shortcut.Arguments = $shortcutArguments
  $shortcut.WorkingDirectory = $InstallRoot
  if (Test-Path -LiteralPath $installedIconPath) {
    $shortcut.IconLocation = "$installedIconPath,0"
  } else {
    $shortcut.IconLocation = "$WezTermGui,0"
  }
  $shortcut.Save()
}

[pscustomobject]@{
  ok = $true
  installRoot = $InstallRoot
  runtimeRoot = $RuntimeRoot
  stableBranch = $StableBranch
  launcher = $launcherPath
  target = $powerShellPath
  arguments = $shortcutArguments
  shortcuts = $shortcutPaths
} | ConvertTo-Json -Depth 4
