# WezTerm Pi Smoke - 2026-05-29

## Scope

The `Linear Project Admin Pi (WezTerm)` shortcut now starts an external runtime launcher instead of running Pi directly in the development repo `C:\Users\22003\linear-pi-project-admin-agent`.

## Environment

```text
OS: Microsoft Windows
WezTerm version: 20240203-110809-5046fc22
WezTerm GUI: C:\Program Files\WezTerm\wezterm-gui.exe
Development repo: C:\Users\22003\linear-pi-project-admin-agent
Runtime root: C:\Users\22003\linear-pi-project-admin-agent-runtime
Stable branch: master
```

## Shortcut

Start Menu shortcut:

```text
C:\Users\22003\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Linear Project Admin Pi (WezTerm).lnk
```

Taskbar pinned shortcut file:

```text
C:\Users\22003\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm).lnk
```

Shortcut target:

```text
powershell.exe
```

Shortcut arguments:

```text
-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%LOCALAPPDATA%\LinearProjectAdminPi\launch-linear-pi-runtime.ps1"
```

The launcher invokes:

```powershell
& "C:\Program Files\WezTerm\wezterm-gui.exe" --config-file "%LOCALAPPDATA%\LinearProjectAdminPi\wezterm-linear-pi.lua" start --always-new-process --cwd "C:\Users\22003\linear-pi-project-admin-agent-runtime" powershell.exe -NoLogo -NoExit -Command "pi"
```

Security check: shortcut target and arguments contain no token, secret, API key, or credential value.

## Runtime Sync

The launcher keeps the runtime checkout on `master` and updates with:

```text
git pull --ff-only origin master
```

Feature branch changes do not automatically sync to `master`; they become visible to runtime only after merge.

## In-Session Refresh

`/reload` reloads already-present local Pi files. `/reload-master` is the explicit runtime refresh command for an open WezTerm session: it requires a clean `master` checkout, runs `git fetch origin master`, runs `git pull --ff-only origin master`, refreshes stale npm dependencies, then reloads Pi.

## Automated Evidence

| Check | Evidence | Result |
| --- | --- | --- |
| WezTerm installed | `C:\Program Files\WezTerm\wezterm.exe --version` returned `wezterm 20240203-110809-5046fc22` | Pass |
| Runtime launcher documented | `docs/WEZTERM_PI_LAUNCH.md` references `launch-linear-pi-runtime.ps1` and runtime root | Pass |
| Shortcut key config explicit | Launcher passes `--config-file ...\wezterm-linear-pi.lua` | Pass |
| Stable branch explicit | Launcher uses `master` and `git pull --ff-only` | Pass |
| In-session master refresh explicit | `/reload-master` refuses non-master or dirty checkout, then pulls `origin/master`, refreshes stale npm dependencies, and reloads | Pass |
| Development repo separated | Shortcut no longer uses development repo as direct Pi cwd | Pass |
| rollback documented | Manual `cd` + `pi` and Windows Terminal fallback are documented | Pass |

## Manual Verification

- [ ] Launch `Linear Project Admin Pi (WezTerm)` from Start Menu or taskbar.
- [ ] Confirm the visible Pi session opens in `C:\Users\22003\linear-pi-project-admin-agent-runtime`.
- [ ] Confirm runtime branch is `master`.
- [ ] Confirm interactive `pi` starts and project `.pi/settings.json`, skills, and extensions are loaded.
- [ ] Confirm copy and paste work.
- [ ] Confirm scrollback and common shortcut keys work.

Manual verification should be repeated after installing the new shortcut wrapper.

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
