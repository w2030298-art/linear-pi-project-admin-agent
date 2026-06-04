# 运维手册

## 日常命令

```bash
npm run validate
npm test
npm run test:plan-review
npm run test:project-description-fields
npm run test:repo-map
npm run test:repo-map-drift
npm run test:pi-ask-user
npm run test:wezterm-launch
npm run test:linear-apply-mode
npm run test:linear-apply-reliability
npm run test:readback-diff
npm run test:write-backend-wen320
npm run test:plan-confirmation-ui
npm run test:retrieval-ux
npm run test:pipeline-refactor-goals
npm run linear:workspace
npm run fact:pack -- --task "project review" --linear "<project-id-or-key>"
npm run bridge:dev
```

## Merge Gate

Before merging runtime or Linear write-agent changes, run:

```bash
npm run validate
npm test
```

`npm run validate` runs the configuration security gate. It blocks wildcard model allowlists, `latest` dependency specs, missing test umbrella scripts, and too-small compaction buffers. User-level Pi settings overrides must not expand this repo's trusted model/provider set; use a reviewed PR when the trust boundary needs to change.

## 日常流程

1. `/workspace-sync`：检查 workspace manifest 和 repo-map drift。
2. `/portfolio-review`：先选一个 Project，再审查该 Project。
3. `/project-report`：输出一个 Project 的状态、风险和下一步。
4. 检查 `state/audit.jsonl` 和 `state/linear-events.jsonl`。
5. 清理或归档已处理的 `state/pi-queue/*.md`、`*.log`。

## 状态更新模板

用于 Linear Project Update 或周报草案：

```markdown
## 本周状态

健康状态：onTrack | atRisk | offTrack

### 已完成
- [事实] 本周完成的 issue / 验收命令 / 文档或代码变更。

### 风险
- [风险] 影响目标日期、写入安全、token 权限、bridge 稳定性的事项。

### 下周计划
- [决策] 下一个最小可执行 Issue 或验证节点。
- [待确认项] 需要人类确认的范围、权限或上线动作。

### 验收证据
- `npm run validate`
- `npm run linear:workspace`
- `npm run fact:pack -- --task "project review" --linear "<project-id-or-key>"`
```

## Linear Write Blocked

- Check `ALLOW_LINEAR_WRITES`.
- Check that the write plan contains `idempotencyKey`.
- For normal writes, retry through `linear_validate_and_apply_write_plan`; it will perform final validation, show `plan_confirmation`, and apply only after approval.
- Do not ask for a fixed confirmation phrase or trigger a second confirmation.

## Linear Final Validation / Apply Protocol

- Normal writes use `linear_validate_and_apply_write_plan` once after the write plan is ready.
- The tool runs deterministic write-plan review, compiles MCP arguments, writes `manifestHash`, `manifestPath`, `manifestCompleteness`, and object `resolutions` into the write plan, persists the exact workspace manifest snapshot beside the plan, and does **not** recompute any plan hash.
- After approval, apply reuses the frozen final-validation manifest snapshot instead of running a second live manifest validation pass. Legacy dry-run plans without `finalValidation` still use the old live manifest drift check.
- Workspace manifest reads must use cursor pagination and record `completeness` / `truncated`; incomplete manifests are not valid for real apply.
- Real writes still require `LINEAR_WRITE_MODE=confirmed-only`, `ALLOW_LINEAR_WRITES=true`, and approval from `plan_confirmation`.
- In interactive Pi runs, `linear_validate_and_apply_write_plan` invokes `pi_ask_user(flow=plan_confirmation)` internally as the single final approve/cancel channel before real Linear writes.
- If `ctx.hasUI` is false, real writes are blocked with `interactive confirmation unavailable; real write not applied` unless the user explicitly allows current-conversation text fallback and the call passes `allowConversationFallback=true`.

## Project Freeze / Unfreeze Templates

