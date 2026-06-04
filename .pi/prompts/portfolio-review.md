---
description: 审查一个 Linear Project 的推进状态
argument-hint: "[Project]"
---

# /portfolio-review

用户输入（Pi slash 参数）：$ARGUMENTS

> **输入绑定**：Pi prompt template 使用 `$ARGUMENTS` 接收 `/portfolio-review ...` 后的同行参数；若为空，先列出 compact Project 候选摘要。

本 prompt 只负责路由，不定义行为协议；调用 skill：`linear-portfolio-review`。

行为来源：`linear-admin-core`、`linear-portfolio-review`、`evidence-based-reporting`。

目标：先锚定事实并列出审查发现，再给出最小推进建议；一次最多处理一个 Project。

路由要求：
- 未指定 Project 时，先列出 compact Project 候选摘要。
- 输出事实锚定、待确认项、风险和收敛建议。
