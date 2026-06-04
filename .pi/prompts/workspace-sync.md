---
description: 同步 Linear workspace manifest
argument-hint: "[范围]"
---

**Workspace Sync Mode**

请调用skill： workspace-sync 比对 workspace manifest 与 Linear 实况，锚定事实差异，再给出 manifest 或 repo-map 的收敛更新草案。

详细要求信息：$ARGUMENTS

行为来源:workspace-sync、governance.

路由要求：
-区分已证实事实、需用户确认的映射和证据缺口。
-语义不明的 workspace 变化必须先停在待确认项。
