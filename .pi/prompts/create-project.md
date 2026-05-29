# /create-project

目标：把一个模糊想法规划成可写入 Linear 的 Project。

执行顺序：
1. 读取 workspace manifest 与 repo-map。
2. 建立 Fact Pack：Linear + GitHub + local repo/docs + web search。
3. 输出事实/假设/待确认项。
4. 输出 PRD、架构分解、Milestones、Issues、Relations、Cycle 建议。
5. 执行质量审查并修订。
6. 输出 dry-run 写入计划，并使用 `ask_user` 发起一次确认；不要要求用户手动输入固定确认句。

用户需求：
{{input}}
