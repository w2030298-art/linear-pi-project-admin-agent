---
description: 审查一个 Linear Project 的推进状态
argument-hint: "[Project]"
---

**Portfolio Review Mode**

请调用skill： linear-portfolio-review 先锚定事实并列出审查发现，再给出最小推进建议；一次最多处理一个 Project。

详细要求信息：$ARGUMENTS

行为来源:linear-admin-core、linear-portfolio-review、evidence-based-reporting.

路由要求：
-未指定 Project 时，先列出 compact Project 候选摘要。
-输出事实锚定、待确认项、风险和收敛建议。
