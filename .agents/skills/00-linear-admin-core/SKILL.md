---
name: linear-admin-core
description: 定义 Linear Project Admin Runtime 的核心协议：事实先行、Fact Pack、一次最终校验+确认+写入、回读校验和审计。任何 Linear 项目管理员任务都应使用。
---

# Linear Admin Core

## 目的

本 skill 定义 Linear Project Admin Runtime 的核心工作协议：事实先行、对话式规划、计划优先、写入受控、回读校验和审计。

## 当前写入协议

所有正常 Linear 写入必须遵循：

```text
linear_build_write_plan -> write plan -> final validation -> pi_ask_user(plan_confirmation) -> approved apply -> readback -> audit
```

`linear_build_write_plan` 是正常结构化写入接口：它构建 write plan，重跑最终校验，展示一次 `plan_confirmation`，并且只在用户批准后立即执行 apply。已有 write plan 文件才使用 `linear_validate_and_apply_write_plan`。不要在正常流程中手动串联 `linear_validate_write_plan`、`pi_ask_user` 和 `linear_apply_write_plan`；这些旧工具只用于兼容诊断或测试。

## 触发

任何 Linear 项目管理员任务都应加载本 skill。

## 工作协议

1. 任务开始时识别模式：create / extend / report / single-project-review / dispatch / governance。
2. 复杂任务必须先构造 Fact Pack。
3. 规划类任务（create / extend）先走 `20-project-planning` 五步协作循环，再输出 write plan。
4. 所有输出区分事实、假设、建议、决策、风险和待确认项。
5. 所有结构化 Linear 写入调用一次 `linear_build_write_plan`；已有 write plan 文件调用一次 `linear_validate_and_apply_write_plan`。用户未批准时不得写入；批准后不得弹第二个确认。
6. 写入后必须回读并记录 audit。

## 输出格式（两段式）

规划与报告类任务统一使用两段式输出：先协作对话，收敛后再出计划。非规划类任务（如纯 fact-pack、workspace-sync）可只输出第一段或直接输出结果。

```markdown
## 协作对话

### 四格澄清（What / Why / Who / How）
[表格或列表；标注已确认 / 待确认]

### 方案对比
[至少 2 个带权衡的方案；标注推荐]

### 假设挑战
[至少 1 个被挑战的假设，或说明无未验证假设]

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

## 分段规则

- `协作对话` 段在信息未收敛前可单独输出并等待用户反馈；不得在未完成四格澄清、方案对比、假设挑战、事实锚定四步时填入 `收敛计划`。
- 方案对比完成后须主动继续假设挑战与事实锚定，不得提前请用户选择方案。
- `收敛计划` 段在用户确认方向或待确认项已闭合后输出；其中 `Linear 写入计划` 仅包含 write plan 摘要，真实结构化 mutation 走 `linear_build_write_plan`；已有 write plan 文件才走 `linear_validate_and_apply_write_plan`。
- 报告/巡检类任务（report / portfolio-review）可省略“方案对比”，但必须保留事实锚定与待确认项。

## 事实一致性

- `收敛计划` 的 `事实` 不得包含事实锚定阶段仍为假设或证据缺口的条目。
- 未验证环境能力（如 OS 调度器、Bridge 是否已部署）保留在 `假设` 或 `待确认项`，直到用户确认或 readback 证实。
