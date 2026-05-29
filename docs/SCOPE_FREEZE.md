# v0.1 范围冻结

日期：2026-05-28  
GitHub 仓库：https://github.com/w2030298-art/linear-pi-project-admin-agent  
本地基线 commit：`ce72f3de35a9255df979aec210f29f068e97e591`

## 事实

- Linear 项目为 `linear-pi-project-admin-agent｜Linear 项目管理员 Agent 运行时`。
- v0.1 面向单人本地 PoC / runtime 验收，不承诺多 workspace SaaS 化。
- 写入默认 `dry-run`，真实 Linear mutation 必须经过 `confirmed-only`、显式确认、readback 和 audit log。
- `.env`、token、secret、私有凭据不进入 Git，也不写入 Linear。

## MVP

- 本地安装与校验：`npm install`、`npm run validate`。
- 事实层：Linear / GitHub / local repo/docs / web search evidence 汇总为 Fact Pack。
- Pi 交互入口：project-level skills、prompts、extensions 可由 `.pi/settings.json` 加载。
- Project Plan reviewer：schema、labels、依赖、事实/假设/待确认项、write plan dry-run 边界检查。
- Linear Webhook Bridge：HMAC、timestamp、delivery 去重、`Agent:*` label routing、本地 queue。
- 写入治理：`scripts/linear-cli.mjs apply` 保持 dry-run / confirmed-only / 幂等 / readback / audit。
- 安全与运维：token scope、audit/state 备份、回滚开关、周巡检和状态更新模板。

## 非目标

- 不在 MVP 中实现 OAuth app 全流程；PoC 使用 personal API key，生产化再迁移。
- 不开启无确认自动写入；`PI_AUTO_RUN=false` 是默认安全姿态。
- 不提交 `.env`、token、secret、私有 webhook payload 或隐私数据。
- 不扩大 GitHub MCP 到写 PR、写 Issue、写 workflow 等写入型 toolsets。
- 不实现 dispatch UI、dashboard、多租户、多 workspace SaaS 化或长期 HTTPS endpoint 托管。

## 验收命令

```bash
npm run validate
npm run test:plan-review
npm run plan:review -- examples/project-plan.sample.json --strict
npm run plan:review -- examples/write-plan.sample.json --strict
npm run linear:smoke
npm run linear:workspace
npm run fact:pack -- --task "smoke test"
node scripts/fact-pack.mjs --task "smoke test" --web
npm run test:webhook-signature
```

## 风险与待确认项

| 类型 | 项 | 当前处理 |
| --- | --- | --- |
| 待确认 | v0.1 目标日期是否仍为 2026-07-05 | 保留在 Linear Project description 中 |
| 待确认 | OAuth app 的权限模型 | 标记为 vNext，不进入 MVP |
| 待确认 | permanent HTTPS endpoint | PoC 可用 ngrok/cloudflared，生产再决定 |
| 风险 | Web search 或 GitHub evidence token 缺失 | 命令输出 evidenceGaps，不伪造事实 |
| 风险 | 本地 runtime state 膨胀或泄漏 payload | `state/*.jsonl` / queue state 不提交，按运维手册轮转备份 |
