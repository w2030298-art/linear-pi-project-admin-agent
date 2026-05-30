# 部署方案：Linear Project Admin Agent in Pi

## 1. 目标

部署一个专用 Linear 项目管理员 Agent，具备：

1. 极致项目规划、架构分解、任务编排能力。
2. 基于 Linear、GitHub、本地 repo、本地 docs、联网搜索的事实核验能力。
3. 灵活适配 workspace labels、members、workflow states、编排习惯变化。
4. 不依赖每次打开终端，通过 Linear webhook / @mention / label trigger 唤醒。
5. 默认 dry-run，确认后写入 Linear，并审计。

---

## 2. 安装依赖

```bash
cd linear-pi-project-admin-agent
cp .env.example .env
npm install
npm run validate
```

安装 Pi Coding Agent：

```bash
npm install -g @earendil-works/pi-coding-agent
```

如你的发行版使用不同包名，以 Pi 官方 quickstart 为准。

---

## 3. 配置 Linear

`.env` 中配置：

```bash
LINEAR_API_KEY=lin_api_xxx
LINEAR_WEBHOOK_SECRET=whsec_xxx
LINEAR_DEFAULT_TEAM_KEY=ENG
LINEAR_WRITE_MODE=dry-run
ALLOW_LINEAR_WRITES=false
```

测试：

```bash
npm run linear:smoke
npm run linear:workspace
```

---

## 4. 配置 GitHub MCP / REST fallback

### 4.1 推荐：GitHub MCP Server

`config/mcp.servers.json` 已包含 Docker 配置：

```json
{
  "mcp": {
    "servers": {
      "github": {
        "command": "docker",
        "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "-e", "GITHUB_TOOLSETS", "ghcr.io/github/github-mcp-server"],
        "env": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}",
          "GITHUB_TOOLSETS": "context,repos,issues,pull_requests,actions"
        }
      }
    }
  }
}
```

GitHub MCP Server 的 toolsets 建议只启用：

```text
context,repos,issues,pull_requests,actions
```

不要在第一版启用写入型或宽泛 toolset。若需要创建 PR/Issue，也应经过 write guard。

### 4.2 REST fallback

`.env` 中配置：

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=github_pat_xxx
GITHUB_FACT_MODE=rest
GITHUB_DEFAULT_OWNER=your-org
GITHUB_DEFAULT_REPO=your-repo
```

测试：

```bash
npm run fact:repo
```

---

## 5. 配置本地 repo 和文档

`.env`：

```bash
LOCAL_REPO_ROOTS=./repos/your-repo
LOCAL_DOC_ROOTS=./docs,./research
```

`config/repo-map.yaml`：

```yaml
repos:
  - key: your-repo
    owner: your-org
    repo: your-repo
    defaultBranch: main
    localPath: ./repos/your-repo
    linearProjectPrefix: "your-repo｜"
