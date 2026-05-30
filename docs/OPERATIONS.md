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
npm run linear:workspace
npm run fact:pack -- --task "portfolio review"
npm run bridge:dev
```

## 每周例行

1. `/workspace-sync`：检查 workspace drift。
2. `/portfolio-review`：项目健康审查。
3. `/cycle-plan`：disabled; do not use for active planning.
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
- [决策] 纳入 current / next Cycle 的 issue。
- [待确认项] 需要人类确认的范围、权限或上线动作。

### 验收证据
- `npm run validate`
- `npm run linear:workspace`
- `npm run fact:pack -- --task "portfolio review"`
```

## Cycle 纳入规则（disabled）

Cycle planning is disabled. The historical rules below are not active operating policy.

- Current Cycle 只放入依赖已解除、验收命令明确、能在 1-2 周内关闭的 issue。
- Next Cycle 可以纳入依赖即将解除、范围清楚但还需要一次事实核验的 issue。
- 不把 `blockedBy` 未完成、缺少验收标准、缺少 Task-difficulty label 的 issue 纳入 Current Cycle。
- Cycle 不替代 Milestone；Milestone 表达交付阶段，Cycle 表达短周期执行窗口。

## 备份与保留

- 每周备份 `state/audit.jsonl`、`state/linear-events.jsonl`、`state/seen-linear-deliveries.json` 和未处理的 `state/pi-queue/`。
- `state/audit.jsonl` 保留 30 天；webhook delivery 和 queue state PoC 保留 7 天。
- 备份前检查日志中没有 token、secret、private key；发现敏感字段时先脱敏再归档。

## 故障处理

### Webhook 401

- 检查 `LINEAR_WEBHOOK_SECRET`。
- 确认服务使用 raw body 校验。
- 检查系统时间。

### GitHub evidence unavailable

- 检查 `GITHUB_PERSONAL_ACCESS_TOKEN`。
- 检查 repo owner/name。
- 如果 MCP 不工作，切换 `GITHUB_FACT_MODE=rest`。

### Web search unavailable

- 检查 Tavily/Brave key。
- 设置 `ALLOW_WEB_SEARCH=false` 关闭。
- 如果使用 `--official`，检查输出里的 `officialDomains`；Linear 官方查询应只返回 `linear.app` 域结果。

### Local docs search misses

- 优先使用包含多个关键词的自然查询；结果会返回 `tokens`、`score`、`matchedTokens`。
- 如果召回仍为空，检查 `LOCAL_DOC_ROOTS` 或显式传入 `--root`。

### Linear issue lookup mismatch

- 按 `WEN-123` 或 UUID 查单个 Issue 时使用 `node scripts/linear-cli.mjs issue WEN-123` 或 `linear_get_issue`。
- `linear_search_issues` 是全文 contains 搜索，不能当作 exact identifier lookup。

### Linear write blocked

- 检查 `ALLOW_LINEAR_WRITES`。
- 检查用户是否通过一次 `ask_user` 明确 approve；不要要求固定确认句后再二次确认。
- 检查 writePlan 是否包含 idempotencyKey。
- 调用 `linear_apply_write_plan` 时确认 `confirmedByUser=true`，`confirmationText` 记录本次 `ask_user` approve。

### Project description length error

- Linear `Project.description` must be 255 characters or shorter.
- Do not silently truncate long project text.
- Run `npm run test:project-description-fields` when changing write-plan compilation.
- `linear_plan_quality_review` should emit `write_plan_project_description_too_long` for long Project descriptions.
- `node scripts/linear-cli.mjs apply <plan> --dry-run` should show `fieldTransforms` and preserve the full original description in `Project.content`.

### Linear dry-run / apply protocol mismatch

- `linear_apply_write_plan` with `dryRun=true` is allowed without user approval and only compiles the plan.
- Real writes still require `LINEAR_WRITE_MODE=confirmed-only`, `ALLOW_LINEAR_WRITES=true`, and `confirmedByUser=true`.
- When the tool is called with `dryRun=false` and `--confirmed`, `scripts/linear-cli.mjs apply` builds an effective non-dry-run plan in memory; agents do not need to hand-write a separate confirmed copy just to flip `dryRun`.
- The output includes `reason.cliConfirmedOverride` when CLI/tool confirmation overrides a dry-run source file for real apply.

### Fact Pack repo-map mismatch

- `fact_pack_build --repo <repoKey>` must resolve GitHub and local facts from `config/repo-map.yaml` first.
- If a repoKey is missing or incomplete, record an evidence gap instead of falling back to `GITHUB_DEFAULT_*` / `LOCAL_REPO_ROOTS` for another repo.
- Run `npm run test:repo-map` after changing repo-map behavior.

