---
description: 生成 Linear Issue 派发 brief
argument-hint: "<Issue 或 Project>"
---

**Issue Dispatch Mode**

请调用skill： issue-orchestration 基于一个 Linear Issue 或 Project/Milestone 计划生成可执行、可验收、事实锚定的派发 brief。

详细要求信息：$ARGUMENTS

行为来源:linear-admin-core、issue-orchestration.

架构原则：以协作规划为中心；Linear 写入只是收敛后的薄输出适配器。

路由要求：
-读取 Issue / Project baseline 与 evidenceRef。
-只输出实现 brief、验收标准、事实来源、假设或待确认项、约束、依赖和建议验证命令。
-Issue 必须独立可执行、可验收，并保持 Project / Milestone / relation 边界清晰。
-不内嵌外部 agent 长模板。
