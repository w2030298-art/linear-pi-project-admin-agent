# Linear Issue 派发 Prompt

用于从 Linear Issue 启动 Cursor Agent 开发任务的标准 prompt 模板。适用于单人研究/工程项目：Issue 负责规划与验收，Agent 负责实现、提交 PR，并在 Issue 下留记录而不改动状态。

---

## 使用方式

1. 在 Linear 中打开目标 Issue，确认描述里已有验收标准、范围边界和依赖说明。
2. 复制下方「Prompt 模板」全文，替换 `{{issue.identifier}}`、`{{issue.branchName}}`、`{{context}}` 等占位符。
3. 在 Cursor 中粘贴并启动 Agent。
4. 任务完成后，Agent 应在 Issue 下留 comment、挂 PR 链接，并在对话中返回 PR URL。

### 模板变量

| 变量 | 说明 |
|---|---|
| `{{issue.identifier}}` | Issue 标识，如 `LIN-123` |
| `{{issue.branchName}}` | Linear 生成的 Git 分支名 |
| `{{context}}` | Issue 描述、验收标准、技术说明、依赖与风险等上下文 |

---

## Prompt 模板

```markdown
# 任务目标: 实现 Linear Issue {{issue.identifier}}

## 核心上下文

- 开发分支: `{{issue.branchName}}`
- Issue 标识: `{{issue.identifier}}`

### 需求详情

{{context}}

---

## 执行流程

请严格按以下阶段顺序执行。每个阶段有明确的完成条件，未满足时不得进入下一阶段。

### 阶段 0：读取 Issue（如工具可用）

1. 使用 Linear 工具读取 `{{issue.identifier}}` 的完整信息。
2. 核对标题、描述、验收标准、依赖关系、labels 与 Milestone 归属。
3. 若下方「需求详情」与 Linear 读取结果冲突，以 Linear 为准，并说明差异。

### 阶段 1：理解需求

1. 通读需求详情，提取验收标准、技术约束和依赖关系。
2. 如果需求存在歧义或关键信息缺失，先列出疑问，等待确认后再继续。
3. 不要修改 Issue 状态、描述或 labels。

### 阶段 2：实现与验证

1. 切换到分支 `{{issue.branchName}}`；若分支不存在则基于主分支创建并 checkout。
2. 在最小必要范围内完成代码实现，遵循项目现有约定。
3. 逐项检查验收标准，列出每一条的通过/未通过状态。
4. 如果存在未通过项或需要用户手动验证的操作，明确列出后暂停，等待确认。

**进入下一阶段的条件**：所有验收标准通过，或用户明确确认可以继续。

### 阶段 3：提交与推送

1. 仅在用户明确要求或当前 workflow 明确要求时创建 commit；commit message 使用简体中文，聚焦「为什么」。
2. 推送到远程分支 `{{issue.branchName}}`。
3. 若远程分支已有更新，先 rebase 或 merge 主分支，解决冲突后再推送。

### 阶段 4：创建 Pull Request

1. 创建或更新指向主分支的 Pull Request。
2. PR 标题或描述中必须包含 `Fixes {{issue.identifier}}`，以触发 Linear 自动关联。
3. 确保 PR 无 merge conflict；若存在，修复后更新 PR。
4. PR 状态设为 Ready for Review。
5. 单人项目无需 Request Review，除非用户明确要求。

### 阶段 5：记录到 Linear

**不要修改 Issue 状态。** 状态流转由 PR merge 与 Linear 自动化处理。

在 Issue `{{issue.identifier}}` 下新增一条 comment，使用下方「Linear Comment 模板」。

同时将 PR URL 作为链接附件挂到 Issue 上（append-only，不覆盖已有链接）。

若 Linear 工具不可用或写入失败，在对话中输出完整 comment 草稿，并明确说明「尚未写入 Linear」。

### 阶段 6：任务汇报

在当前对话的最终回复中提供：

1. PR 的完整 URL
2. 一句话完成情况总结
3. 若有遗留项或待用户操作项，单独列出
```

---

## Linear Comment 模板

Agent 在阶段 5 写入 Issue 时使用：

```markdown
## 实现记录

**PR**: [PR 标题](PR URL)
**分支**: `{{issue.branchName}}`

### 完成内容
- [本次实现的主要变更，2-4 条]

### 验收对照
- [ ] / [x] [验收标准 1]
- [ ] / [x] [验收标准 2]

### 技术决策
- [实现过程中做出的关键决策或取舍；如无则写「无」]

### 遗留项
- [未完成部分、已知限制或需用户手动验证项；如无则写「无」]
```

---

## 设计说明

### 为什么用 Comment，而不是改 Issue 状态

| 维度 | Comment | 修改 Issue 状态/描述 |
|---|---|---|
| 状态流转 | 不干扰；Done 由 PR merge 触发 | 可能与自动化冲突 |
| 可追溯性 | 带时间戳，形成执行时间线 | 描述覆盖后历史丢失 |
| 安全性 | append-only | 有覆盖风险 |
| 多次执行 | 同一 Issue 多轮实现可分段记录 | 通常只保留最后一版 |

**结论**：每次任务完成后在 Issue 下留 comment；Issue 状态交给 Linear 与 GitHub 自动化管理。

### 与当前工作流的对应关系

```text
Linear Issue（规划、验收标准、Milestone）
    ↓ 派发 Prompt
Cursor Agent（实现、本地验证、commit、PR）
    ↓ 阶段 5
Issue Comment + PR Link（执行记录，不改状态）
    ↓ PR merge
Linear 自动关联并关闭 Issue
```

### 相对原版的调整

1. 增加「读取 Issue」步骤，避免仅依赖截断的 `{{context}}`。
2. 增加 Linear comment 与 PR link 附件，形成 Issue 侧可追溯记录。
3. 明确禁止 Agent 擅自修改 Issue 状态。
4. 移除单人场景下无意义的 Request Review 要求。
5. 为 commit 增加「仅在 workflow 或用户明确要求时提交」约束，避免过度主动。
6. 验收未完成时设置明确门控，避免半成品直接开 PR。

---

## 待确认项（可选）

- [ ] 主分支名称是 `main` 还是 `master`
- [ ] PR merge 后是否依赖 Linear GitHub 集成自动关闭 Issue
- [ ] 是否需要在 comment 中 @ 自己或附加截图/日志
