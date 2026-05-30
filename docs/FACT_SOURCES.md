# Fact Sources

## Project Baseline Reuse

- Fact Pack includes `projectBaseline` when Linear Project evidence is present.
- `projectBaseline.rawEvidenceRef` points to the raw Project evidence file under `state/fact-packs/evidence/<fact-id>/`.
- Report, extend_project, and issue_dispatch flows must load the compact baseline first.
- Call `linear_get_project_context` only when the baseline is absent, stale, or missing fields required by the task.

## Linear Object Exact Resolver

- Write plans may use `labelNames`, `workflowStateName` / `workflowStateType`, and `milestoneName` when a workspace object manifest is available.
- Labels resolve by `teamKey` or team ID plus exact label name and optional group. Duplicate matches or mutually exclusive label-group conflicts are blocking findings.
- Workflow states resolve only inside the requested team; cross-team fallback is not allowed.
- Project Milestones resolve by exact `projectId` plus milestone name; workspace-level milestone-name matching is not allowed.
- Dry-run output includes each name-to-ID `resolutions` entry with the workspace manifest `evidenceRef`. Missing or ambiguous resolutions block real apply.
- The cached manifest defaults to `state/workspace-object-manifest.json` and can be redirected with `LINEAR_WORKSPACE_OBJECT_MANIFEST_PATH`.

## Issue Relation Exact Resolver

- `issueRelation.create` and `issue.relation.create` may use `issueIdentifier` and `relatedIssueIdentifier` for exact issue targets.
- WEN-style identifiers use exact `issue(id: "...")` lookup semantics only; full-text issue search is not a fallback.
- UUID values are accepted directly. `$opRef` remains supported through `issueRef` / `relatedIssueRef`, and also works after generic `$ref` expansion into identifier fields.
- Dry-run output includes identifier-to-ID `resolutions` with `identifier`, issue title, URL, and `evidenceRef`. Lookup failure blocks apply before any mutation.

## Write Plan Review Calibration

- Write plan reviewer gates milestone evidence by operation type. Issue state changes and Project Update creation do not require unrelated milestone readback.
- Issue creation and issue milestone changes still require a Project Milestone target or verified milestone readback.
- Pass `--workspace-manifest <path>` to `scripts/plan-reviewer.mjs` when quality review must preflight label names against Linear label groups.
- Labels with the same Linear parent group are treated as mutually exclusive unless the manifest explicitly sets that group to `exactlyOne: false` or `mutuallyExclusive: false`.

Fact Pack 的目标是保持项目理解充分，同时避免把大块原始数据塞进模型上下文。

## 分层

- **Fact Digest**：进入模型上下文的短摘要，包含 claim、sourceType、source、confidence、summary、evidenceRef。
- **Evidence Store**：原始 Linear/GitHub/local/web JSON，写入 `state/fact-packs/evidence/<fact-id>/`。
- **Evidence Manifest**：Fact Pack 中的索引，指向所有原始证据文件。

## 来源优先级

1. Linear live data：项目管理事实主源。
2. GitHub remote：远端代码、PR、README 和默认分支事实。
3. Local repo：当前工作副本事实，只能代表本机状态。
4. Local docs：项目文档事实。
5. Web search：外部最新资料，必须保留来源。
6. User input：当前对话中的确认决策。

## 单 Project 规则

Fact Pack 默认服务一个 Project。若用户请求全局视图，先返回 Project 候选摘要，再选择一个 Project 进入完整事实采集。

When a single-Project task has no explicit target, the first clarification step is `pi_ask_user(flow=project_select)`. Candidate options come from the merged local three-source repo-map only (`config/repo-map.yaml`/`REPO_MAP_PATH` plus `REPO_MAP_LOCAL_PATH`); Linear project context is read after the user selects a project ID or enters a custom value. Machine-local overlay entries override tracked entries with the same repoKey.

## 冲突规则

- Linear vs GitHub：项目管理状态以 Linear 为准，工程主线以 GitHub 默认分支为准。
- GitHub vs local：local dirty 只作为 working-copy conflict，不覆盖远端事实。
- Web vs repo：web 不能替代当前 repo 实现事实。
- User input vs tool evidence：用户新决策必须标成决策或待确认项，不覆盖已读取事实。

## 输出要求

- 不内联大 JSON。
- 每条事实有简短 summary。
- 原始证据通过 `evidenceRef` 查找。
- 缺失事实写入 `evidenceGaps`。
- 对规划有影响的结论写入 `planningImplications`。
