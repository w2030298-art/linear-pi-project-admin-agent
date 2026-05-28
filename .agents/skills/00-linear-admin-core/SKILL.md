# Linear Admin Core

## 目的

本 skill 定义 Linear Project Admin Runtime 的核心工作协议：事实先行、计划优先、写入受控、回读校验。

## 触发

任何 Linear 项目管理员任务都应加载本 skill。

## 工作协议

1. 任务开始时识别模式：create / extend / cycle / report / portfolio / dispatch / governance。
2. 复杂任务必须先构造 Fact Pack。
3. 所有输出区分事实、假设、建议、决策、待确认项。
4. 所有 Linear 写入先 dry-run，用户确认后执行。
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
