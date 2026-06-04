---
description: 创建一个 Linear Project 草案
argument-hint: "[需求描述]"
---

**Create Project Mode**

请调用skill： create-linear-project 完成五步协作循环（四格逼问→2-3 个方案权衡→挑战假设→锚定事实→收敛出计划），把模糊想法变成可审查的 Linear Project 草案。

详细要求信息：$ARGUMENTS

行为来源:linear-admin-core、project-planning、create-linear-project.

架构原则：以协作规划为中心；Linear 写入只是收敛后的薄输出适配器。

路由要求：
-先逼问四格（What / Why / Who / How），再给出 2-3 个带权衡的方案。
-方案之后必须挑战假设并锚定事实；不得把未读取的 Linear / GitHub / local / web 信息写成事实。
-收敛后再输出 PRD、非目标、成功指标、Milestones、Issues、Relations 和可审查计划。
-禁止在方案对比后直接进入选择或计划；必须先完成假设挑战与事实锚定。
