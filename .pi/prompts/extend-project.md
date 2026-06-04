---
description: 扩展一个现有 Linear Project
argument-hint: "<Project> [新增需求]"
---

**Extend Project Mode**

请调用skill： extend-linear-project 围绕一个现有 Linear Project 做五步协作对话，锚定事实后再输出影响分析与收敛计划。

详细要求信息：$ARGUMENTS

行为来源:linear-admin-core、project-planning、extend-linear-project.

架构原则：以协作规划为中心；Linear 写入只是收敛后的薄输出适配器。

路由要求：
-一次只处理一个 Project。
-先做四格逼问与 2-3 个方案权衡，再挑战假设并锚定事实。
-基于当前 Project baseline 判断新增需求属于范围内增强、MVP 变更、架构变更、建议拆分或 later backlog。
-收敛后再输出影响分析、Milestone / Issue / dependency 变更和追加编排。
