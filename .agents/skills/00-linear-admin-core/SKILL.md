---
name: linear-admin-core
description: 定义 Linear Project Admin Runtime 的核心协议：事实先行、Fact Pack、dry-run 写入、回读校验和审计。任何 Linear 项目管理员任务都应使用。
---

# Linear Admin Core

## 目的

本 skill 定义 Linear Project Admin Runtime 的核心工作协议：事实先行、计划优先、写入受控、回读校验。

## 触发

任何 Linear 项目管理员任务都应加载本 skill。

## 工作协议

1. 任务开始时识别模式：create / extend / report / single-project-review / dispatch / governance。
2. 复杂任务必须先构造 Fact Pack。
3. 所有输出区分事实、假设、建议、决策、待确认项。
4. 所有 Linear 写入先 dry-run，用户一次最终确认后执行。
   - 在 Pi 交互模式中，确认必须通过一次 `ask_user` 完成。
   - 不要求用户手动输入固定确认句；`ask_user` 的 approve 结果就是确认来源。
   - 调用 `linear_apply_write_plan` 时用 `confirmedByUser=true` 和 `confirmationText` 记录该次 `ask_user` 确认。
5. 写入后必须回读并记录 audit。

## 输出格式

```markdown
## 事实
## 假设
## 待确认项
## 建议方案
## Linear 写入计划
## 风险与回滚
```
