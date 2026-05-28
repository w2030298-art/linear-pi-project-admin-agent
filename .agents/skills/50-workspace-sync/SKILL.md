---
name: workspace-sync
description: 同步 Linear workspace 的 teams、members、labels、workflow states、cycles、projects 和 repo-map，使 Agent 适配 workspace 变化。
---

# Workspace Sync

## 目的

同步 Linear workspace 的 teams、members、labels、workflow states、cycles、projects 和 repo-map，使 Agent 能适配 workspace 变化。

## 流程

1. 调用 `linear_workspace_snapshot`。
2. 对比 `config/workspace.manifest.json`。
3. 输出 added/removed/renamed/unmapped。
4. 自动吸收安全变化。
5. 对语义不明变化请求用户确认。

## 需要用户确认的变化

- 新 label 应映射到哪个 label group。
- 新成员 capacity / 默认领域。
- 新 workflow state 的语义。
- 编排策略变化。