### Repo-map drift governance

- Detect drift with `npm run repo-map:drift -- check --repo <repoKey>`. Pass explicit facts such as `--github-owner`, `--github-repo`, `--default-branch`, `--linear-project-id`, `--linear-project-name`, and `--local-path` when they are available from Linear/GitHub/local evidence.
- The check command may write `state/repo-map.draft.yaml`, but it must not modify `config/repo-map.yaml`.
- If output contains `piAskUser.flow=repo_map`, call `pi_ask_user` with that seed and keep missing fields as evidence gaps until the user answers. Do not invent GitHub URL, localPath, Linear Project ID, or defaultBranch.
- Apply only after explicit confirmation: `npm run repo-map:drift -- apply --draft state/repo-map.draft.yaml --confirmed --confirmation-text "<approval>"`.
- Apply output must include a diff, validation result, `state/repo-map-audit.jsonl` record, and rollback advice. Without `--confirmed`, apply is blocked.
- Run `npm run test:repo-map-drift`, `npm run test:repo-map`, and a Fact Pack smoke after changing this flow.

### WezTerm Pi launch grey rollout

- The grey shortcut target should be `C:\Program Files\WezTerm\wezterm-gui.exe`.
- The shortcut arguments should use `start --always-new-process --cwd "C:\Users\22003\linear-pi-project-admin-agent" powershell.exe -NoLogo -NoExit -Command "pi"`.
- Keep tokens and credential values out of shortcut targets, WezTerm config, and docs.
- Run `npm run test:wezterm-launch` after changing `docs/WEZTERM_PI_LAUNCH.md` or the smoke report.
- Keep WezTerm as a grey rollout until the visible Pi TUI checklist is verified: Chinese input, copy/paste, scrollback, shortcuts, theme, and font.

### Repo-map interactive clarification

- Use `pi_ask_user` with `flow=repo_map` when GitHub, Linear Project, and local repo facts are missing or disagree.
- The tool asks one field at a time: target Linear Project first, then GitHub URL, local repo path, repoKey, and defaultBranch.
- The result is a review-only draft; do not write `config/repo-map.yaml` until the user separately confirms the draft.
- In non-UI mode, `pi_ask_user` returns `needs_interactive_input` and evidence gaps instead of blocking or fabricating answers.
- Run `npm run test:pi-ask-user` after changing interactive repo-map clarification behavior.

### Existing milestone extension rejected

- 如果只是新增 Issue 到已有 Milestone，不要新建临时 Milestone 来绕过 reviewer。
- 先用 Linear 回读确认目标 Milestone 存在。
- write plan 顶层写入 `targetProjectId`、`targetMilestoneId`、`targetMilestoneReadback`。
- `issue.create.input.projectId` 和 `issue.create.input.projectMilestoneId` 应指向同一组已回读对象。

### Emergency rollback

- 设置 `PI_AUTO_RUN=false`。
- 设置 `ALLOW_LINEAR_WRITES=false`。
- 设置 `LINEAR_WRITE_MODE=dry-run`。
- 根据 `state/audit.jsonl` 的 idempotencyKey 和 readback URL 逐项核对，不执行批量删除。
## Cycle Disabled

Cycle planning and `cycleId` writes are disabled for this agent. Do not dispatch `Agent:CyclePlan`, do not use `/cycle-plan` for active planning, and do not include `cycleId` in Linear write plans. Use Project, Milestone, Issue, relation, report, repo-map, and workspace-sync flows instead.

## Linear Write Confirmation UI

In interactive Pi runs, `linear_apply_write_plan` uses the tool execution context `ctx.ui.confirm()` as the approve/cancel confirmation channel before real Linear writes. If `ctx.hasUI` is false, the agent may only use the current conversation explicit approval fallback after telling the user that no generic confirmation UI is available.

## WezTerm Runtime Refresh

Use `/reload` only to reload Pi files that are already present in the current checkout.

Use `/reload-master` inside the stable WezTerm runtime when the open Pi session should update from `origin/master` first. The command refuses non-git directories, non-`master` branches, and dirty checkouts; then it runs `git fetch origin master`, `git pull --ff-only origin master`, refreshes stale npm dependencies, and reloads the Pi runtime.

Runtime-local files are not owned by `master`: keep `.env`, `.env.*`, `.pi/sessions/`, `state/*.jsonl`, `state/fact-packs/*.json`, `state/pi-queue/*.md`, `state/pi-queue/*.log`, `state/repo-map.draft.yaml`, `state/repo-map-audit.jsonl`, `state/write-plans/`, and `state/audit-reports/` untracked. The launcher and `/reload-master` must not use `git clean`, `git reset --hard`, or recursive deletion of the runtime root.
