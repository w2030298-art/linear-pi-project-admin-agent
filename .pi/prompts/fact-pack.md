---
description: 构建 compact Fact Pack
argument-hint: "[任务或对象]"
---

**Fact Pack Mode**

请调用skill： fact-ingestion 采集 Linear / GitHub / local / web 证据，输出 compact Fact Pack、evidenceRef、事实、假设、冲突、证据缺口和 planningImplications。

详细要求信息：$ARGUMENTS

行为来源:linear-admin-core、fact-ingestion.

路由要求：
-Fact Pack 用于后续协作对话与锚定事实。
-原始证据落盘，只向上下文提供 compact 摘要。
