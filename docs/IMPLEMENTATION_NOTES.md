# 实现说明

## Pi extension

本项目使用 Pi `pi.registerTool()` 暴露专用工具。工具主体尽量转发给 `scripts/*.mjs`，这样方便测试和在 webhook bridge 中复用。

### Project selection and repo-map user clarification

`.pi/extensions/pi-ask-user.ts` registers `pi_ask_user` for clarification and write-approval flows:

- `project_select`: first step for single-Project planning/reporting/review when the user did not specify a target. Options are loaded only from the merged local three-source repo-map (`config/repo-map.yaml`/`REPO_MAP_PATH` plus `REPO_MAP_LOCAL_PATH`): every entry with a local project directory is listed by repoKey/project ID, followed by `User input`. Local overlay entries override tracked config entries with the same repoKey. Linear is not queried until after this selection.
- `repo_map`: stepwise repo-map repair/draft flow.
- `write_confirmation`: one-time approve/cancel UI for an exact dry-run Linear write plan. It only collects approval and never executes Linear mutations.

For `repo_map`:

- It anchors the flow on Linear Project ID first. If the seed does not include `linearProjectId` or `linearProject`, it asks for the target Linear Project before any GitHub or local repo field.
- After the Linear Project is resolved, every GitHub URL, local path, repoKey, and defaultBranch prompt includes the target Project name and ID.
- It validates GitHub URL shape, local path existence, repoKey/defaultBranch shape, and Linear Project resolvability through `scripts/linear-cli.mjs project`.
- It returns a review-only repo-map draft and YAML preview. The draft stores `linear.projectId` as the primary anchor; Project name and prefix are display/matching helpers. It never writes repo-map files by itself.
- If the user cancels, it returns `cancelled` with open questions and `writesPerformed=false`.
- If the user cancels or Pi UI is unavailable, it returns the target Project context in `openQuestions` / `evidenceGaps` so the flow can be resumed safely.

### Repo-map drift detection and apply

`scripts/repo-map-drift.mjs` is the repo-map governance CLI:

- `check` compares the merged repo-map with source facts from Git remote/local path and explicit Linear/GitHub CLI flags.
- Drift or missing data produces `state/repo-map.draft.yaml`, a JSON/YAML-compatible report, a diff preview, and `writesPerformed=false`.
- Missing facts that cannot be derived from source evidence return `piAskUser: { flow: "repo_map", seed }`, preserving the Linear Project ID/name context for the stepwise clarification UI.
- `apply` refuses to write unless `--confirmed` is present. Confirmed apply writes the local overlay by default, validates the merged map through `scripts/repo-map.mjs`, appends `state/repo-map-audit.jsonl`, and returns rollback advice.
- Use `--write-tracked` only for intentional repo-map config changes that will be committed and reviewed.
- The draft is the only bridge between check and apply; `config/repo-map.yaml` and the local overlay are never changed during check.

## Linear apply

Dry-run compilation and real apply use separate protocol gates:

- `linear_apply_write_plan` with `dryRun=true` is read/compile-only and does not require `ask_user`.
- Real apply requires `LINEAR_WRITE_MODE=confirmed-only`, `ALLOW_LINEAR_WRITES=true`, and `confirmedByUser=true`.
- Dry-run output includes `confirmationChannel`, which is one of `ask_user approve/cancel`, `current conversation explicit approval fallback`, or `interactive confirmation unavailable; real write not applied`.
- Real apply must consume exactly one `pi_ask_user(flow=write_confirmation)` approval artifact before calling the CLI mutation path; any stale conversation fallback text is ignored for that apply.
- `project_select` and `repo_map` remain clarification-only flows and must not be reused for Linear write confirmation.
- If generic `ask_user` is unavailable, current-conversation text fallback is blocked by default. It can be used only after the user explicitly allows text fallback; tool calls must pass `allowConversationFallback=true`, `confirmationChannel=conversation_fallback`, and the exact approval in `confirmationText`.
- Conversation fallback confirmation records must include fallback reason, user approval text, write plan path, and `idempotencyKey`; final apply output and `state/audit.jsonl` include the same confirmation payload.
- `scripts/write-plan-execution.mjs` computes the effective apply mode. If the source write-plan file is still `dryRun=true` but the tool/CLI call is `dryRun=false` with `--confirmed`, the CLI uses an in-memory effective plan with `dryRun=false` / `confirmedByUser=true` and records `reason.cliConfirmedOverride=true`.
- This avoids silent dry-run when the user already approved real apply, while preserving explicit dry-run when `--dry-run` or `LINEAR_WRITE_MODE=dry-run` is present.

`linear-cli.mjs apply` 已实现真实写入，但默认仍由 dry-run 和确认门禁保护。

已支持的 operation type：

- `project.create` / `project.update`
- `projectMilestone.create`（别名：`milestone.create`, `project.milestone.create`）
- `issue.create` / `issue.update`
- `issueRelation.create`（别名：`issue.relation.create`）
- `projectRelation.create`（别名：`project.relation.create`）
- `projectUpdate.create`（别名：`project.update.create`）
- `comment.create`

写入条件：

