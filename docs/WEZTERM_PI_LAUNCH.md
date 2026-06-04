# WezTerm Pi Stable Runtime Launcher

## Goal

`Linear Project Admin Pi (WezTerm)` must not start directly inside the development repo. That repo is allowed to sit on feature branches while work is in progress.

The shortcut starts an external launcher instead:

```text
%LOCALAPPDATA%\LinearProjectAdminPi\launch-linear-pi-runtime.ps1
```

The launcher maintains a separate runtime checkout:

```text
%USERPROFILE%\linear-pi-project-admin-agent-runtime
```

The runtime checkout tracks the stable branch `master`. On each launch it runs a fast-forward-only sync (`git pull --ff-only origin master`). Feature branch changes do not automatically sync to `master`; they only reach runtime after a PR/merge updates `master`.

This checkout exists by design. Treat it as a managed runtime copy, not as the normal development workspace. Its purpose is to keep taskbar/start-menu Pi startup on stable `master` while the development repo can stay on feature branches, with uncommitted edits, or inside PR conflict resolution.

## Install Or Repair

Run from a checked-out source repo:

```powershell
& ".\scripts\install-wezterm-linear-pi-shortcut.ps1"
```

For this Windows machine's observed shortcut target, arguments, working directory, installed launcher files, and latest launch-log diagnosis, see `docs/LOCAL_RUNTIME_LAUNCH.md`.

The installer writes these user-level runtime files:

```text
%LOCALAPPDATA%\LinearProjectAdminPi\launch-linear-pi-runtime.ps1
%LOCALAPPDATA%\LinearProjectAdminPi\wezterm-linear-pi.lua
%LOCALAPPDATA%\LinearProjectAdminPi\linear-project-admin-pi.ico
%LOCALAPPDATA%\LinearProjectAdminPi\launch.log
```

The installer creates or repairs the standard shortcuts:

```text
%APPDATA%\Microsoft\Windows\Start Menu\Programs\Linear Project Admin Pi (WezTerm).lnk
%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm).lnk
```

On this machine, Windows also has a duplicate pinned shortcut named `Linear Project Admin Pi (WezTerm) (2).lnk`; it points at the same installed launcher. See `docs/LOCAL_RUNTIME_LAUNCH.md`.

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

1. Ensures `%USERPROFILE%\linear-pi-project-admin-agent-runtime` exists as a clone of the GitHub repo.
2. Stashes generated runtime state if present.
3. Stashes accidental code/config dirty state with `linear-pi-runtime-code-drift-before-launch` if present, so startup can continue without deleting local changes.
4. Runs `git fetch origin master`.
5. Switches the managed runtime checkout to `master`.
6. Runs `git pull --ff-only origin master`.
7. Runs `npm ci` only when dependencies are missing or package manifests changed.
8. Runs `npm run validate` in the runtime checkout.
9. Starts WezTerm:

```powershell
& "C:\Program Files\WezTerm\wezterm-gui.exe" --config-file "%LOCALAPPDATA%\LinearProjectAdminPi\wezterm-linear-pi.lua" start --always-new-process --cwd "%USERPROFILE%\linear-pi-project-admin-agent-runtime" powershell.exe -NoLogo -NoExit -Command "pi"
```

## WezTerm Config

The installed `wezterm-linear-pi.lua` loads the user's normal WezTerm config first, then overrides the managed Pi shortcut bindings for copy, paste, command palette, search, tab open, and tab close.

Managed shortcut behavior:

| Shortcut | Behavior |
| --- | --- |
| `Ctrl+C` | Copy selected text; if nothing is selected, send terminal interrupt. |
| `Ctrl+Shift+C` / `Ctrl+Insert` | Copy selected text. |
| `Ctrl+V` / `Ctrl+Shift+V` / `Shift+Insert` | Paste from the Windows clipboard. |
| `Ctrl+F` / `Ctrl+Shift+F` | Search terminal scrollback. |
| `Ctrl+P` / `Ctrl+Shift+P` / `F2` | Open WezTerm command palette. |
| `Ctrl+T` / `Ctrl+Shift+T` | Open a new tab. |
| `Ctrl+W` / `Ctrl+Shift+W` | Close the current tab after confirmation. |

It reads `LINEAR_PI_RUNTIME_ROOT` and uses it as `default_cwd`; if the variable is missing, it falls back to:

```text
%USERPROFILE%\linear-pi-project-admin-agent-runtime
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
<your development checkout>
```

The runtime launcher does not run Pi in that development repo. It does not merge feature branches. It does not automatically sync feature branch changes into `master`.

To make a feature available in the runtime launcher:

1. Merge the feature branch PR into `master`.
2. Start `Linear Project Admin Pi (WezTerm)` again.
3. The launcher fast-forwards the runtime checkout to the new `master`.

## Runtime Deployment Gates

Runtime updates should be accepted before they reach the stable launcher path:

1. Pull requests and `master` pushes run `.github/workflows/runtime-ci.yml`.
2. The workflow installs dependencies on `windows-latest`, runs `npm run validate`, runs `npm run typecheck`, then runs `npm run runtime:acceptance -- --ci`.
3. Before relying on the local WezTerm runtime after a merge, run:

```powershell
npm run runtime:acceptance -- --sync
```

