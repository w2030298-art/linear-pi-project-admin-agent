# 安全与权限

## 原则

- 最小权限。
- 写入默认 dry-run。
- token 不进 Linear，不进 git。
- GitHub MCP toolsets 最小化。
- Web search 不访问私有页面。
- Local repo/docs 只读 allowlist 路径。

## 凭据

`.env` 不提交。建议生产环境使用 secret manager。

`.env.example` 只保留变量名和占位值；真实 `LINEAR_API_KEY`、`LINEAR_WEBHOOK_SECRET`、`GITHUB_PERSONAL_ACCESS_TOKEN`、`TAVILY_API_KEY`、`BRAVE_SEARCH_API_KEY` 只能放在本地 `.env` 或 secret manager 中。

## GitHub

第一版建议只读 token，scope 限制在 repo read / metadata / actions read。GitHub MCP toolsets 首版只启用 `context,repos,issues,pull_requests,actions` 这类读取和核验能力；不要启用写 PR、写 issue、写 workflow 的工具。

## Linear

第一版使用 personal API key 做 PoC；生产改 OAuth app + scoped permissions。PoC key 只用于当前 workspace 的 smoke、workspace snapshot、受控 comment / project update / issue mutation；不得把 key 或 webhook secret 写入 Linear comment、Project description 或 audit log 明文。

## Webhook

必须校验：

- raw body HMAC-SHA256 signature。
- webhookTimestamp 60 秒窗口。
- Linear-Delivery 去重。

## 写入

所有 mutation 需要：

- idempotencyKey。
- explicit confirmation。
- readback。
- audit log。

默认安全开关：

```bash
PI_AUTO_RUN=false
ALLOW_LINEAR_WRITES=false
LINEAR_WRITE_MODE=dry-run
ALLOW_GITHUB_WRITES=false
```

## 审计与状态保留

- `state/audit.jsonl`：记录 Linear apply 的开始、每个 operation、readback 和结束状态；保留最近 30 天，完成重要写入后复制到受控备份位置。
- `state/linear-events.jsonl`：记录 webhook delivery 元数据和 payload 摘要；PoC 保留最近 7 天，生产环境应改为受控日志系统并脱敏 payload。
- `state/seen-linear-deliveries.json`：delivery 去重状态；保留最近 7 天，重置前必须确认不会重复处理旧 webhook。
- `state/pi-queue/*.md` / `*.log`：本地 queue 和 Pi runner 输出；周巡检时归档或删除已处理项，不提交 Git。

## 回滚

1. 停止 bridge 进程或移除 Linear webhook endpoint。
2. 设置 `PI_AUTO_RUN=false`，确保只入队不自动执行。
3. 设置 `ALLOW_LINEAR_WRITES=false` 和 `LINEAR_WRITE_MODE=dry-run`。
4. 检查 `state/audit.jsonl` 最近一次 mutation 的 idempotencyKey、operation 和 readback。
5. 如需人工回滚 Linear 内容，只根据 audit/readback 中的对象 URL 逐项处理，不批量删除或归档。
