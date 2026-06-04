---
description: 同步 Linear workspace manifest
argument-hint: "[范围]"
---

# /workspace-sync

用户输入（Pi slash 参数）：$ARGUMENTS

> **输入绑定**：Pi prompt template 使用 `$ARGUMENTS` 接收 `/workspace-sync ...` 后的同行参数；若为空，按默认 workspace sync 范围执行。

本 prompt 只负责路由，不定义行为协议；调用 skill：`workspace-sync`。

行为来源：`workspace-sync`、`governance`。

目标：比对 workspace manifest 与 Linear 实况，锚定事实差异，再给出 manifest 或 repo-map 的收敛更新草案。

路由要求：
- 区分已证实事实、需用户确认的映射和证据缺口。
- 语义不明的 workspace 变化必须先停在待确认项。
