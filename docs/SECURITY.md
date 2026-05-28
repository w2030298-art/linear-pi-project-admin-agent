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

## GitHub

第一版建议只读 token，scope 限制在 repo read / metadata / actions read。不要启用写 PR、写 issue、写 workflow 的工具。

## Linear

第一版使用 personal API key 做 PoC；生产改 OAuth app + scoped permissions。

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
