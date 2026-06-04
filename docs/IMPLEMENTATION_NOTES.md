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

Dry-run compilation and real apply use separate protocol gates:

- `linear_apply_write_plan` with `dryRun=true` is read/compile-only, runs automatically after plan review, and is not user confirmation.
- Real apply requires `LINEAR_WRITE_MODE=confirmed-only`, `ALLOW_LINEAR_WRITES=true`, one valid `ApprovalArtifact`, and `confirmedByUser=true`.
- Dry-run output includes `confirmationChannel`, which is one of `ask_user`, `current conversation explicit approval fallback`, or `interactive confirmation unavailable; real write not applied`.
- Dry-run also includes `confirmationSelfCheck`. This is diagnostic only: it reports the detected confirmation channel, whether `pi_ask_user(flow=plan_confirmation)` appears available, whether conversation fallback is enabled, and the next required action. Dry-run must not force `confirmationChannel=ask_user` just because apply will later need approval; it has not yet proven that the approval artifact can be created, persisted, and consumed.
- Real apply must consume exactly one `pi_ask_user(flow=plan_confirmation)` approval artifact before calling the CLI mutation path; legacy `write_confirmation` artifacts remain accepted for older flows. Any stale conversation fallback text is ignored for that apply.
- `project_select` and `repo_map` remain clarification-only flows and must not be reused for Linear write confirmation.
- If generic `ask_user` is unavailable, current-conversation text fallback is blocked by default. It can be used only after the user explicitly allows text fallback; tool calls must pass `allowConversationFallback=true`, `confirmationChannel=conversation_fallback`, and the exact approval in `confirmationText`.
- Conversation fallback confirmation records must include fallback reason, user approval text, write plan path, and `idempotencyKey`; final apply output and `state/audit.jsonl` include the same confirmation payload.
- Conversation fallback confirmation text is normalized before audit. If the caller passes an already-formatted fallback record, the apply path extracts the user approval text and rebuilds one clean record instead of nesting `Fallback reason`, `User approval`, `Write plan`, or `Idempotency key` lines.
- `scripts/write-plan-execution.mjs` computes the effective apply mode. If the source write-plan file is still `dryRun=true` but the tool/CLI call is `dryRun=false` with `--confirmed`, the CLI uses an in-memory effective plan with `dryRun=false` / `confirmedByUser=true` and records `reason.cliConfirmedOverride=true`.
- This avoids silent dry-run when the user already approved real apply, while preserving explicit dry-run when `--dry-run` or `LINEAR_WRITE_MODE=dry-run` is present.

### Low-risk write wrapper

`scripts/write-plan-builder.mjs` (low-risk `kind` adapter) and the Pi tool `linear_prepare_low_risk_write` provide a narrow wrapper for L1/L2 writes. The whitelist is intentionally small:

- `project_update`: one `projectUpdate.create`.
- `issue_create`: one `issue.create` with existing Project Milestone readback.

The wrapper accepts current session facts or a compact Project baseline, then generates a normal write plan with `idempotencyKey`, `readbackRequired=true`, `auditLogRequired=true`, `dryRun=true`, `confirmedByUser=false`, and a dry-run summary. It also returns the exact next tool calls for quality review, dry-run, `pi_ask_user(plan_confirmation)`, and real apply. These are orchestration hints, not permissions; the existing reviewer, dry-run, approval artifact, readback, and audit gates remain mandatory.

When required evidence is missing, the wrapper returns `status=evidence_gap` with open questions. It does not infer target Project, milestone, team, labels, or acceptance criteria. Requests outside the whitelist must use the full Fact Pack and planning path.

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

- Pi 交互模式只使用一次 `pi_ask_user(flow=plan_confirmation)` 作为用户确认；真实 apply 不再弹第二个确认 UI。
- 不再要求用户手动输入固定确认句。
- `linear-write-guard` only gates dry-run vs valid approval artifact; it never pops UI or generates conversation fallback.
- If `pi_ask_user write_confirmation` is unavailable and text fallback was not explicitly allowed, real apply returns `interactive confirmation unavailable; real write not applied`.

### Pi write confirmation flow

Responsibilities are split across four layers:

1. **Dry-run** — Agent automatically runs `linear_plan_quality_review` and `linear_apply_write_plan(dryRun=true)`. No user confirmation.
2. **`pi_ask_user(flow=plan_confirmation)`** — Shows `Yes` / `No` / `调整意见` and returns an `ApprovalArtifact` bound to `writePlanPath` and `idempotencyKey` only on `Yes`. `No` cancels; `调整意见` returns feedback for plan rewrite. Does not execute Linear mutations.
3. **`linear_apply_write_plan(dryRun=false)`** — Consumes the planning artifact once, then runs real apply with readback/audit. Never pops a second confirmation UI.
4. **`linear-write-guard`** — Allows dry-run; blocks real apply when the artifact is missing, expired, reused, or mismatched.

