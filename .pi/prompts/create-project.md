# /create-project

目标：通过五步协作循环（四格逼问→2–3 个方案权衡→挑战假设→锚定事实→收敛出计划），把模糊想法变成可审查的 Linear Project 草案；收敛前不直接堆 Milestones/Issues。

执行顺序：
1. 读取 workspace manifest 与 repo-map。
2. 建立 Fact Pack：Linear + GitHub + local repo/docs + web search。
3. **协作对话段**：四格澄清 → 方案对比（≥2）→ 假设挑战（≥1）→ 事实锚定。
4. 用户确认方向或闭合待确认项后，输出**收敛计划段**：PRD、架构分解、Milestones、Issues、Relations。
5. 执行质量审查并修订。
6. 输出 dry-run 写入计划，并使用 `ask_user` 发起一次最终确认；不要要求用户手动输入固定确认句。

用户需求：
{{input}}
