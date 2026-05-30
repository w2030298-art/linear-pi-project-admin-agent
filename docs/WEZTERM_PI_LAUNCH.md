# WezTerm Pi Stable Runtime Launcher

## Goal

`Linear Project Admin Pi (WezTerm)` must not start directly inside the development repo `C:\Users\22003\linear-pi-project-admin-agent`. That repo is allowed to sit on feature branches while work is in progress.

The shortcut starts an external launcher instead:

```text
%LOCALAPPDATA%\LinearProjectAdminPi\launch-linear-pi-runtime.ps1
```

The launcher maintains a separate runtime checkout:

```text
C:\Users\22003\linear-pi-project-admin-agent-runtime
```

The runtime checkout tracks the stable branch `master`. On each launch it runs a fast-forward-only sync (`git pull --ff-only origin master`). Feature branch changes do not automatically sync to `master`; they only reach runtime after a PR/merge updates `master`.

## Install Or Repair

Run from a checked-out source repo:

```powershell
& "C:\Users\22003\linear-pi-project-admin-agent\scripts\install-wezterm-linear-pi-shortcut.ps1"
```

The installer writes these user-level runtime files:

```text
%LOCALAPPDATA%\LinearProjectAdminPi\launch-linear-pi-runtime.ps1
%LOCALAPPDATA%\LinearProjectAdminPi\wezterm-linear-pi.lua
%LOCALAPPDATA%\LinearProjectAdminPi\linear-project-admin-pi.ico
%LOCALAPPDATA%\LinearProjectAdminPi\launch.log
```

The installer creates or repairs both shortcuts:

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Linear Project Admin Pi (WezTerm).lnk
%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm).lnk
```

Shortcut target:

```text
powershell.exe
```

Shortcut arguments:

```text
-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LOCALAPPDATA%\LinearProjectAdminPi\launch-linear-pi-runtime.ps1"
```

## Launch Chain

The shortcut runs the external launcher. The launcher:

1. Ensures `C:\Users\22003\linear-pi-project-admin-agent-runtime` exists as a clone of the GitHub repo.
2. Checks the runtime checkout is clean.
3. Checks out `master`.
4. Runs `git pull --ff-only origin master`.
5. Runs `npm ci` only when dependencies are missing or package manifests changed.
6. Starts WezTerm:

```powershell
& "C:\Program Files\WezTerm\wezterm-gui.exe" --config-file "%LOCALAPPDATA%\LinearProjectAdminPi\wezterm-linear-pi.lua" start --always-new-process --cwd "C:\Users\22003\linear-pi-project-admin-agent-runtime" powershell.exe -NoLogo -NoExit -Command "pi"
```

## WezTerm Config

The installed `wezterm-linear-pi.lua` loads the user's normal WezTerm config first, then appends Windows shortcut bindings for copy, paste, command palette, search, tab open, and tab close.

It reads `LINEAR_PI_RUNTIME_ROOT` and uses it as `default_cwd`; if the variable is missing, it falls back to:

```text
C:\Users\22003\linear-pi-project-admin-agent-runtime
```

This keeps WezTerm shortcut behavior deterministic without changing the global `%USERPROFILE%\.wezterm.lua`.

## Official WezTerm Basics

Install:

```powershell
winget install wez.wezterm
```

GUI executable:

```text
C:\Program Files\WezTerm\wezterm-gui.exe
```

WezTerm supports `default_cwd`, but this launcher passes the runtime root with `start --cwd`, so the shortcut controls the actual Pi working directory.

## Development Repo Boundary

The development repo can stay on any feature branch:

```text
C:\Users\22003\linear-pi-project-admin-agent
```

The runtime launcher does not run Pi in that development repo. It does not merge feature branches. It does not automatically sync feature branch changes into `master`.

To make a feature available in the runtime launcher:

1. Merge the feature branch PR into `master`.
2. Start `Linear Project Admin Pi (WezTerm)` again.
3. The launcher fast-forwards the runtime checkout to the new `master`.

## Smoke Checks

Automated checks cover:

- The launcher script name and runtime root are documented.
- The shortcut uses `powershell.exe` to run `launch-linear-pi-runtime.ps1`.
- The runtime branch is `master` and uses `git pull --ff-only`.
- The WezTerm config includes copy and paste shortcut bindings.
- No token, secret, API key, or credential value is stored in shortcut docs.

Manual checks:

- Launch from Start Menu or taskbar.
- Confirm Pi opens in `C:\Users\22003\linear-pi-project-admin-agent-runtime`.
- Confirm `git branch --show-current` in the runtime checkout reports `master`.
- Confirm copy, paste, scrollback, and common shortcut keys work.

## rollback

Manual fallback:

```powershell
cd C:\Users\22003\linear-pi-project-admin-agent
pi
```

Windows Terminal fallback:

```powershell
wt -d C:\Users\22003\linear-pi-project-admin-agent powershell.exe -NoLogo -NoExit -Command "pi"
```

Remove shortcut files:

```powershell
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Linear Project Admin Pi (WezTerm).lnk" -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm).lnk" -ErrorAction SilentlyContinue
```
