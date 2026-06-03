# /portfolio-review

用户输入：
{{input}}

> **输入绑定**：若 `{{input}}` 仍为字面占位符，以 slash 同行文本或当前 user message 为准。

目标：先锚定事实并列出审查发现，再给出最小推进建议；仅在收敛后输出至多一个 Project 的 dry-run 写入计划。一次最多处理一个 Project。若用户没有指定 Project，先列出 compact Project 候选摘要，让用户选择一个目标。

必须包含：
- **协作对话段**：目标 Project 身份与 evidenceRef、事实锚定（Linear/GitHub/本地一致性）、待确认项。
- **收敛计划段**：Milestone/Issue 是否缺失验收标准、关系、labels 或负责人；GitHub repo 是否与 Linear 状态一致；本地 repo 是否存在未同步变更；可直接推进的 Ready 候选或建议保持不动的理由；风险、阻塞。
- 如需写入，dry-run 后只用 `ask_user` 发起一次最终确认；不要再要求用户手动输入固定确认句。
