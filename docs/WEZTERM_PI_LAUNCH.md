# WezTerm Pi 灰度启动说明

## 目标

本说明用于 WEN-259 的灰度路径：从 Windows 任务栏启动 WezTerm，自动进入 `C:\Users\22003\linear-pi-project-admin-agent`，并运行 `pi`。该路径只用于本地启动体验验证，不改变 Linear 写入策略、token 配置或默认终端决策。

## 官方依据

- Windows 安装：WezTerm 官方文档要求 64-bit Windows 10.0.17763 或更新版本，支持 setup.exe、zip、winget、Scoop、Chocolatey；winget 命令为 `winget install wez.wezterm`。
- GUI 启动器：官方 CLI 文档建议 Windows GUI launcher 明确指向 `wezterm-gui.exe`，避免额外 console host。
- 工作目录：`wezterm start --cwd <path>` 会指定初始程序的当前工作目录。
- `default_cwd`：可在 WezTerm 配置中设置默认工作目录；当命令行使用 `wezterm start --cwd <path>` 时，`--cwd` 优先。

参考：

- https://wezterm.org/install/windows.html
- https://wezterm.org/cli/general.html
- https://wezterm.org/cli/start.html
- https://wezterm.org/config/launch.html
- https://wezterm.org/config/lua/config/default_cwd.html

## 安装

首选 winget：

```powershell
winget install wez.wezterm
```

本机灰度安装记录：

```text
WezTerm version: 20240203-110809-5046fc22
GUI executable: C:\Program Files\WezTerm\wezterm-gui.exe
CLI executable: C:\Program Files\WezTerm\wezterm.exe
```

如果新开的 PowerShell 中仍找不到 `wezterm`，直接使用完整路径 `C:\Program Files\WezTerm\wezterm-gui.exe`。本灰度快捷方式使用完整路径，不依赖 PATH。

## 启动命令

任务栏快捷方式目标：

```text
C:\Program Files\WezTerm\wezterm-gui.exe
```

任务栏快捷方式参数：

```text
start --always-new-process --cwd "C:\Users\22003\linear-pi-project-admin-agent" powershell.exe -NoLogo -NoExit -Command "pi"
```

该参数只包含 cwd 和启动命令，不包含 token、secret、API key 或其他凭据。

等价命令行：

```powershell
& "C:\Program Files\WezTerm\wezterm-gui.exe" start --always-new-process --cwd "C:\Users\22003\linear-pi-project-admin-agent" powershell.exe -NoLogo -NoExit -Command "pi"
```

## 使用范围

WezTerm 本身不是只能用于 `C:\Users\22003\linear-pi-project-admin-agent`，它是通用终端。当前只自动进入该目录并启动 `pi`，是因为这个灰度快捷方式显式写入了：

- `--cwd "C:\Users\22003\linear-pi-project-admin-agent"`
- `powershell.exe -NoLogo -NoExit -Command "pi"`

如果需要给其他 repo 或普通 shell 使用 WezTerm，创建单独快捷方式并改 `--cwd` / 启动命令即可。不要把多个项目强行塞进同一个快捷方式，也不要在快捷方式中写入 token 或其他凭据。

## 直接运行 WezTerm 闪退排查

不要直接双击 `C:\Program Files\WezTerm\wezterm.exe`。这是 CLI 入口，直接运行会立即退出，看起来像闪退。Windows GUI 入口应使用：

```text
C:\Program Files\WezTerm\wezterm-gui.exe
```

本机还存在一个全局 WezTerm 配置 `C:\Users\22003\.wezterm.lua`，它把默认程序设置为 AI Workbench 的启动脚本。普通 Start Menu 的 `WezTerm.lnk` 会读取该全局配置，因此它不是干净的通用 PowerShell 入口。

为了保留全局 AI Workbench 配置，同时提供一个稳定的普通终端入口，已创建用户级快捷方式：

```text
C:\Users\22003\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\WezTerm PowerShell (No Config).lnk
```

该快捷方式目标为 `wezterm-gui.exe`，参数为：

```text
-n start --cwd "C:\Users\22003" powershell.exe -NoLogo -NoExit
```

其中 `-n` 表示跳过全局 `.wezterm.lua`，避免被其他项目的 `default_prog` 影响。这个普通终端入口不替代 WEN-259 的 Pi 专用快捷方式。

## 已创建的快捷方式

Start Menu shortcut：

```text
C:\Users\22003\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Linear Project Admin Pi (WezTerm).lnk
```

Taskbar pinned shortcut file：

```text
C:\Users\22003\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm).lnk
```

如果 Windows 任务栏没有立即显示该图标，在 Start Menu 搜索 `Linear Project Admin Pi (WezTerm)`，右键选择 pin to taskbar。Windows 11 对任务栏 pin 有缓存，直接写入 pinned shortcut 目录不一定立即刷新 UI。

## 可选 default_cwd 配置

本灰度路径优先使用快捷方式里的 `start --cwd`，不要求修改全局 WezTerm 配置。若后续希望把本项目作为 WezTerm 默认工作目录，可在 `%USERPROFILE%\.wezterm.lua` 中加入：

```lua
local wezterm = require 'wezterm'
local config = {}

config.default_cwd = 'C:/Users/22003/linear-pi-project-admin-agent'

return config
```

不要在 WezTerm 配置文件中自动启动 `pi` 或写入任何 token。官方配置文档提醒配置文件会在启动和 reload 时多次求值；把启动 `pi` 放进配置文件会产生重复后台进程风险。

## Smoke 检查

自动 smoke 覆盖：

- WezTerm executable 存在并能返回版本。
- `wezterm-gui.exe start --cwd ...` 能在本项目目录执行命令。
- 在 WezTerm 启动链路下 `pi --version` 返回 `0.77.0`。
- Taskbar `.lnk` 可通过 `Start-Process` 拉起 `wezterm-gui.exe`。

人工 smoke 仍需覆盖：

- 启动后进入交互式 `pi`。
- 项目级 `.pi/settings.json`、skills 和 extensions 在交互式 UI 中显示/加载正常。
- 中文输入无明显阻塞。
- 复制粘贴无明显阻塞。
- 滚动无明显阻塞。
- 常用快捷键无明显阻塞。
- 主题和字体可接受。

## 回退

手动启动回退：

```powershell
cd C:\Users\22003\linear-pi-project-admin-agent
pi
```

Windows Terminal 回退：

```powershell
wt -d C:\Users\22003\linear-pi-project-admin-agent powershell.exe -NoLogo -NoExit -Command "pi"
```

删除灰度快捷方式：

```powershell
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Linear Project Admin Pi (WezTerm).lnk" -ErrorAction SilentlyContinue
Remove-Item "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Linear Project Admin Pi (WezTerm).lnk" -ErrorAction SilentlyContinue
```

如 WezTerm 与 Pi TUI、中文输入或快捷键存在兼容问题，不要把 WezTerm 升级为默认路线；继续使用手动 `cd` + `pi` 或 Windows Terminal，并把问题记录到 WEN-260 决策项。
