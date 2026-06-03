# /project-report

用户输入：
{{input}}

> **输入绑定**：若 `{{input}}` 仍为字面占位符，以 slash 同行文本或当前 user message 为准。

目标：先锚定事实与证据来源，再生成项目状态报告；报告与 Project Update 草案属于收敛输出，不得跳过事实/readback 边界。

必须读取：
- Linear Project、Issues、Milestones、Project Updates、Comments。
- 关联 GitHub PR、commits、Actions。
- 本地 repo/docs 的最新变更。

输出（两段式）：
- **协作对话段**：事实锚定、证据缺口、待确认项。
- **收敛计划段**：进展、风险、阻塞、决策、下一步、Project Update 草案、事实依据列表（事实/假设分类与事实锚定一致，不得重复归类）
