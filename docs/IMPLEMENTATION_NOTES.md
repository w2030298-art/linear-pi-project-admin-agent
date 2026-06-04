# 实现说明

## Pi extension

本项目使用 Pi `pi.registerTool()` 暴露专用工具。工具主体尽量转发给 `scripts/*.mjs`，这样方便测试和在 webhook bridge 中复用。

### Project selection and repo-map user clarification

`.pi/extensions/pi-ask-user.ts` registers `pi_ask_user` for clarification and write-approval flows:

- `project_select`: first step for single-Project planning/reporting/review when the user did not specify a target. Options are loaded only from the merged local three-source repo-map (`config/repo-map.yaml`/`REPO_MAP_PATH` plus `REPO_MAP_LOCAL_PATH`): every entry with a local project directory is listed by repoKey/project ID, followed by `User input`. Local overlay entries override tracked config entries with the same repoKey. Linear is not queried until after this selection.
- `repo_map`: stepwise repo-map repair/draft flow.
- `plan_confirmation`: planning-time `Yes` / `No` / `调整意见` UI for an exact Linear write plan. The UI renders a structured Chinese review surface (项目概览 / 计划结构树 / 风险 / 非变更 / 证据 / 审批绑定) from the write plan file plus summaries. `Yes` creates a signed approval artifact bound to `writePlanPath` and `idempotencyKey` only; `No` cancels without mutation; `调整意见` returns feedback so the Agent can rewrite the plan and ask again.
- `write_confirmation`: legacy one-time approve/cancel UI for an exact dry-run Linear write plan. It only collects approval and never executes Linear mutations.

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

Normal Linear writes use one orchestration tool: `linear_validate_and_apply_write_plan`.

- The tool is called once after write plan generation.
- It runs deterministic final validation, compiles MCP arguments, freezes the workspace manifest/resolutions into the same write plan, and records final-validation audit evidence.
- It then shows one `pi_ask_user(flow=plan_confirmation)` UI for the exact `writePlanPath`, `idempotencyKey`, and operation summaries.
- On `Yes`, the same tool immediately applies via MCP, reusing the frozen validation snapshot, then performs readback diff and audit.
- On `No`, `revision_requested`, or unavailable UI, it stops without mutation unless the user explicitly allows conversation fallback.
- `linear_validate_write_plan` and `linear_apply_write_plan` remain compatibility/diagnostic surfaces. Normal agent writes must not manually chain them.
- `project_select` and `repo_map` remain clarification-only flows and must not be reused for Linear write confirmation.
- `scripts/write-plan-execution.mjs` still computes compatibility apply mode. If the source write-plan file is `dryRun=true` but the compatibility CLI call is `dryRun=false` with `--confirmed`, the CLI uses an in-memory effective plan with `dryRun=false` / `confirmedByUser=true` and records `reason.cliConfirmedOverride=true`.

### Low-risk write wrapper

`scripts/write-plan-builder.mjs` (low-risk `kind` adapter) and the Pi tool `linear_prepare_low_risk_write` provide a narrow wrapper for L1/L2 writes. The whitelist is intentionally small:

- `project_update`: one `projectUpdate.create`.
- `issue_create`: one `issue.create` with existing Project Milestone readback.

The wrapper accepts current session facts or a compact Project baseline, then generates a normal write plan with `idempotencyKey`, `readbackRequired=true`, `auditLogRequired=true`, `dryRun=true`, `confirmedByUser=false`, and a final validation summary. It returns one next tool call: `linear_validate_and_apply_write_plan`. These are orchestration hints, not permissions; final validation, approval, readback, and audit gates remain mandatory inside the single tool.

When required evidence is missing, the wrapper returns `status=evidence_gap` with open questions. It does not infer target Project, milestone, team, labels, or acceptance criteria. Requests outside the whitelist must use the full Fact Pack and planning path.

`linear-cli.mjs apply` supports real writes, but normal Pi runtime writes should reach it through `linear_validate_and_apply_write_plan`.

Supported operation types:

- `project.create` / `project.update`
- `projectMilestone.create` (aliases: `milestone.create`, `project.milestone.create`)
- `issue.create` / `issue.update`
- `issueRelation.create` (alias: `issue.relation.create`)
- `projectRelation.create` (alias: `project.relation.create`)
- `projectUpdate.create` (alias: `project.update.create`)
- `comment.create`

Write conditions:

