---
description: 生成 Linear Project 状态报告
argument-hint: "<Project>"
---

# /project-report

用户输入（Pi slash 参数）：$ARGUMENTS

> **输入绑定**：Pi prompt template 使用 `$ARGUMENTS` 接收 `/project-report ...` 后的同行参数；若为空，先询问目标 Project。

本 prompt 只负责路由，不定义行为协议；调用 skill：`linear-project-report`。

行为来源：`linear-admin-core`、`linear-project-report`、`evidence-based-reporting`。

目标：基于 Linear Project 当前状态与 evidenceRef 生成项目状态报告，区分事实、假设、风险、阻塞和下阶段计划。

路由要求：
- 先锚定事实，再生成报告。
- Project Update 草案只能作为收敛输出。
