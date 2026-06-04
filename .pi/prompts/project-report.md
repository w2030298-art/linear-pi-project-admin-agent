---
description: 生成 Linear Project 状态报告
argument-hint: "<Project>"
---

**Report Mode**

请调用skill： linear-project-report 完成基于 Linear Project 当前状态与 evidenceRef 生成项目状态报告，区分事实、假设、风险、阻塞和下阶段计划。

详细要求信息：$ARGUMENTS

行为来源:linear-admin-core、linear-project-report、evidence-based-reporting.

路由要求：
-先锚定事实，再生成报告。
-Project Update草案只能作为收敛输出。