- `LINEAR_WRITE_MODE=confirmed-only`
- `ALLOW_LINEAR_WRITES=true`
- write plan 中 `dryRun=false`
- write plan 中 `confirmedByUser=true`
- CLI 传入 `--confirmed`

确认来源：

- Pi 交互模式只使用一次 `pi_ask_user(flow=write_confirmation)` 作为用户确认。
- 不再要求用户手动输入固定确认句。
- `linear-write-guard` 只校验 `confirmedByUser=true`，不会再发起第二次 UI confirm；如果缺少确认，会阻止调用并提示先使用 `pi_ask_user(flow=write_confirmation)`。
- If `pi_ask_user write_confirmation` is unavailable and text fallback was not explicitly allowed, real apply returns `interactive confirmation unavailable; real write not applied`.

### Pi write confirmation flow

1. Call `linear_apply_write_plan` with `dryRun=true` and capture `writePlanPath`, `idempotencyKey`, and dry-run summaries.
2. Call `pi_ask_user` with `flow=write_confirmation`, the exact `writePlanPath`, `idempotencyKey`, target project summary, operations summary, and optional risk/non-change/planDigest fields.
3. If the user approves, pass the returned `confirmationChannel`, `confirmationText`, `confirmationId`, `writePlanPath`, and `idempotencyKey` into `linear_apply_write_plan(dryRun=false)`.
4. If the user cancels or Pi UI is unavailable, do not apply. Conversation fallback remains blocked unless the user explicitly allows it.

Each approval artifact binds to one exact write plan and idempotencyKey and can be consumed only once by real apply.

安全机制：

- create operation 会基于 `idempotencyKey + operation key` 生成稳定 UUID。
- 重复执行同一个 write plan 会先 readback 已存在对象并跳过创建，避免重复写入。
- operation 可以用 `key` 定义引用名，并用 `projectRef`、`projectMilestoneRef`、`issueRef`、`relatedIssueRef`、`projectUpdateRef` 等字段引用前序结果。
- label 名称会解析为 Linear `labelIds`；teamKey 会解析为 `teamId` / `teamIds`。
- 每个 mutation 后都会 readback；审计日志写入 `AUDIT_LOG_PATH`。

## Project description field limit

Linear `Project.description` has a 255-character limit. `scripts/project-field-normalizer.mjs` is the shared preflight rule for `project.create` and `project.update`:

- `scripts/plan-reviewer.mjs` emits `write_plan_project_description_too_long` as a non-blocking warning before write-plan execution.
- `scripts/linear-cli.mjs apply --dry-run` compiles the final mutation input with `description` reduced to a short summary and the full original text preserved in `content`.
- The dry-run output includes `fieldTransforms` so the user can see that `description` was downgraded into `content`.
- The same normalization is used for confirmed apply; no long text is silently discarded.

## Write plan review

`scripts/plan-reviewer.mjs` 支持两类合法写入计划：

- 新建/调整结构：包含 `project.create` / `project.update`、`projectMilestone.create` 和 Issue mutation。
- 扩展已有结构：包含 `targetProjectId`、`targetMilestoneId`、`targetMilestoneReadback`，并把 `issue.create` 的 `projectId` / `projectMilestoneId` 指向已回读验证的对象。

新增单个 Issue 挂到已有 Milestone 时，不应为了通过 reviewer 人为创建新 Milestone。Reviewer 只要求已有 Milestone 先被 Linear 回读确认存在，并且 readback 的 `projectId` 与 `targetProjectId` 一致。

Project governance templates live in `scripts/project-governance-template.mjs`:

- `freeze` emits a dry-run write plan with a `projectUpdate.create` operation and optional Ready/In Progress issue state updates to Backlog.
- `unfreeze` refuses to generate a plan until fresh Project evidence is read and `--recovery-entry` is provided.
- `scripts/linear-project-status-resolver.mjs` resolves Project status candidates from cached `projectStatuses` manifest data. Paused/started status writes are only emitted when a unique resolver result exists and the operator explicitly opts in.
- The templates do not update repo mapping, completed issues, milestones, target date, or unresolved Project status IDs.
- `scripts/plan-reviewer.mjs` accepts Project Update-only governance plans when they include `targetProjectId` and dependency rationale.

## MCP

`config/mcp.servers.json` 提供 GitHub MCP Server 配置。由于不同 MCP host 的配置语法可能不同，本项目保留 REST fallback，确保 GitHub 事实来源可用。

## Web search

支持 Tavily 和 Brave 两种 provider。默认 Tavily，因为返回内容更适合 Fact Pack；Brave 可作为隐私和独立索引优先的替代。
## Project-Scoped Runtime

Active planning and reporting paths process one Project at a time. Workspace-level commands may list candidates, but they must not load every Project's detailed context into the prompt.

## Pi Write Confirmation UI

The generic Linear write confirmation channel is `pi_ask_user(flow=write_confirmation)`. After dry-run, the Agent calls this flow to show one approve/cancel dialog with the exact write plan path, idempotencyKey, target project summary, and operation/risk summaries. `linear_apply_write_plan(dryRun=false)` consumes that approval artifact and does not show a second confirmation UI. Current-conversation text fallback is used only when Pi UI is unavailable and the user explicitly allowed that fallback.
