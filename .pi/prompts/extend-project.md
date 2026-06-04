---
description: 扩展一个现有 Linear Project
argument-hint: "<Project> [新增需求]"
---

# /extend-project

用户输入（Pi slash 参数）：$ARGUMENTS

> **输入绑定**：Pi prompt template 使用 `$ARGUMENTS` 接收 `/extend-project ...` 后的同行参数；若为空，先询问目标 Project 和新增需求。

本 prompt 只负责路由，不定义行为协议；调用 skill：`extend-linear-project`。

行为来源：`linear-admin-core`、`project-planning`、`extend-linear-project`。

目标：围绕一个现有 Linear Project 做五步协作对话，锚定事实后再输出影响分析与收敛计划。

路由要求：
- 一次只处理一个 Project。
- 先输出协作对话与事实锚定，再输出收敛后的追加编排。
- 不在 prompt 中复制写入、确认或回读协议。
