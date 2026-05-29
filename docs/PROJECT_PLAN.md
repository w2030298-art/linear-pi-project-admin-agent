# 项目实施计划

## Phase 0：解压与校验

- 解压 zip。
- 配置 `.env`。
- 执行 `npm install` 与 `npm run validate`。

## Phase 1：只读事实层

- Linear smoke test。
- GitHub evidence test。
- Local repo/docs evidence test。
- Web search test。
- Fact Pack test。

## Phase 2：Pi 交互模式

- 启动 `pi`。
- 测试 `/fact-pack`、`/create-project`、`/portfolio-review`。
- 确认 skills 和 extensions 加载。
- 对 Project Plan / Write Plan 执行确定性 reviewer：
  - `npm run test:plan-review`
  - `npm run plan:review -- examples/project-plan.sample.json --strict`
  - `npm run plan:review -- examples/write-plan.sample.json --strict`

## Phase 3：Linear Bridge

- 启动 `npm run bridge:dev`。
- 配置公开 HTTPS endpoint。
- Linear 中创建 webhook。
- 测试 `Agent:*` label trigger。

## Phase 4：写入治理

- 保持 dry-run。
- 补齐 `linear-cli.mjs apply` mutation。
- 对 sample write plan 运行 dry-run。
- 小范围允许 L1 comment/project update。
- 再上线 L2 project/issue/relation 写入。

## Phase 5：迭代与治理

- 每次 workspace 改 label/member/status 后运行 `/workspace-sync`。
- 每周运行 `/portfolio-review`。
- 每周期运行 `/cycle-plan`。
- 定期审查 GitHub MCP toolsets 和 token scopes。

## v0.1 范围冻结

`docs/SCOPE_FREEZE.md` 是 v0.1 的范围冻结文件。MVP 只包含本地安装、事实层、Pi 交互、Webhook Bridge、Project Plan reviewer、写入治理和安全运维；OAuth app、长期 HTTPS endpoint、dispatch UI、dashboard、多 workspace SaaS 化进入 vNext / Later。
