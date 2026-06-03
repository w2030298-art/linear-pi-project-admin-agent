# /extend-project

用户输入：
{{input}}

> **输入绑定**：若 `{{input}}` 仍为字面占位符，以 slash 同行文本或当前 user message 为准；不得要求用户「填入占位符」。

目标：先对新增需求做五步协作对话（四格→方案权衡→**假设挑战→事实锚定**→再请用户选方向），再基于现有 Linear Project 输出影响分析与追加编排；收敛前不直接写 dry-run 计划。

必须先读取：
- Linear Project、Milestones、Issues、Project Updates。
- 关联 GitHub repo 的 README、package、最近 PR/commits。
- 本地 repo/docs 中与需求相关的文件。
- 必要时联网查官方资料。

输出（两段式）：
- **协作对话段**：四格澄清 → 方案对比（≥2）→ 假设挑战（≥1）→ 事实锚定（按序；方案对比后不得跳过 3–4 步直接问选哪个方案）
- **收敛计划段**：当前基线、新需求事实与假设、影响面、Milestones/Issues 变更、dry-run 写入计划
- `收敛计划` 中 `### 事实` 不得包含事实锚定里仍为「假设/证据缺口」的条目
- 如果只是新增 Issue 且已有 Milestone 匹配，应挂到已有 Milestone；write plan 使用 `targetProjectId`、`targetMilestoneId`、`targetMilestoneReadback`
- dry-run 后只用 `ask_user` 发起一次最终确认
