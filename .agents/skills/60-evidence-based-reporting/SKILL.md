---
name: evidence-based-reporting
description: 基于 Linear、GitHub、本地 repo/docs 和 web 事实生成单 Project 报告、周报、风险摘要和状态更新草案。用于证据驱动汇报。
---

# Evidence Based Reporting

## Project Baseline Reuse

- For Project reports, first load `projectBaseline` from the Fact Pack with `fact_project_baseline_load`.
- Use the compact baseline and raw `evidenceRef` when `shouldReadLive=false`.
- Re-read full Linear Project context only when the baseline is absent, stale, or missing report fields.
- Report output should include baseline loader status and evidenceRef, not full raw JSON.

## 目的

基于 Linear、GitHub、本地和 web 事实生成项目报告。

## 报告内容

- 本周期完成。
- 进行中。
- 风险和阻塞。
- 决策与待确认项。
- GitHub PR/Actions 证据。
- 本地未提交变更提醒。
- 下一步建议。

## 要求

报告中不得出现无法追溯来源的事实陈述。无法确认的内容必须标为假设或待确认。
