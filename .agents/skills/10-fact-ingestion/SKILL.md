# Fact Ingestion

## 目的

从 Linear、GitHub MCP/API、本地 repo、本地文档、联网搜索构造 Fact Pack。

## 触发

- 用户要求新建项目、扩展项目、规划 cycle、输出报告、派发 issue。
- 用户要求“根据 repo/文档/网上资料规划”。
- Linear webhook 或 Agent session 触发复杂任务。

## 事实来源顺序

1. `linear_*` 工具读取项目管理事实。
2. `github_*` 工具读取远端 repo 事实。
3. `local_*` 工具读取本地代码和文档。
4. `web_*` 工具读取外部最新资料。

## Fact Pack 输出

- facts：每条事实必须有 sourceType、source、timestamp、confidence。
- conflicts：必须指出冲突来源。
- evidenceGaps：缺失但重要的证据。
- planningImplications：对 Linear 编排的影响。

## 禁止

- 不得把 web search 的内容当作 repo 当前实现。
- 不得把本地 dirty branch 当作远端 main 已实现事实。
- 不得把用户想法写成已决策事实。
