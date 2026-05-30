---
name: linear-project-report
description: 读取一个 Linear Project 当前状态，输出中文项目进展报告，覆盖范围、Milestones、Issues、阻塞、依赖、风险、决策、下阶段计划和状态更新建议。
---

# Linear Project Report

## Purpose

Report on exactly one Linear Project at a time. Use compact evidence summaries and cite raw evidence refs instead of pasting full snapshots.

## Required Inputs

- Target Project id, URL, key, or exact name.
- Optional repo key for GitHub/local evidence.

## Flow

1. Build or read a compact Fact Pack for the target Project.
2. Load `projectBaseline` with `fact_project_baseline_load` and reuse it when `shouldReadLive=false`.
3. Call `linear_get_project_context` only when the Fact Pack baseline is absent, stale, or missing fields needed for the report.
4. Compare Linear state with GitHub/local repo facts when mapped.
5. Identify progress, stale status, blockers, missing labels, missing acceptance criteria, dependency risks, and decisions.
6. Draft a Project update if useful; do not write it without the final write flow.

## Report Shape

- 当前判断
- 事实
- 进度
- 阻塞与依赖
- 风险
- 决策与待确认项
- 建议下一步
- 可写入 Linear 的状态更新草案
- 验证证据

## Boundaries

- Do not summarize all workspace Projects in one report.
- Do not claim a Linear write happened unless readback proves it.
- Do not paste raw Project JSON when an evidenceRef is available.
