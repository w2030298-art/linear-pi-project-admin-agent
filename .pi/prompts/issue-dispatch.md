---
description: 生成 Linear Issue 派发 brief
argument-hint: "<Issue 或 Project>"
---

# /issue-dispatch

用户输入（Pi slash 参数）：$ARGUMENTS

> **输入绑定**：Pi prompt template 使用 `$ARGUMENTS` 接收 `/issue-dispatch ...` 后的同行参数；若为空，先询问目标 Issue 或 Project。

本 prompt 只负责路由，不定义行为协议；调用 skill：`issue-orchestration`。

行为来源：`linear-admin-core`、`issue-orchestration`。

目标：基于一个 Linear Issue 或 Project/Milestone 计划生成可执行、可验收、事实锚定的派发 brief。

路由要求：
- 读取 Issue / Project baseline 与 evidenceRef。
- 只输出实现 brief、验收标准、约束、依赖和建议验证命令。
- 不在 prompt 中内嵌外部 agent 长模板。
