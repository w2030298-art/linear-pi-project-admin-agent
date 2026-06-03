---
name: linear-admin-core
description: 定义 Linear Project Admin Runtime 的核心协议：事实先行、Fact Pack、dry-run 写入、回读校验和审计。任何 Linear 项目管理员任务都应使用。
---

# Linear Admin Core

## 目的

本 skill 定义 Linear Project Admin Runtime 的核心工作协议：事实先行、对话式规划、计划优先、写入受控、回读校验。

## 触发

任何 Linear 项目管理员任务都应加载本 skill。

## 工作协议

1. 任务开始时识别模式：create / extend / report / single-project-review / dispatch / governance。
2. 复杂任务必须先构造 Fact Pack。
3. 规划类任务（create / extend）须先走 `20-project-planning` 五步协作循环，再出 write plan。
4. 所有输出区分事实、假设、建议、决策、待确认项。
5. 所有 Linear 写入先 dry-run，用户一次最终确认后执行。
   - 在 Pi 交互模式中，确认必须通过一次 `ask_user` 完成。
   - 不要求用户手动输入固定确认句；`ask_user` 的 approve 结果就是确认来源。
   - 调用 `linear_apply_write_plan` 时用 `confirmedByUser=true` 和 `confirmationText` 记录该次 `ask_user` 确认。
6. 写入后必须回读并记录 audit。

## 输出格式（两段式）

规划与报告类任务统一使用**两段式**输出：先协作对话，收敛后再出计划。非规划类任务（如纯 fact-pack、workspace-sync）可只输出第一段或直接输出结果。

```markdown
## 协作对话

### 四格澄清（What / Why / Who / How）
[表格或列表；标注已确认 / 待确认]

### 方案对比
[至少 2 个带权衡的方案；标注推荐]

### 假设挑战
[≥1 个被挑战的假设，或说明无未验证假设]

### 事实锚定
[已证实事实 / 仍属假设 / 证据缺口；引用 Fact Pack 或 evidenceRef]

---

## 收敛计划

### 事实
### 假设
### 待确认项
### 建议方案
### Linear 写入计划
### 风险与回滚
```

**分段规则**：

- `协作对话` 段在信息未收敛前可单独输出并等待用户反馈；不得在未完成四格/方案/假设挑战时填充 `收敛计划`。
- `收敛计划` 段在用户确认方向或待确认项已闭合后输出；其中 `Linear 写入计划` 仅含 dry-run 摘要，真实 mutation 仍走 write guard。
- 报告/巡检类任务（report / portfolio-review）可省略「方案对比」，但须保留事实锚定与待确认项。
