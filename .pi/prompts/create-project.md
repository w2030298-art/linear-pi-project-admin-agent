---
description: 创建一个 Linear Project 草案
argument-hint: "[需求描述]"
---

# /create-project

用户输入（Pi slash 参数）：$ARGUMENTS

> **输入绑定**：Pi prompt template 使用 `$ARGUMENTS` 接收 `/create-project ...` 后的同行参数；若为空，围绕命令目标先提出一个必要澄清问题。

本 prompt 只负责路由，不定义行为协议；调用 skill：`create-linear-project`。

行为来源：`linear-admin-core`、`project-planning`、`create-linear-project`。

目标：启动五步协作循环，把模糊想法通过协作对话、Fact Pack、事实锚定和收敛计划转成一个 Linear Project 草案。

路由要求：
- 保持两段式：先协作对话，再收敛计划。
- 禁止在方案对比后直接进入选择或计划；必须先完成假设挑战与事实锚定。
