# Fact Sources

Fact Pack 的目标是保持项目理解充分，同时避免把大块原始数据塞进模型上下文。

## 分层

- **Fact Digest**：进入模型上下文的短摘要，包含 claim、sourceType、source、confidence、summary、evidenceRef。
- **Evidence Store**：原始 Linear/GitHub/local/web JSON，写入 `state/fact-packs/evidence/<fact-id>/`。
- **Evidence Manifest**：Fact Pack 中的索引，指向所有原始证据文件。

## 来源优先级

1. Linear live data：项目管理事实主源。
2. GitHub remote：远端代码、PR、README 和默认分支事实。
3. Local repo：当前工作副本事实，只能代表本机状态。
4. Local docs：项目文档事实。
5. Web search：外部最新资料，必须保留来源。
6. User input：当前对话中的确认决策。

## 单 Project 规则

Fact Pack 默认服务一个 Project。若用户请求全局视图，先返回 Project 候选摘要，再选择一个 Project 进入完整事实采集。

## 冲突规则

- Linear vs GitHub：项目管理状态以 Linear 为准，工程主线以 GitHub 默认分支为准。
- GitHub vs local：local dirty 只作为 working-copy conflict，不覆盖远端事实。
- Web vs repo：web 不能替代当前 repo 实现事实。
- User input vs tool evidence：用户新决策必须标成决策或待确认项，不覆盖已读取事实。

## 输出要求

- 不内联大 JSON。
- 每条事实有简短 summary。
- 原始证据通过 `evidenceRef` 查找。
- 缺失事实写入 `evidenceGaps`。
- 对规划有影响的结论写入 `planningImplications`。
