---
description: 构建 compact Fact Pack
argument-hint: "[任务或对象]"
---

# /fact-pack

用户输入（Pi slash 参数）：$ARGUMENTS

> **输入绑定**：Pi prompt template 使用 `$ARGUMENTS` 接收 `/fact-pack ...` 后的同行参数；若为空，围绕待锚定对象先提出一个必要澄清问题。

本 prompt 只负责路由，不定义行为协议；调用 skill：`fact-ingestion`。

行为来源：`linear-admin-core`、`fact-ingestion`。

目标：采集 Linear / GitHub / local / web 证据，输出 compact Fact Pack、evidenceRef、事实、假设、冲突、证据缺口和 planningImplications。

路由要求：
- Fact Pack 用于后续协作对话与锚定事实。
- 原始证据落盘，prompt 只承载 compact 摘要。
