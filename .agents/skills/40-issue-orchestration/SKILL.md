---
name: issue-orchestration
description: 将 Project、Milestone 和架构计划转成原子化、可执行、可验收的 Linear Issues、依赖关系和 labels。
---

# Issue Orchestration

## Project Baseline Reuse

- For issue_dispatch, reuse Fact Pack `projectBaseline` through `fact_project_baseline_load` before reading full Project context.
- Re-read `linear_get_project_context` only when the baseline is absent, stale, or missing fields required for dispatch.
- Cite the baseline summary and raw `evidenceRef`; do not paste the full Linear Project JSON into the dispatch output.

## 目的

把 Project/Milestone/Architecture 计划转成原子化、可执行、可验收的 Linear Issues。

## Issue 必须包含

- 背景。
- 目标。
- 验收标准。
- 相关事实来源。
- 依赖关系。
- 建议 labels。
- 建议 priority。
- 只围绕 Project、Milestone、Issue 和 relations 编排。
- 不做范围。

## 拆分规则

每个 Issue 应能被一个执行者在一个合理工作窗口内完成。跨越多个模块、无法独立验收、依赖不清的问题必须继续拆分。
