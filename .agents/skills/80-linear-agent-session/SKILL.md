---
name: linear-agent-session
description: 处理 Linear @mention、delegate issue、Agent:* label trigger 和 webhook 事件，将 Linear-native 唤醒转化为 Pi 任务队列。
---

# Linear Agent Session

## 目的

处理 Linear @mention、delegate issue、Agent:* label trigger 和 webhook 事件。

## 入口

- AgentSessionEvent created / prompted。
- Issue/Comment/Project update with Agent:* label。
- 用户在 Linear 中回复 approve / reject / revise。

## 行为

1. 快速发送 Agent Activity：thought。
2. 建立或恢复 Pi session。
3. 读取 promptContext 和相关 Linear 对象。
4. 构造 Fact Pack。
5. 输出 plan 或 ask clarifying question。
6. 需要写入时发布 dry-run comment。
7. 用户 approve 后写入。
8. 回读并发布 response。
