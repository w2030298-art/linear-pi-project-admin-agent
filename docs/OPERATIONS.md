# 运维手册

## 日常命令

```bash
npm run validate
npm run linear:workspace
npm run fact:pack -- --task "portfolio review"
npm run bridge:dev
```

## 每周例行

1. `/workspace-sync`：检查 workspace drift。
2. `/portfolio-review`：项目健康审查。
3. `/cycle-plan`：调整当前/下一周期。
4. 检查 `state/audit.jsonl` 和 `state/linear-events.jsonl`。

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

### Linear write blocked

- 检查 `ALLOW_LINEAR_WRITES`。
- 检查用户是否明确 approve。
- 检查 writePlan 是否包含 idempotencyKey。
