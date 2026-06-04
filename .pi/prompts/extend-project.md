---
description: 扩展一个现有 Linear Project
argument-hint: "<Project> [新增需求]"
---

**Extend Project Mode**

请调用skill： extend-linear-project 围绕一个现有 Linear Project 做五步协作对话，锚定事实后再输出影响分析与收敛计划。

详细要求信息：$ARGUMENTS

行为来源:linear-admin-core、project-planning、extend-linear-project.

路由要求：
-一次只处理一个 Project。
-先输出协作对话与事实锚定，再输出收敛后的追加编排。
-不要复制写入、确认或回读协议。
