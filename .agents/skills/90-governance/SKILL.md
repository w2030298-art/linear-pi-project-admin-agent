---
name: governance
description: 治理 Agent 的配置、证据、写入、安全和迭代策略。用于审查权限、写入策略、审计日志和生产化上线步骤。
---

# Governance

## 目的

治理 Agent 的配置、证据、写入、安全和迭代。

## 检查项

- workspace manifest 与 Linear 是否漂移。
- repo-map 是否缺失或过期。
- labels / workflow states 是否有 unmapped 项。
- write policy 是否被绕过。
- audit log 是否完整。
- fact pack 是否存在证据缺口。
- webhook 是否有 dead-letter。
- GitHub token / Linear token 是否过度授权。

## 输出

- 风险等级。
- 修复建议。
- 可自动执行项。
- 需要用户确认项。
