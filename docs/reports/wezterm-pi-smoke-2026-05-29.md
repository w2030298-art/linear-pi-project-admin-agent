# WezTerm Pi Smoke｜2026-05-29

## Scope

WEN-259 灰度验证：使用 Windows 任务栏快捷方式打开 WezTerm，进入 `C:\Users\22003\linear-pi-project-admin-agent` 并运行 `pi`。

## Environment

```text
OS: Microsoft Windows NT 10.0.26200.0
PowerShell: 5.1.26100.8457
WezTerm version: 20240203-110809-5046fc22
WezTerm GUI: C:\Program Files\WezTerm\wezterm-gui.exe
WezTerm CLI: C:\Program Files\WezTerm\wezterm.exe
Pi version: 0.77.0
Repo: C:\Users\22003\linear-pi-project-admin-agent
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

Target:

```text
C:\Program Files\WezTerm\wezterm-gui.exe
```

Arguments:

```text
start --always-new-process --cwd "C:\Users\22003\linear-pi-project-admin-agent" powershell.exe -NoLogo -NoExit -Command "pi"
```

Security check: shortcut target and arguments contain no token, secret, API key, or credential value.

## Automated evidence

| Check | Evidence | Result |
| --- | --- | --- |
| WezTerm installed | `C:\Program Files\WezTerm\wezterm.exe --version` returned `wezterm 20240203-110809-5046fc22` | Pass |
| `start --cwd` enters repo | WezTerm GUI smoke wrote `C:\Users\22003\linear-pi-project-admin-agent` from `$PWD.Path` | Pass |
| Pi callable through WezTerm launch chain | WezTerm GUI smoke wrote `0.77.0` from `pi --version` | Pass |
| Taskbar shortcut launches WezTerm | `Start-Process` on taskbar `.lnk` created `wezterm-gui.exe` process, then smoke process was closed | Pass |
| Project files present | `.pi/settings.json`, `.agents/skills`, `.pi/extensions` exist in repo | Pass |
| Visible Pi TUI starts | Taskbar `.lnk` launched a visible WezTerm window running Pi; the window showed project context, skills, and extensions loaded | Pass |
| rollback documented | `docs/WEZTERM_PI_LAUNCH.md` includes manual `cd` + `pi` and Windows Terminal fallback | Pass |

## Visible and manual verification

These items are the grey-rollout checklist before WEN-260 decides whether WezTerm becomes the default route:

- [x] From Windows taskbar shortcut path, launch `Linear Project Admin Pi (WezTerm)` and confirm the visible window opens.
- [x] Confirm the prompt is in `C:\Users\22003\linear-pi-project-admin-agent`.
- [x] Confirm interactive `pi` starts and project `.pi/settings.json`, skills, and extensions are loaded.
- [ ] Confirm Chinese input works in the Pi TUI.
- [ ] Confirm copy/paste works.
- [ ] Confirm scrollback works.
- [ ] Confirm common shortcuts do not block normal Pi operation.
- [x] Confirm theme and font rendering are acceptable for grey rollout.

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

## Decision input for WEN-260

Current automated evidence is enough to continue a local grey rollout, but not enough to make WezTerm the final default. WEN-260 should wait for the manual verification checklist above, especially Chinese input, copy/paste, scrollback, shortcuts, theme, and font behavior.
