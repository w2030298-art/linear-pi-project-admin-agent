# 事实来源层设计

## 1. 为什么需要事实来源层

项目规划 Agent 容易产生两个风险：

1. 用模型记忆替代当前项目状态。
2. 用用户的高层想法直接生成任务，而没有读取 repo、文档、Linear 状态和最新外部资料。

本项目用 Fact Pack 解决该问题。

## 2. Fact Pack 生命周期

```text
user request / Linear trigger
  → identify scope
  → collect Linear facts
  → collect GitHub facts
  → collect local repo/docs facts
  → optional web research
  → normalize facts
  → detect conflicts
  → produce planning implications
  → planner + reviewer
```

## 3. 来源说明

### Linear live data

用于确认项目状态、任务状态、labels、workflow states、Cycles、Project Updates。Linear 是项目管理事实的主源。

### GitHub MCP / REST

用于确认远端工程事实：repo 结构、README、PR、Actions、release、commits。优先 MCP，fallback REST。

### Local repo

用于确认本地工作副本事实：branch、commit、dirty、未提交变更、本地 docs。必须标注 dirty 状态。

### Local docs

用于确认 PRD、ADR、研究资料、会议记录、设计文档。必须记录路径和 mtime。

### Web search

用于确认外部事实：官方文档、依赖库变化、最新 API、标准、竞品。必须记录 URL 和 provider。

## 4. 冲突规则

- Linear vs GitHub：Linear 决定项目状态，GitHub 决定代码状态。
- GitHub vs local：GitHub default branch 决定远端主线，本地 dirty 只代表当前工作副本。
- Web vs repo：web 只能提供外部背景，不覆盖 repo 实现。
- User vs tool：用户可以决策，但不能改变工具读取到的历史事实。