`ApprovalArtifact` fields: `approved`, `confirmationChannel`, `approvalKind`, `writePlanPath`, `idempotencyKey`, `confirmationText`, `confirmationId`, `createdAt`, `expiresAt`, optional `usedAt`.

Default artifact TTL is 30 minutes. Artifacts are stored in a shared persistent store, not only an in-memory module Map. The default store is `%LOCALAPPDATA%\LinearProjectAdminPi\write-confirmation-artifacts.json` on Windows, `~/.linear-project-admin-pi/write-confirmation-artifacts.json` otherwise, and can be overridden with `WRITE_CONFIRMATION_ARTIFACT_STORE_PATH` for tests or host-managed session storage. This store is the boundary that lets `pi_ask_user` approval survive separate tool calls, extension reloads, different module graphs, and source/runtime checkout path differences.

`pi_ask_user(plan_confirmation)` returns both the approval artifact and diagnostic metadata: `artifactStorage` describes the local store path/read/write/persisted state, and `artifactBinding` echoes the exact `writePlanPath`, `idempotencyKey`, and `confirmationId` that real apply must pass back unchanged.

Validation distinguishes missing or stale artifacts, unreadable stores, expired artifacts, reused artifacts, `confirmationId` mismatch, `writePlanPath` or `idempotencyKey` mismatch or omission, and `confirmationText` mismatch. Blocked apply messages include the machine-readable reason and the next step. Successful real apply marks the artifact with `usedAt` and persists that consumed state before the Linear mutation path records audit/readback output. The CLI receives `confirmationChannel`, `confirmationText`, and `confirmationId`, and artifact validation audit records include `approvalKind`, so `state/audit.jsonl` distinguishes planning approval from write-time apply consume.

Dry-run also freezes Linear object resolver inputs. `linear_apply_write_plan(dryRun=true)` persists the current workspace manifest snapshot, writes `manifestHash`, `manifestPath`, `manifestCompleteness`, and object `resolutions` into the write plan without recomputing any plan hash, and records `linear_apply_manifest_compile` in audit. Real apply recomputes the current manifest and resolution snapshot before consuming the approval artifact; `manifestHash` mismatch, resolution drift, or incomplete manifests block mutation and record `linear_apply_manifest_validation` with `resolutionDiff`. After mutations, apply compares planned vs actual state via readback diff and surfaces drift in audit output.

Conversation fallback remains blocked unless Pi UI is unavailable and the user explicitly allows it. If UI approval is available, do not downgrade to `conversation_fallback`; re-run `pi_ask_user(flow=plan_confirmation)` when the artifact is missing, expired, consumed, mismatched, or stored under the wrong runtime path.

### Resolved structural issue: write confirmation binding (WEN-308/WEN-317)

The write protocol promises one final plan confirmation per write intent. Approval authority is **`writePlanPath` + `idempotencyKey` only** — no pre-apply plan hash chain participates in artifact binding.

1. **Builder** (`write-plan-builder.mjs`) generates the write plan file and returns workflow placeholders that instruct the Agent to dry-run, confirm, then apply.
2. **Dry-run** (`freezePlanManifest`) mutates the same write plan file, adds manifest/resolution fields, and persists the workspace manifest snapshot **without recomputing any plan hash**.
3. **Plan confirmation** binds `pi_ask_user(flow=plan_confirmation)` to the exact `writePlanPath` and `idempotencyKey` shown after dry-run.
4. **Apply** consumes the approval artifact once, validates manifest/resolution drift against the frozen dry-run snapshot, executes mutations via Linear MCP, then compares planned vs actual state via **readback diff** in audit output.

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

The selected repo-map entry remains the source of truth for local evidence. A complete repo-map entry overrides `LOCAL_REPO_ROOTS`; environment roots are reported only so operators can see when stale fallback settings disagree with repo-map. If repo-map localPath differs from runtime cwd, the diagnostic distinguishes the paths instead of assuming one is wrong. This supports the intended wrapper pattern where Pi runs from `linear-pi-project-admin-agent-runtime` while repo-map points at the implementation checkout, as long as the mapped GitHub repo and Linear Project still match the selected repoKey.

Write confirmation approval artifacts also include source metadata for the artifact module path, package root, and runtime cwd. This lets apply failures be correlated with the actual extension/source path that produced the approval.

## Pi Write Confirmation UI

The default Linear write confirmation channel is `pi_ask_user(flow=plan_confirmation)` with `Yes` / `No` / `调整意见`. After plan generation, quality review, and dry-run, the Agent calls this flow once; `linear_apply_write_plan(dryRun=false)` consumes the returned approval artifact and never shows a second confirmation UI. `linear-write-guard` only gates real apply against a valid artifact. Current-conversation text fallback is used only when Pi UI is unavailable and the user explicitly allowed that fallback.