- `LINEAR_WRITE_MODE=confirmed-only`
- `ALLOW_LINEAR_WRITES=true`
- write plan has `dryRun=false` at apply time
- approved `plan_confirmation` from the same `linear_validate_and_apply_write_plan` call

### Pi write confirmation flow

Responsibilities are consolidated into one runtime tool:

1. **`linear_validate_and_apply_write_plan`** validates and freezes the write plan.
2. **`pi_ask_user(flow=plan_confirmation)`** is invoked internally and shows `Yes` / `No` / `调整意见` for the exact plan.
3. **Approved apply** runs immediately inside the same tool and never pops a second confirmation UI.
4. **`linear-write-guard`** remains a compatibility guard for direct legacy apply calls.

Approval authority is `writePlanPath` + `idempotencyKey` only. The single tool passes `confirmationChannel`, `confirmationText`, and `confirmationId` to the apply path internally. Successful real apply records audit/readback output and marks the operation complete.

Final validation freezes Linear object resolver inputs. `linear_validate_and_apply_write_plan` persists the current workspace manifest snapshot, writes `manifestHash`, `manifestPath`, `manifestCompleteness`, and object `resolutions` into the write plan without recomputing any plan hash, and records `linear_write_plan_final_validation` in audit. Apply reuses that frozen snapshot. After mutations, apply compares planned vs actual state via readback diff and surfaces drift in audit output.

Conversation fallback remains blocked unless Pi UI is unavailable and the user explicitly allows it. If UI approval is available, do not downgrade to `conversation_fallback`; call `linear_validate_and_apply_write_plan` again after revising the plan.

### Resolved structural issue: write confirmation binding (WEN-308/WEN-317)

The write protocol promises one final plan confirmation per write intent. Approval authority is `writePlanPath` + `idempotencyKey` only; no pre-apply plan hash chain participates in approval binding.

1. **Builder** (`write-plan-builder.mjs`) generates the write plan file and returns one workflow placeholder for `linear_validate_and_apply_write_plan`.
2. **Final validation** (`freezePlanFinalValidation`) mutates the same write plan file, adds manifest/resolution/finalValidation fields, and persists the workspace manifest snapshot without recomputing any plan hash.
3. **Plan confirmation** is shown inside `linear_validate_and_apply_write_plan` for the exact `writePlanPath` and `idempotencyKey`.
4. **Apply** consumes that approval immediately, uses the frozen final-validation snapshot, executes mutations via Linear MCP, then compares planned vs actual state via readback diff in audit output.

WEN-317 removes the historical digest chain entirely; integrity after mutation is enforced by readback diff and manifest/resolution drift checks, not pre-apply hash comparison. Regression coverage lives in `scripts/test-readback-diff.mjs`, `scripts/test-linear-apply-reliability.ts`, and `scripts/test-write-backend-wen319.mjs`.

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

## Runtime Repo Diagnostics

`scripts/fact-pack.mjs` records a `runtime` diagnostic block for repo-scoped Fact Packs. It includes the Agent runtime `cwd`, package root, extension source path, runtime git remote, selected repo-map localPath, repo-map git remote, GitHub/Linear mapping, `LOCAL_REPO_ROOTS`, effective local evidence root, path relation fields, and drift advice.

The selected repo-map entry remains the source of truth for local evidence. A complete repo-map entry overrides `LOCAL_REPO_ROOTS`; environment roots are reported only so operators can see when stale fallback settings disagree with repo-map. If repo-map localPath differs from runtime cwd, the diagnostic distinguishes the paths instead of assuming one is wrong. This supports the intended wrapper pattern where Pi runs from `linear-pi-project-admin-agent-runtime` while repo-map points at the implementation repo, as long as the mapped GitHub repo and Linear Project still match the selected repoKey.

Write confirmation approval artifacts also include source metadata for the artifact module path, package root, and runtime cwd. This lets apply failures be correlated with the actual extension/source path that produced the approval.

## Pi Write Confirmation UI

The default Linear write confirmation path is `linear_validate_and_apply_write_plan`: after plan generation, the Agent calls this tool once; it runs final validation, invokes `pi_ask_user(flow=plan_confirmation)`, applies immediately only after approval, and never shows a second confirmation UI. `linear-write-guard` only gates legacy direct apply against a valid approval. Current-conversation text fallback is used only when Pi UI is unavailable and the user explicitly allowed that fallback.
