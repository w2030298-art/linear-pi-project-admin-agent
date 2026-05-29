# 事实来源层设计

## 1. 为什么需要事实来源层

项目规划 Agent 容易产生两个风险：

1. 用模型记忆替代当前项目状态。
2. 用用户的高层想法直接生成任务，而没有读取 repo、文档、Linear 状态和最新外部资料。

本项目用 Fact Pack 解决该问题。

## 2. Fact Pack 生命周期

```text
user request / Linear trigger
  → identify scope
  → collect Linear facts
  → collect GitHub facts
  → collect local repo/docs facts
  → optional web research
  → normalize facts
  → detect conflicts
  → produce planning implications
  → planner + reviewer
```

## 3. 来源说明

### Repo map routing

`fact_pack_build --repo <repoKey>` and `node scripts/fact-pack.mjs --repo <repoKey>` resolve `config/repo-map.yaml` before environment fallbacks. A repoKey match supplies one three-way mapping:

- `repoKey`
- `github.owner`, `github.repo`, `github.defaultBranch`
- `linear.projectId`, `linear.projectName`, or `linear.projectPrefix`
- `localPath`
- `docs`
- `evidenceWeight`

The schema is versioned in `schemas/repo-map.schema.json`, and runtime validation is implemented by `scripts/repo-map.mjs`.

Fact priority is:

1. `config/repo-map.yaml` when `--repo <repoKey>` is provided.
2. Env fallback (`GITHUB_DEFAULT_OWNER`, `GITHUB_DEFAULT_REPO`, `GITHUB_DEFAULT_BRANCH`, `LOCAL_REPO_ROOTS`) only when no repoKey is provided.
3. Explicit evidence gaps when the repoKey is missing or incomplete.

If repo-map facts conflict with env fallback values, repo-map wins and Fact Pack writes the mismatch to `conflicts`. If a repoKey is missing or incomplete, the Fact Pack records an `evidenceGaps` entry and does not silently fall back to env values for another repository.

When repo-map facts are missing or drifted, use `pi_ask_user` with `flow=repo_map` in Pi interactive mode. It asks for GitHub URL, Linear Project, local repo path, repoKey, and defaultBranch one field at a time, then returns a review-only draft. Non-UI runs must keep the gap explicit and avoid fabricating user input.

### Linear live data

用于确认项目状态、任务状态、labels、workflow states、Cycles、Project Updates。Linear 是项目管理事实的主源。

按 Issue identifier 或 UUID 精确查询时使用 `linear_get_issue` / `node scripts/linear-cli.mjs issue <identifierOrId>`；`linear_search_issues` 保留全文 contains 搜索语义，不用于判定某个 `WEN-123` 是否存在或当前状态。

Portfolio review 不直接依赖单个 `linear_get_project_context` 的大输出；它使用 `state/portfolio-review/build-portfolio-snapshot.mjs` 生成结构化快照，先读取 projects、cycles、workflow state 元信息，再按项目读取 issue 基本字段，并只对非终态 Issue 单独读取 relations / inverseRelations，避免超过 Linear GraphQL complexity 限制。relation 方向按以下规则解释：

- `relations(type=blocks)`：当前 Issue blocks `relatedIssue`。
- `inverseRelations(type=blocks)`：其他 Issue blocks 当前 Issue，即当前 Issue blocked by 其他 Issue。

Duplicate / canceled / completed 都视为终态，不要求补 label 或 Milestone。Cycle 统计必须同时看 `issueCount`、`openCount`、`highOpenCount`、`blockedCount`，不能只看总数。

### GitHub MCP / REST

用于确认远端工程事实：repo 结构、README、PR、Actions、release、commits。优先 MCP，fallback REST。

### Local repo

用于确认本地工作副本事实：branch、commit、dirty、未提交变更、本地 docs。必须标注 dirty 状态。

### Local docs

用于确认 PRD、ADR、研究资料、会议记录、设计文档。必须记录路径和 mtime。

`local_docs_search` 对复合查询执行 tokenized OR matching，并返回 `tokens`、`score`、`matchedTokens`。例如 `Fact Pack write guard dry-run operations` 会按多个关键词召回相关文档，而不是要求整句连续命中。

### Web search

用于确认外部事实：官方文档、依赖库变化、最新 API、标准、竞品。必须记录 URL 和 provider。

CLI `--official` 会优先推断官方域并过滤结果；Linear 查询默认限制到 `linear.app`。如需覆盖官方域，设置 `WEB_OFFICIAL_DOMAINS` 或传入 `--domain`。

## 4. 冲突规则

- Linear vs GitHub：Linear 决定项目状态，GitHub 决定代码状态。
- GitHub vs local：GitHub default branch 决定远端主线，本地 dirty 只代表当前工作副本。
- Linear vs local dirty：portfolio review 和 Cycle 推荐以 Linear live data 为准；local dirty 只记录为工程事实 conflict，不覆盖 Linear 项目状态。
- Web vs repo：web 只能提供外部背景，不覆盖 repo 实现。
- User vs tool：用户可以决策，但不能改变工具读取到的历史事实。