- List auditable Linear Project status candidates with `node scripts/linear-cli.mjs project-statuses`. The same data is cached in `state/workspace-object-manifest.json` during dry-run apply.
- Generate a freeze dry-run plan with `npm run project:freeze -- --project-url "<linear-project-url>"`.
- Add `--move-active-issues-to-backlog` only when Ready/In Progress issues should be moved to the workspace Backlog state. Completed, canceled, and duplicate issues are never changed.
- The freeze Project Update must document scope, recovery conditions, risks, and non-changes. The template does not change repo mappings, create milestones, alter target date, or forge a paused Project status ID. If exactly one paused-like Project status is available, the dry-run explains the evidence chain; otherwise it degrades to Project Update only.
- Generate unfreeze only after a fresh Project read and an explicit recovery entry: `npm run project:unfreeze -- --project-url "<linear-project-url>" --recovery-entry "resume-ready"`.
- Without `--recovery-entry`, unfreeze returns a blocking `unfreeze_recovery_entry_required` result instead of a write plan. Project status writes require `--include-project-status-update --confirm-status-update`; absent or ambiguous resolver results never synthesize a `statusId`.

## Linear Write Confirmation

Single planning confirmation flow:

1. After generating a write plan, call `linear_validate_and_apply_write_plan` once.
2. The tool runs final validation, then shows one planning UI: `pi_ask_user(flow=plan_confirmation)` with structured Chinese sections and `Yes` / `No` / `调整意见` for the exact `writePlanPath`, `idempotencyKey`, and operation summaries.
3. On `Yes`, the same tool immediately applies the write plan. On `No`, it stops without mutation. On adjustment, rewrite the plan and call `linear_validate_and_apply_write_plan` again.
4. `linear-write-guard` remains a compatibility apply guard when legacy apply is called directly.

- Final validation output includes `confirmationSelfCheck`. Treat it as diagnostics, not approval. Normal writes continue by calling `linear_validate_and_apply_write_plan`, not by manually chaining legacy tools.
- Approval output includes `writePlanPath`, `idempotencyKey`, and `confirmationText`; the single tool passes those fields to apply internally.
- If `plan_confirmation` returns `interactive_confirmation_unavailable`, `cancelled`, or `revision_requested`, real apply stays blocked unless the user explicitly allows conversation fallback.
- Approval artifacts are persisted outside the repo by default at `%LOCALAPPDATA%\LinearProjectAdminPi\write-confirmation-artifacts.json` on Windows, or can be overridden with `WRITE_CONFIRMATION_ARTIFACT_STORE_PATH`. This makes the artifact visible across Pi tool calls, extension reloads, and runtime/source clone path differences.
- Each artifact is bound to `writePlanPath`, `idempotencyKey`, `confirmationId`, exact `confirmationText`, and `approvalKind`. Real apply consumes it once, then uses the frozen final-validation snapshot and surfaces planned-vs-actual readback diff in audit; reused, expired, mismatched, missing, or unreadable artifacts are blocked with a diagnostic error that names the reason, store path when relevant, and next step.
- Do not downgrade an available `pi_ask_user` approval to `conversation_fallback`. Use fallback only when UI approval is unavailable or cancelled, the user explicitly allows fallback, and the apply call records `confirmationChannel=conversation_fallback`, `allowConversationFallback=true`, and the explicit approval text. Fallback audit text must be one clean record; do not paste a previous formatted fallback record back into `confirmationText`.
- Run `npm run test:plan-confirmation-ui`, `npm run test:write-plan-final-validation`, and `npm run test:linear-manifest-freeze` after changing this flow.

## Low-Risk Linear Write Wrapper

Use `linear_prepare_low_risk_write` or `node scripts/write-plan-builder.mjs --input <input.json>` with `kind=project_update|issue_create` only for L1/L2 single-Project writes that fit the whitelist:

- `project_update`: one `projectUpdate.create` for an already identified Project.
- `issue_create`: one `issue.create` under an already identified Project and verified existing Project Milestone.

1. Automatically call `linear_validate_and_apply_write_plan` once after generating a write plan. The tool handles final validation, `plan_confirmation`, approved apply, readback, and audit.

Fallback to full Fact Pack / full planning when any of these are missing or out of scope:

- Project baseline with `project.id`.
- For `issue_create`: title, description/acceptance criteria, team key or ID, labels or label names, target Project Milestone ID, and matching milestone readback.
- Any request involving cross-Project writes, multiple operations, repo-map changes, project/milestone structure changes, relation-heavy planning, ambiguous target Project, or uncertain evidence.

Run `npm run test:write-plan-builder` after changing this wrapper.

## Fact Pack Repo-Map Mismatch

