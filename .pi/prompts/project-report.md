---
description: 生成 Linear Project 状态报告
argument-hint: "<Project>"
---

**Report Mode**

请调用skill： linear-project-report 完成基于 Linear Project 当前状态与 evidenceRef 生成项目状态报告，区分事实、假设、风险、阻塞和下阶段计划。

详细要求信息：$ARGUMENTS

行为来源:linear-admin-core、linear-project-report、evidence-based-reporting.

架构原则：以协作规划为中心；Linear 写入只是收敛后的薄输出适配器。

路由要求：
-先锚定事实，再生成报告。
-报告必须区分事实、假设、证据缺口、风险、阻塞、决策和下阶段计划。
-引用 Linear Project、Milestones、Issues、Project Updates、GitHub / local evidenceRef。
-Project Update 草案只能作为收敛输出。
