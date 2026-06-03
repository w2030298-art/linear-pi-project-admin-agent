# /create-project

用户需求：
{{input}}

> **输入绑定**：需求文本来源优先级为 (1) slash 同行附加文本 (2) 当前 user message (3) 上方块内已替换的 `{{input}}`。若占位符仍为字面量 `{{input}}` 且无同行文本，**直接使用当前 user message**，不得要求用户「填入占位符」或因此中断流程。

目标：通过五步协作循环（四格逼问→2–3 个方案权衡→挑战假设→锚定事实→收敛出计划），把模糊想法变成可审查的 Linear Project 草案；收敛前不直接堆 Milestones/Issues。

执行顺序：
1. 读取 workspace manifest 与 repo-map。
2. 建立 Fact Pack：Linear + GitHub + local repo/docs + web search。
3. **协作对话段**（步骤 1→4 须按序完成，完成后才问用户选方案）：
   - 四格澄清 → 方案对比（≥2）→ **假设挑战（≥1）** → **事实锚定**
   - 禁止在方案对比后直接进入「你选哪个方案？」；须先输出假设挑战与事实锚定
4. 用户确认方向或闭合待确认项后，输出**收敛计划段**：PRD、架构分解、Milestones、Issues、Relations。
5. 执行质量审查并修订。
6. 输出 dry-run 写入计划，并使用 `ask_user` 发起一次最终确认；不要要求用户手动输入固定确认句。
