# 运维手册

## 日常命令

```bash
npm run validate
npm run test:plan-review
npm run test:project-description-fields
npm run test:repo-map
npm run test:repo-map-drift
npm run test:pi-ask-user
npm run test:wezterm-launch
npm run test:linear-apply-mode
npm run test:retrieval-ux
npm run test:write-confirmation
npm run test:pipeline-refactor-goals
npm run linear:workspace
npm run fact:pack -- --task "project review" --linear "<project-id-or-key>"
npm run bridge:dev
```

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

- 检查 `ALLOW_LINEAR_WRITES`。
- 检查用户是否通过一次 `ask_user` 明确 approve；不要要求固定确认句后再二次确认。
- 检查 writePlan 是否包含 idempotencyKey。
- 调用 `linear_apply_write_plan` 时确认 `confirmedByUser=true`，`confirmationText` 记录本次最终 approve。

## Linear Dry-Run / Apply Protocol

- `linear_apply_write_plan` with `dryRun=true` is allowed without user approval and only compiles the plan.
- Real writes still require `LINEAR_WRITE_MODE=confirmed-only`, `ALLOW_LINEAR_WRITES=true`, and `confirmedByUser=true`.
- In interactive Pi runs, `linear_apply_write_plan` uses `ctx.ui.confirm()` as the final approve/cancel channel before real Linear writes.
- If `ctx.hasUI` is false, the agent may use current conversation explicit approval fallback after saying no generic confirmation UI is available.

## Fact Pack Repo-Map Mismatch

- `fact_pack_build --repo <repoKey>` must resolve GitHub and local facts from `config/repo-map.yaml` first.
- If a repoKey is missing or incomplete, record an evidence gap instead of falling back to another repo.
- Run `npm run test:repo-map` after changing repo-map behavior.

## Repo-Map Drift Governance

- Detect drift with `npm run repo-map:drift -- check --repo <repoKey>`.
- The check command may write `state/repo-map.draft.yaml`, but it must not modify `config/repo-map.yaml`.
- If output contains `piAskUser.flow=repo_map`, call `pi_ask_user` with that seed and keep missing fields as evidence gaps until the user answers.
- Apply only after explicit confirmation: `npm run repo-map:drift -- apply --draft state/repo-map.draft.yaml --confirmed --confirmation-text "<approval>"`.
- Run `npm run test:repo-map-drift`, `npm run test:repo-map`, and a Fact Pack smoke after changing this flow.

## WezTerm Pi Launch

- The shortcut target should call the installed launcher under `%LOCALAPPDATA%\LinearProjectAdminPi`.
- The launcher starts WezTerm with `--cwd "C:\Users\22003\linear-pi-project-admin-agent-runtime"`.
- Keep tokens and credential values out of shortcut targets, WezTerm config, and docs.
- Runtime-local state changes must not make the launcher exit before WezTerm opens.
- Run `npm run test:wezterm-launch` and `npm run test:pipeline-refactor-goals` after changing launcher behavior.

## Emergency Rollback

- 设置 `PI_AUTO_RUN=false`。
- 设置 `ALLOW_LINEAR_WRITES=false`。
- 设置 `LINEAR_WRITE_MODE=dry-run`。
- 根据 `state/audit.jsonl` 的 idempotencyKey 和 readback URL 逐项核对，不执行批量删除。