The local acceptance command verifies that `%USERPROFILE%\linear-pi-project-admin-agent-runtime` is a `master` checkout with the same `origin` remote as the source repo, stashes any local runtime drift before sync with `linear-pi-runtime-code-drift-before-acceptance`, fast-forwards it with `git pull --ff-only origin master`, refreshes dependencies, and runs the runtime reload, local protection, instruction boundary, and WezTerm launch tests inside the runtime checkout.

## Refresh While Running

Use Pi's built-in `/reload` when local files are already updated and only the in-process extensions, skills, prompts, and themes need to reload.

Use the project command `/reload-master` when the WezTerm runtime is already open and should pull latest origin/master before reloading. The command:

1. Refuses to run outside a git worktree.
2. Refuses to run unless the current branch is `master`.
3. Stashes generated runtime state if present.
4. Stashes accidental code/config dirty state with `linear-pi-runtime-code-drift-before-reload` if present, so refresh can continue without deleting local changes.
5. Runs `git fetch origin master`.
6. Runs `git pull --ff-only origin master`.
7. Runs `npm ci` when dependency files are missing or stale, or `npm install` if no lockfile exists.
8. If dependency installation fails, reports the failure and keeps using the currently running runtime without calling reload.
9. Calls `ctx.reload()` only after dependency installation succeeds.

This gives the running Pi session the same stable-branch refresh behavior as a fresh shortcut launch without switching a development repo away from its feature branch.

## Local Runtime Files

The runtime checkout may contain machine-local files that are not owned by `master`. These files are intentionally ignored by Git, so startup sync and `/reload-master` leave them in place:

- `.env` and `.env.*`, except the tracked template `.env.example`.
- `.pi/sessions/`.
- `node_modules/`.
- `state/audit.jsonl`, `state/linear-events.jsonl`, and other root `state/*.jsonl` logs.
- `state/fact-packs/*.json`.
- `state/pi-queue/*.md` and `state/pi-queue/*.log`.
- `state/repo-map.draft.yaml`, `state/repo-map.local.yaml`, and `state/repo-map-audit.jsonl`.
- `state/workspace.manifest.draft.json` and other root `state/*.draft.json` / `state/*.draft.yaml` drafts.
- `state/write-plans/`, `state/audit-reports/`, `state/linear-apply-progress/`, and local `state/sessions/*` files except `.gitkeep`.
- Root `nul` / `NUL` files accidentally created by Windows command redirection mistakes.

For the installed WezTerm runtime, the launcher exports `REPO_MAP_LOCAL_PATH=%LOCALAPPDATA%\LinearProjectAdminPi\repo-map.local.yaml` before starting Pi. This keeps durable machine-local repo mappings outside the runtime checkout, so startup sync and `/reload-master` do not see them as local Git changes.

The launcher and `/reload-master` use `git pull --ff-only`. This path does not run `git clean`, `git reset --hard`, or recursive deletion of the runtime root. If local non-ignored code/config changes appear in the managed runtime checkout, they are quarantined in Git stash before sync. If stash, branch validation, dependency installation, or fast-forward pull fails, the launcher reports the failure instead of deleting files.

## Runtime Instruction Maintenance

Do not restore a root `AGENTS.md` for this repository. Root `AGENTS.md` files are automatically consumed by development agents such as Codex, so keeping the Linear Project Admin runtime persona there would affect normal development work on this repo.

Maintain runtime behavior instructions in explicit Pi-owned files instead:

- `SYSTEM.md` for the core Linear Project Admin runtime identity and hard safety boundaries.
- `.pi/settings.json` for loaded extensions, prompts, skills, and session paths.
- `.pi/prompts/` and `.agents/skills/` for command-specific or skill-specific behavior.
- `docs/` for operator-facing policy and maintenance notes.

When changing runtime instructions, use a normal feature branch or worktree, update the relevant tests, merge through PR, then use the runtime launcher or `/reload-master` after `master` contains the change.

## Smoke Checks

Automated checks cover:

- The launcher script name and runtime root are documented.
- The shortcut uses `powershell.exe` to run `launch-linear-pi-runtime.ps1`.
- The runtime branch is `master` and uses `git pull --ff-only`.
- The launcher, local acceptance, and `/reload-master` stash runtime code/config drift before pulling `origin/master`.
- Runtime-local files such as `.env`, sessions, logs, repo-map drafts/local overlays, write plans, and audit reports are ignored or stored outside the checkout and not cleaned by the launcher.
- Root `AGENTS.md` is absent so development agents are not steered by the Linear Project Admin runtime persona.
- The WezTerm config includes copy and paste shortcut bindings.
- No token, secret, API key, or credential value is stored in shortcut docs.

Manual checks:

- Launch from Start Menu or taskbar.
- Confirm Pi opens in `%USERPROFILE%\linear-pi-project-admin-agent-runtime`.
- Confirm `git branch --show-current` in the runtime checkout reports `master`.
- Confirm copy, paste, scrollback, and common shortcut keys work.

## rollback

Manual fallback:

```powershell
cd <your development checkout>
pi
```

Windows Terminal fallback:

```powershell
wt -d <your development checkout> powershell.exe -NoLogo -NoExit -Command "pi"
```

Remove shortcut files:

```powershell
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Linear Project Admin Pi (WezTerm).lnk" -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm).lnk" -ErrorAction SilentlyContinue
```
