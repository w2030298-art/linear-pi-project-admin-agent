# Local Runtime Launch Facts

This document records the launch path observed on this Windows machine on 2026-06-04. It is the local source of truth for the currently used Pi runtime shortcut.

## Active Shortcut

The shortcut the operator uses is the taskbar-pinned shortcut:

```text
%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm) (2).lnk
```

On this machine that expands to:

```text
C:\Users\admin\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm) (2).lnk
```

The sibling taskbar shortcut without the `(2)` suffix and the Start Menu shortcut point to the same launcher. Windows added the `(2)` suffix because there are duplicate pinned shortcut files; the suffix is not part of the launcher contract.

## Shortcut Properties

Observed properties of `Linear Project Admin Pi (WezTerm) (2).lnk`:

```text
TargetPath:
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe

Arguments:
-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\admin\AppData\Local\LinearProjectAdminPi\launch-linear-pi-runtime.ps1"

WorkingDirectory:
C:\Users\admin\AppData\Local\LinearProjectAdminPi

IconLocation:
C:\Users\admin\AppData\Local\LinearProjectAdminPi\linear-project-admin-pi.ico,0
```

Do not document direct `pi` execution from the development checkout as the normal Windows runtime startup path. Direct `pi` is only a development/debug fallback.

## Installed Runtime Files

The installed launcher directory is:

```text
%LOCALAPPDATA%\LinearProjectAdminPi
C:\Users\admin\AppData\Local\LinearProjectAdminPi
```

Observed files:

```text
launch-linear-pi-runtime.ps1
launch.log
linear-project-admin-pi.ico
wezterm-linear-pi.lua
write-confirmation-artifacts.json
```

The runtime launcher writes logs to:

```text
%LOCALAPPDATA%\LinearProjectAdminPi\launch.log
```

## Launcher Contract

The installed launcher currently uses:

```text
RemoteUrl: https://github.com/w2030298-art/linear-pi-project-admin-agent.git
RuntimeRoot: C:\Users\admin\linear-pi-project-admin-agent-runtime
StableBranch: master
WezTermGui: C:\Program Files\WezTerm\wezterm-gui.exe
ConfigPath: C:\Users\admin\AppData\Local\LinearProjectAdminPi\wezterm-linear-pi.lua
InstallRoot: C:\Users\admin\AppData\Local\LinearProjectAdminPi
LocalRepoMapPath: C:\Users\admin\AppData\Local\LinearProjectAdminPi\repo-map.local.yaml
```

The generic repo defaults should derive the runtime root from the current user:

```text
%USERPROFILE%\linear-pi-project-admin-agent-runtime
```

## Launch Chain

The shortcut starts PowerShell hidden and runs the installed launcher. The launcher then:

1. Ensures the runtime checkout exists at `%USERPROFILE%\linear-pi-project-admin-agent-runtime`.
2. Stashes generated runtime state if present.
3. Stashes accidental non-ignored code/config changes with `linear-pi-runtime-code-drift-before-launch` if present.
4. Runs `git fetch origin master`.
5. Switches the managed runtime checkout to `master`.
6. Runs `git pull --ff-only origin master`.
7. Installs npm dependencies only when needed.
8. Runs `npm run validate` in the runtime checkout.
9. Starts WezTerm:

```powershell
& "C:\Program Files\WezTerm\wezterm-gui.exe" --config-file "%LOCALAPPDATA%\LinearProjectAdminPi\wezterm-linear-pi.lua" start --always-new-process --cwd "%USERPROFILE%\linear-pi-project-admin-agent-runtime" powershell.exe -NoLogo -NoExit -Command "pi"
```

The launcher also exports:

```text
LINEAR_PI_RUNTIME_ROOT=%USERPROFILE%\linear-pi-project-admin-agent-runtime
REPO_MAP_LOCAL_PATH=%LOCALAPPDATA%\LinearProjectAdminPi\repo-map.local.yaml
```

After Pi is already open, use `/reload-master` to refresh the same runtime checkout from `origin/master`; use `/reload` only for already-present local Pi files.

## Previous Startup Blocker Seen Locally

The local `launch.log` showed the old launcher refusing to start because the runtime checkout had a code/config change:

```text
M scripts/linear-apply/normalize.mjs
ERROR: Runtime checkout has code/config changes; refusing to overwrite runtime state: C:\Users\admin\linear-pi-project-admin-agent-runtime
```

The runtime checkout diff showed only:

```diff
 const ISSUE_UPDATE_FIELDS = [
+  'id', 'issueId', 'issueRef',
   'title', 'description', 'descriptionData', ...
```

This is outside the development checkout and is not an allowed runtime-local state file. The updated launcher no longer blocks startup for this case. It saves the runtime drift with `git stash push --include-untracked -m linear-pi-runtime-code-drift-before-launch`, then continues the normal `master` sync. Recover or inspect preserved runtime edits with `git -C "$env:USERPROFILE\linear-pi-project-admin-agent-runtime" stash list`.

## Useful Inspection Commands

Read the active shortcut:

```powershell
$lnk = "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm) (2).lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath
$shortcut.Arguments
$shortcut.WorkingDirectory
```

Read launch failures:

```powershell
Get-Content "$env:LOCALAPPDATA\LinearProjectAdminPi\launch.log" -Tail 120
```

Check runtime checkout cleanliness:

```powershell
git -C "$env:USERPROFILE\linear-pi-project-admin-agent-runtime" status -sb
```

Inspect quarantined runtime drift:

```powershell
git -C "$env:USERPROFILE\linear-pi-project-admin-agent-runtime" stash list
```
