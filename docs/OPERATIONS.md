# 运维手册

## 日常命令

```bash
npm run validate
npm run test:plan-review
npm run test:retrieval-ux
npm run test:write-confirmation
npm run linear:workspace
npm run fact:pack -- --task "portfolio review"
npm run bridge:dev
```

## 每周例行

1. `/workspace-sync`：检查 workspace drift。
2. `/portfolio-review`：项目健康审查。
3. `/cycle-plan`：调整当前/下一周期。
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

## Cycle 纳入规则

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
