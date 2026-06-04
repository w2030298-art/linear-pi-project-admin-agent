---
description: 审查一个 Linear Project 的推进状态
argument-hint: "[Project]"
---

**Portfolio Review Mode**

请调用skill： linear-portfolio-review 先锚定事实并列出审查发现，再给出最小推进建议；一次最多处理一个 Project。

详细要求信息：$ARGUMENTS

行为来源:linear-admin-core、linear-portfolio-review、evidence-based-reporting.

架构原则：以协作规划为中心；Linear 写入只是收敛后的薄输出适配器。

路由要求：
-未指定 Project 时，先列出 compact Project 候选摘要。
-一次只审查一个 Project，不做 workspace-wide 全量审查。
-输出事实、假设、待确认项、证据缺口、风险和最小推进建议。
-只在事实锚定后给出 Ready 候选或建议保持不动的理由。
