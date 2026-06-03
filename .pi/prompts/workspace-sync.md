# /workspace-sync

用户输入：
{{input}}

> **输入绑定**：若 `{{input}}` 仍为字面占位符，以 slash 同行文本或当前 user message 为准。

目标：先比对 workspace manifest 与 Linear 实况并锚定差异事实，收敛后再给出 manifest 更新草案；同步不是项目规划，但须区分事实与需用户确认的映射。

读取 Linear teams、members、labels、workflow states、projects，与 config/workspace.manifest.json 比较。

输出（两段式）：
- **协作对话段**：新增、删除、重命名、语义不明项；需用户确认的映射；证据引用。
- **收敛计划段**：自动吸收项、更新后的 manifest 草案