- For single-Project tasks without an explicit target, call `pi_ask_user` with `flow=project_select` first. The options must come from the merged repo-map (`config/repo-map.yaml`/`REPO_MAP_PATH` plus `REPO_MAP_LOCAL_PATH`) and include `User input` last; do not query Linear for the candidate list before the user chooses.
- `fact_pack_build --repo <repoKey>` must resolve GitHub and local facts from the merged repo-map first. Local overlay entries override tracked config entries with the same repoKey.
- Fact Pack output includes `runtime`: current `cwd`, package root, extension source path, runtime git remote, repo-map localPath, repo-map git remote, `LOCAL_REPO_ROOTS`, effective local evidence root, path relation fields, and drift advice.
- `repo-map localPath != runtime cwd` can be legitimate when Pi is launched from a managed runtime clone and repo-map points at the implementation repo. This is acceptable only when GitHub repo, Linear Project, package identity, and intended source path are clear in `runtime.repoMap`.
- Repo-map localPath is the source of truth for local evidence for a selected `repoKey`; `LOCAL_REPO_ROOTS` is diagnostic/fallback context only and must not override a complete repo-map entry.
- If `runtime.repoMap.driftAdvice` reports different git remotes or an unexpected localPath, stop before planning/writing and repair the local repo-map overlay or choose the correct project. Do not silently collect facts from the runtime wrapper just because it is the current `cwd`.
- If a repoKey is missing or incomplete, record an evidence gap instead of falling back to another repo.
- Run `npm run test:repo-map` after changing repo-map behavior.

## Linear Project Locator Resolution

- `linear_get_project_context` and `fact_pack_build --linear` accept a Project ID, Linear Project URL, `/overview` URL, exact Project name, normalized Project name, or Project slug.
- The resolver first attempts direct Project lookup, then falls back to workspace matching by normalized Project URL, URL slug, ID, exact name, or normalized name.
- Normalized name matching only folds case, whitespace, and fullwidth/ASCII separator differences such as `｜` vs `|`; it does not perform fuzzy or contains matching.
- If no unique match exists, return a compact `project_selection_gap`; do not silently fall back to another repo-map project.
- Run `npm run linear:workspace` and a live smoke such as `node scripts/linear-cli.mjs project "<linear-project-overview-url>"` after changing this behavior.

## Repo-Map Drift Governance

- Detect drift with `npm run repo-map:drift -- check --repo <repoKey>`.
- The check command may write `state/repo-map.draft.yaml`, but it must not modify `config/repo-map.yaml` or the local overlay.
- If output contains `piAskUser.flow=repo_map`, call `pi_ask_user` with that seed and keep missing fields as evidence gaps until the user answers.
- Apply only after explicit confirmation: `npm run repo-map:drift -- apply --draft state/repo-map.draft.yaml --confirmed --confirmation-text "<approval>"`.
- Confirmed apply writes the local overlay by default. In the installed runtime, the launcher sets `REPO_MAP_LOCAL_PATH=%LOCALAPPDATA%\LinearProjectAdminPi\repo-map.local.yaml`, so machine-local mappings do not dirty the managed runtime clone. Use `--write-tracked` only when intentionally preparing a repo-map config change for PR review.
- Run `npm run test:repo-map-drift`, `npm run test:repo-map`, and a Fact Pack smoke after changing this flow.

## WezTerm Pi Launch

- The shortcut target should call the installed launcher under `%LOCALAPPDATA%\LinearProjectAdminPi`.
- On this machine, the active taskbar shortcut is `Linear Project Admin Pi (WezTerm) (2).lnk`; see `docs/LOCAL_RUNTIME_LAUNCH.md` for its exact target, arguments, working directory, and launch-log evidence.
- The launcher starts WezTerm with `--cwd "%USERPROFILE%\linear-pi-project-admin-agent-runtime"`.
- The launcher exports `REPO_MAP_LOCAL_PATH=%LOCALAPPDATA%\LinearProjectAdminPi\repo-map.local.yaml` before starting Pi.
- Keep tokens and credential values out of shortcut targets, WezTerm config, and docs.
- Runtime-local state changes must not make the launcher exit before WezTerm opens.
- Run `npm run test:wezterm-launch` and `npm run test:pipeline-refactor-goals` after changing launcher behavior.

## Emergency Rollback

- 设置 `PI_AUTO_RUN=false`。
- 设置 `ALLOW_LINEAR_WRITES=false`。
- 设置 `LINEAR_WRITE_MODE=dry-run`。
- 根据 `state/audit.jsonl` 的 idempotencyKey 和 readback URL 逐项核对，不执行批量删除。
