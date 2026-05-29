# /portfolio-review

目标：审查所有活跃 Linear Projects 的健康度，并输出下一步推进建议。

必须包含：
- 项目状态是否滞后。
- Milestone/Issue 是否缺失验收标准、关系、labels、负责人或 cycle。
- GitHub repo 是否与 Linear 状态一致。
- 本地 repo 是否存在未同步变更。
- 可直接推进的 Ready Issues。
- 风险、阻塞、待确认项。
- 如需执行批量写入，dry-run 后只用 `ask_user` 发起一次确认；不要再要求用户手动输入固定确认句。

用户输入：
{{input}}