```

测试：

```bash
npm run fact:local
node scripts/local-evidence.mjs docs --query "架构"
```

---

## 6. 配置联网搜索

推荐 Tavily 或 Brave：

```bash
WEB_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=tvly_xxx
ALLOW_WEB_SEARCH=true
```

或：

```bash
WEB_SEARCH_PROVIDER=brave
BRAVE_SEARCH_API_KEY=xxx
ALLOW_WEB_SEARCH=true
```

测试：

```bash
node scripts/web-search.mjs --query "Linear GraphQL API official docs" --official --max 5
```

联网搜索只用于外部资料，不得覆盖 Linear/GitHub/local 事实。

---

## 7. 启动 Pi 交互模式

```bash
pi
```

项目级 `.pi/settings.json` 会加载：

- `.pi/extensions/*`
- `.agents/skills/*`
- `.pi/prompts/*`
- `SYSTEM.md`

常用命令：

```text
/create-project 把这个需求规划成 Linear 项目
/extend-project 给已有项目增加这个能力
/fact-pack 为项目 X 建立事实包
/portfolio-review 先选择一个 Project，再执行单 Project 审查
/project-report 生成周报草案
/workspace-sync 同步 labels/members/states
```

---

## 8. 启动 Linear Webhook Bridge

```bash
npm run bridge:dev
```

暴露 HTTPS endpoint，例如使用 ngrok/cloudflared/reverse proxy：

```bash
ngrok http 8787
```

Linear webhook URL：

```text
https://YOUR_PUBLIC_URL/hooks/linear
```

Webhook resource types 建议第一版：

```text
Issue, Comment, IssueLabel, Project, ProjectUpdate
```

触发方式：

```text
Agent:PlanProject
Agent:ExtendProject
Agent:PortfolioReview
Agent:ReportDraft
Agent:Dispatch
Agent:HygieneCheck
Agent:SyncWorkspace
```

Bridge 默认只把任务写入 `state/pi-queue/*.md`。确认稳定后再设置：

```bash
PI_AUTO_RUN=true
```

---

## 9. Workspace 同步

```bash
node scripts/workspace-sync.mjs --write-draft
```

检查：

```text
state/workspace.manifest.draft.json
```

确认后手动合并到：

```text
config/workspace.manifest.json
```

不要让 Agent 自动吸收语义不明的 label 或 workflow state。

---

## 10. 写入上线步骤

第一阶段只读：

```bash
ALLOW_LINEAR_WRITES=false
LINEAR_WRITE_MODE=dry-run
```

第二阶段允许 L1 comment/update 草案：

```bash
ALLOW_LINEAR_WRITES=true
LINEAR_WRITE_MODE=dry-run
```

第三阶段实现并验证 `scripts/linear-cli.mjs apply` 的 mutation，然后只允许 L2：

```bash
ALLOW_LINEAR_WRITES=true
LINEAR_WRITE_MODE=confirmed-only
```

上线前必须通过：

```bash
npm run validate
npm run test:plan-review
npm run plan:review -- examples/project-plan.sample.json --strict
npm run plan:review -- examples/write-plan.sample.json --strict
npm run linear:smoke
npm run linear:workspace
npm run test:webhook-signature
node scripts/fact-pack.mjs --task "smoke test" --web
```

---

## 11. 验收标准

| 测试 | 通过条件 |
|---|---|
| 无 Linear token | 明确报错，不伪造读取结果 |
| Linear smoke | 能读取 viewer |
| Workspace sync | 能输出 teams/labels/users drift |
| GitHub evidence | 能读取 repo summary、PR、Actions |
| Local repo | 能读取 branch/commit/dirty |
| Web search | 能返回带 URL 的外部资料 |
| Fact Pack | 能产出 facts/conflicts/evidenceGaps/planningImplications |
| Project Plan reviewer | schema、labels、依赖、事实/假设/待确认项缺失会被标记 |
| Webhook 签名 | 假签名 401，真签名通过 |
| Label trigger | Agent:* label 被映射为任务 |
| Linear 写入 | 未确认时只 dry-run |

---

## 12. 生产化建议

- 用 OAuth app 替代个人 API key。
- 用 secret manager 管理 token。
- 用 permanent HTTPS endpoint 替代 ngrok。
- 把 `state/audit.jsonl`、`state/linear-events.jsonl` 纳入备份。
- 为 GitHub MCP 只启用必要 toolsets。
- 为 web search 设置域名白名单。
- 每周执行 `/workspace-sync`，再为一个指定 Project 执行 `/portfolio-review`。

---

## 13. Repo-map 部署边界

`config/repo-map.yaml` 是 Fact Pack 的 GitHub / Linear / Local 三方路由事实源。推荐配置：

```yaml
version: 1
repos:
  - repoKey: your-repo
    github:
      owner: your-org
      repo: your-repo
      defaultBranch: main
    linear:
      projectId: linear-project-uuid
      projectName: Your Linear Project
      projectPrefix: your-repo
    localPath: ./repos/your-repo
    docs:
      - README.md
      - docs/
      - package.json
    evidenceWeight: high
```

Fact Pack 优先级：

1. 传入 `--repo <repoKey>` 时，优先读取 `config/repo-map.yaml`。
2. 未传入 repoKey 时，才使用 `GITHUB_DEFAULT_OWNER`、`GITHUB_DEFAULT_REPO`、`GITHUB_DEFAULT_BRANCH`、`LOCAL_REPO_ROOTS` 兼容路径。
3. repo-map 缺失或字段不完整时，写入 `evidenceGaps`，不借用其他 repo 的 env fallback。

如果 repo-map 与 env fallback 不一致，repo-map 胜出，差异写入 `conflicts`。不要把 token 或 secret 写入 repo-map；不要自动扫描整盘寻找 repo。路径或项目映射缺失/漂移时，通过 `pi_ask_user flow=repo_map` 生成审阅草案，并只在用户确认后写入 `config/repo-map.yaml`。

Drift governance:

1. Run `npm run repo-map:drift -- check --repo <repoKey>` with explicit GitHub/Linear/local facts when available.
2. The check command writes only `state/repo-map.draft.yaml` and reports `drifts`, `missingFields`, `diff`, and `piAskUser` seeds when clarification is needed.
3. If fields are missing, use `pi_ask_user(flow=repo_map)` with the returned Linear Project context. Do not fabricate GitHub URL, localPath, repoKey, defaultBranch, or Linear Project ID.
4. After review and explicit confirmation, run `npm run repo-map:drift -- apply --draft state/repo-map.draft.yaml --confirmed --confirmation-text "<approval>"`.
5. Confirmed apply writes `config/repo-map.yaml`, appends `state/repo-map-audit.jsonl`, validates the map, and prints rollback commands.

验证：

```bash
node scripts/fact-pack.mjs --repo your-repo --no-github --no-local --no-linear
npm run test:repo-map
npm run test:repo-map-drift
```
