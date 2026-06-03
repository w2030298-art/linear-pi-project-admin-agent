# /fact-pack

用户输入：
{{input}}

> **输入绑定**：若 `{{input}}` 仍为字面占位符，以 slash 同行文本或当前 user message 为准。

目标：为后续规划对话锚定事实——采集 Linear / GitHub / local / web 证据，输出 compact 摘要与 evidenceRef，供四格逼问与假设挑战引用；Fact Pack 本身不是 write plan。

必须调用事实来源：
- Linear live data。
- GitHub MCP/API。
- 本地 repo/docs。
- 必要时 web search。

输出 JSON + 中文摘要：**事实**、**假设**、**冲突**、**证据缺口**、**planningImplications**（标注哪些结论可直接用于规划、哪些须待确认）。
