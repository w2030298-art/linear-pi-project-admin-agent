# ADR-001: Pi → Claude Code 原生架构映射

| 字段 | 值 |
|---|---|
| 状态 | Accepted |
| 日期 | 2026-06-03 |
| 关联 Issue | WEN-301 |
| 阻塞 | WEN-302 (启动链路)、WEN-303 (配置迁移)、WEN-304 (Fact Pack)、WEN-305 (写入治理) |

## 背景与动机

现有 Linear Project Admin Runtime 建立在 Pi Coding Agent 之上，使用 Pi 专有的 extension/skill/prompt/session 机制实现了完整的项目管理能力栈。目标是将这些能力迁移到 Claude Code 原生框架，利用 CLAUDE.md、`.claude/` settings、skills、subagents、hooks、MCP 和 CLI/Agent SDK 重建等价行为，而不是直接复制 Pi 专用 API 实现。

### 非复制原则

迁移的目标是**行为等价**而非**API 复制**。Pi 框架提供的某些具体 API（如 `pi.registerTool()`、`ctx.ui.confirm()`、`ctx.reload()`）在 Claude Code 中没有直接对应物，但它们承载的安全语义和用户交互意图可以用 Claude Code 原生机制表达。以下情况不做直接复制：

- Pi extension TypeScript 注册式工具 → 改用 MCP server 或 hooks + shell 脚本
- Pi `ctx.ui.confirm()` → 改用 hooks + permission rules 或 CLI 交互确认
- Pi `ctx.reload()` → 改用 session 重启或 `--init` 维护模式
- Pi session/compaction 内部状态 → 改用 Claude Code 原生 session 管理

---

## 组件映射总览

下表覆盖 Pi runtime 的全部核心组件，逐项映射到 Claude Code 原生承载机制。

| # | Pi 组件 | 当前实现 | Claude Code 承载 | 复制/重建 | 迁移优先级 |
|---|---|---|---|---|---|
| 1 | SYSTEM 指令 | `SYSTEM.md` (Pi system override) | `CLAUDE.md` (项目根) | 行为迁移 | P0 |
| 2 | Pi settings | `.pi/settings.json` | `.claude/settings.json` | 结构重映射 | P0 |
| 3 | Skills | `.agents/skills/*/SKILL.md` | `.claude/skills/*/SKILL.md` | 格式适配 | P0 |
| 4 | Slash prompts | `.pi/prompts/*.md` | `.claude/skills/*/SKILL.md` | 合并到 skills | P1 |
| 5 | Extensions (tools) | `.pi/extensions/*.ts` | MCP server + hooks | 重建 | P1 |
| 6 | Write guard | `linear-write-guard.ts` | `PreToolUse` hook + permission rules | 重建 | P0 |
| 7 | Plan confirmation | `pi-ask-user.ts` (plan_confirmation) | `PreToolUse` hook + CLI 交互 | 重建 | P0 |
| 8 | Fact Pack builder | `scripts/fact-pack.mjs` + extensions | MCP server + skill | 重建 | P1 |
| 9 | Webhook bridge | `services/linear-bridge/` | 独立进程 + Agent SDK trigger | 保留+适配 | P2 |
| 10 | Runtime launcher | WezTerm + `launch-linear-pi-runtime.ps1` | Shell 脚本 + `claude` CLI | 重建 | P1 |
| 11 | Audit / readback | `state/audit.jsonl` + readback 逻辑 | `PostToolUse` hook + MCP server | 重建 | P0 |
| 12 | Model trust boundary | `.pi/settings.json` enabledModels | `.claude/settings.json` + `--model` flag | 结构重映射 | P0 |
| 13 | Workspace manifest sync | `scripts/workspace-sync.mjs` | MCP server 或 skill | 重建 | P2 |
| 14 | Repo-map governance | `scripts/repo-map*.mjs` | 独立脚本 + skill 调度 | 保留+适配 | P2 |

---

## 详细映射

### 1. SYSTEM 指令 → CLAUDE.md

**Pi 实现**: `SYSTEM.md` 作为 Pi system override 注入模型 system prompt，定义核心身份、安全边界、工作协议。

**Claude Code 承载**: 项目根目录 `CLAUDE.md`。Claude Code 在每次 session 启动时将其作为 user message 加载到 system prompt 之后。`CLAUDE.md` 在 compaction 后会从磁盘重新读取，保证持久性。

**迁移策略**:
- 将 `SYSTEM.md` 的核心规则（身份、安全边界、事实优先、写入门禁）迁移到 `CLAUDE.md`。
- `.agents/AGENTS.md` 的工作原则和模式表合并进 `CLAUDE.md`，因为 Claude Code 不区分 SYSTEM 和 AGENTS 两层。
- 保留"不扩大能力范围"、"一次一个 Project"、"事实先行"等硬约束。

**不直接复制**: Pi 的 system override 注入机制（Pi 框架内部 system prompt 拼接）。Claude Code 使用声明式 `CLAUDE.md` 替代。

### 2. Pi Settings → .claude/settings.json

**Pi 实现**: `.pi/settings.json` 定义 session 目录、skills 路径、prompts 路径、extensions 列表、compaction 参数、retry 策略、enabledModels 白名单。

**Claude Code 承载**: `.claude/settings.json` 支持 permissions、hooks、env vars、model defaults。部分字段直接映射：

| Pi 字段 | Claude Code 对应 |
|---|---|
| `sessionDir` | Claude Code 原生 session 管理（无需显式配置） |
| `skills` | `.claude/skills/` 目录约定 |
| `prompts` | 合并到 `.claude/skills/`（slash command = skill） |
| `extensions` | `.claude/settings.json` hooks + `.mcp.json` MCP servers |
| `compaction` | Claude Code 原生 compaction（`CLAUDE.md` 自动 survive） |
| `retry` | Claude Code 原生 retry（无需显式配置） |
| `enabledModels` | `--model` CLI flag + managed policy 或 `.claude/settings.json` model 约束 |

**不直接复制**: Pi 的 `enableSkillCommands`（Claude Code skills 默认就是 slash commands）、Pi 的 extension loading 列表（改用 hooks + MCP）。

### 3. Skills → .claude/skills/

**Pi 实现**: `.agents/skills/*/SKILL.md` 使用 YAML frontmatter (`name`, `description`) + markdown body。Pi skills 按序号命名（`00-linear-admin-core`、`10-fact-ingestion` 等），通过 `enableSkillCommands` 暴露为 slash commands。

**Claude Code 承载**: `.claude/skills/*/SKILL.md` 使用相同的 Agent Skills 开放标准。Claude Code 扩展了 frontmatter：`disable-model-invocation`、`user-invocable`、`allowed-tools`、`context: fork`、`agent`、`hooks`。

**迁移策略**:
- 保留 SKILL.md 格式，调整 frontmatter 以利用 Claude Code 扩展字段。
- 核心协议 skill（`00-linear-admin-core`）设为 `user-invocable: false`，让 Claude 自动加载为背景知识。
- 治理 skill（`90-governance`）保持双向可调用（默认行为）。
- 带副作用的 skill（如未来的 `deploy`）设为 `disable-model-invocation: true`。
- 参考文件（`references/`）保留在 skill 目录中，Claude Code 原生支持 skill 子目录。

**可复用的行为策略**: SKILL.md 格式、frontmatter `name`/`description`、markdown body 的指令结构。

| Pi Skill | Claude Code Skill | 控制 |
|---|---|---|
| `00-linear-admin-core` | `linear-admin-core` | `user-invocable: false` |
| `10-fact-ingestion` | `fact-ingestion` | 默认（双向） |
| `20-project-planning` | `project-planning` | 默认 |
| `30-architecture-decomposition` | `architecture-decomposition` | 默认 |
| `40-issue-orchestration` | `issue-orchestration` | 默认 |
| `50-workspace-sync` | `workspace-sync` | 默认 |
| `60-evidence-based-reporting` | `evidence-based-reporting` | 默认 |
| `70-web-research` | `web-research` | 默认 |
| `80-linear-agent-session` | `linear-agent-session` | `disable-model-invocation: true` |
| `90-governance` | `governance` | 默认 |

### 4. Slash Prompts → Skills

**Pi 实现**: `.pi/prompts/*.md` 定义 slash prompt 模板（`/workspace-sync`、`/portfolio-review`、`/project-report` 等），由 `.pi/settings.json` 的 `prompts` 字段加载。

**Claude Code 承载**: Claude Code 已将 commands 和 skills 合并。`.claude/commands/*.md` 和 `.claude/skills/*/SKILL.md` 都创建 `/name` 命令。推荐使用 skills 因为支持子目录、auto-invocation、subagent 执行。

**迁移策略**:
- 每个 `.pi/prompts/*.md` 迁移为 `.claude/skills/<name>/SKILL.md`。
- 添加 YAML frontmatter（`name`、`description`）以启用 auto-invocation。
- 复杂流程 prompt（如 `create-project`、`extend-project`）可设 `context: fork` 在隔离 subagent 中执行。

| Pi Prompt | Claude Code Skill | 说明 |
|---|---|---|
| `/workspace-sync` | `workspace-sync` | 已有 skill，合并 prompt 内容 |
| `/portfolio-review` | `portfolio-review` | 已有 skill，合并 prompt 内容 |
| `/project-report` | `project-report` | 已有 skill，合并 prompt 内容 |
| `/fact-pack` | `fact-pack` | 合并到 `fact-ingestion` skill |
| `/create-project` | `create-project` | 已有 skill，合并 prompt 内容 |
| `/extend-project` | `extend-project` | 已有 skill，合并 prompt 内容 |
| `/issue-dispatch` | `issue-dispatch` | 合并到 `issue-orchestration` skill |

### 5. Extensions (Pi Tools) → MCP Server + Hooks

**Pi 实现**: `.pi/extensions/*.ts` 使用 `pi.registerTool()` 注册自定义工具。工具主体通常转发给 `scripts/*.mjs`，在 webhook bridge 中复用。

**Claude Code 承载**: Claude Code 不支持直接注册 TypeScript 工具。外部工具通过 MCP（Model Context Protocol）server 暴露。

**迁移策略**: 将 Pi extensions 分为三类处理：

| 类别 | Pi Extension | Claude Code 承载 | 说明 |
|---|---|---|---|
| **数据查询** | `fact-source-router.ts` | MCP server | 路由 Linear/GitHub/local/web 事实查询 |
| **数据查询** | `github-evidence.ts` | MCP server (GitHub MCP) | 已有 GitHub MCP server 配置 |
| **数据查询** | `local-repo-docs.ts` | Claude Code 原生文件读取 + MCP | Claude Code 自带 Read/Glob/Grep |
| **数据查询** | `web-research.ts` | MCP server (web search) | Tavily/Brave MCP server |
| **数据查询** | `workspace-sync.ts` | MCP server | Linear workspace manifest 操作 |
| **治理门禁** | `linear-write-guard.ts` | `PreToolUse` hook | 拦截 Linear 写入工具调用 |
| **治理门禁** | `linear-plan-reviewer.ts` | skill + 脚本调用 | 写入计划质量审查 |
| **用户交互** | `pi-ask-user.ts` | `PreToolUse` hook + CLI 交互 | 计划确认、项目选择 |
| **运维** | `runtime-master-reload.ts` | shell 脚本 + skill | `/reload-master` 等价 |
| **运维** | `observability.ts` | `PostToolUse` hook | 运行时观测 |
| **管理工具** | `linear-admin-tools.ts` | MCP server | Linear CRUD 操作 |

**不直接复制的 Pi 专用实现**:
- `pi.registerTool()` API — Claude Code 无对应物；改用 MCP `tool` protocol。
- `ctx.ui.confirm()` — Pi 内置 UI 确认；Claude Code 改用 hooks + permission rules 实现等价门禁。
- `ctx.hasUI` 检测 — Claude Code 通过 permission mode 和 hook 返回值控制交互行为。
- Extension hot-reload (`ctx.reload()`) — Claude Code 通过 session 重启或 `--init` 实现。

### 6. Write Guard → PreToolUse Hook + Permission Rules

**Pi 实现**: `linear-write-guard.ts` 注册为 Pi extension，在每次 Linear 写入工具调用前检查：
- `LINEAR_WRITE_MODE` 环境变量
- `ALLOW_LINEAR_WRITES` 开关
- `ApprovalArtifact` 有效性（未过期、未消费、digest 匹配、confirmationId 匹配）
- `dryRun` / `confirmedByUser` 标志

**Claude Code 承载**: `.claude/settings.json` 中的 `PreToolUse` hook，匹配 Linear MCP 工具调用：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__linear.*",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/claude-code-write-guard.mjs"
          }
        ]
      }
    ]
  }
}
```

hook 脚本通过环境变量 `CLAUDE_TOOL_NAME` 和 `CLAUDE_TOOL_INPUT` 获取工具调用上下文，执行与现有 write guard 等价的校验逻辑。Exit code 2 阻止执行，exit code 0 放行。

**安全边界保留**:
- 默认 dry-run 语义不变。
- `ALLOW_LINEAR_WRITES=false` 时阻止所有真实写入。
- 审批 artifact 绑定（writePlanPath、idempotencyKey、planDigest）逻辑保留。
- Permission rules 中 Linear 写入工具默认设为 `deny`，只有 hook 显式放行后才执行。

**不直接复制**: Pi 的 `ctx.ui.confirm()` 弹窗机制。Claude Code 的 hooks 不提供 UI 弹窗，改用 exit code 控制 + permission prompt + 审批 artifact 文件实现等价门禁。

### 7. Plan Confirmation → PreToolUse Hook + CLI 交互

**Pi 实现**: `pi-ask-user.ts` 注册 `pi_ask_user` 工具，支持多种 flow：
- `plan_confirmation`: Yes / No / 调整意见，生成 `ApprovalArtifact`
- `project_select`: 项目选择
- `repo_map`: repo-map 修复
- `write_confirmation`: 遗留审批

**Claude Code 承载**: 分解为多个机制：

| Pi flow | Claude Code 承载 | 说明 |
|---|---|---|
| `plan_confirmation` | `PreToolUse` hook（匹配 apply 工具）+ 审批 artifact 脚本 | hook 在真实 apply 前检查 artifact；artifact 由 skill 流程中的脚本生成 |
| `project_select` | Skill 内逻辑 + Claude Code 原生对话交互 | 无需专用工具，Claude 在 skill 执行中直接询问用户 |
| `repo_map` | Skill 内逻辑 + 脚本 | 复用 `repo-map-drift.mjs` |
| `write_confirmation` | 合并到 `plan_confirmation` | 遗留 flow，统一到新机制 |

**审批 artifact 生命周期**:
1. Skill/脚本生成 write plan → 调用 `scripts/plan-reviewer.mjs` → 调用 dry-run apply。
2. Claude 向用户展示 dry-run 结果并请求确认（原生对话交互）。
3. 用户确认后，脚本生成 `ApprovalArtifact` 写入 artifact store。
4. 真实 apply 的 `PreToolUse` hook 验证 artifact，放行或阻止。

### 8. Fact Pack → MCP Server + Skill

**Pi 实现**: `fact-source-router.ts` + `github-evidence.ts` + `local-repo-docs.ts` + `web-research.ts` 通过 Pi extensions 注册事实采集工具，`scripts/fact-pack.mjs` 编排采集流程，输出 compact digest + raw evidence 落盘。

**Claude Code 承载**: 组合方案：
- **Linear 事实**: Linear MCP server（已有 `@linear/sdk`）或自建 MCP server 封装 `linear-cli.mjs`。
- **GitHub 事实**: GitHub MCP server（已有 `config/mcp.servers.json` 配置）。
- **本地 repo/docs**: Claude Code 原生文件操作（Read、Glob、Grep），无需额外工具。
- **Web search**: Web search MCP server（Tavily/Brave）。
- **编排**: `.claude/skills/fact-pack/SKILL.md` 定义采集流程，调用上述 MCP 工具 + shell 脚本。

**可复用的行为策略**: Fact Pack 的输出格式（facts/evidenceManifest/conflicts/evidenceGaps/planningImplications）、compact digest 设计、evidence 落盘路径约定。这些是协议而非 Pi 专用实现。

### 9. Webhook Bridge → 独立进程 + Agent SDK

**Pi 实现**: `services/linear-bridge/` 是独立 Express server，接收 Linear webhook，验证签名，dispatch 到 Pi queue，由 `pi-runner.ts` 启动 Pi session 处理。

**Claude Code 承载**: Webhook bridge 本身是独立进程，不依赖 Pi 框架。迁移方案：
- Bridge server（Express + webhook 验签 + event dispatch）**保留**，它不是 Pi 专用实现。
- `pi-runner.ts` 改为调用 Claude Code CLI (`claude -p "..." --allowedTools ...`) 或 Agent SDK (`@anthropic-ai/claude-code` TypeScript SDK / `claude-code-sdk` Python SDK)。
- Agent SDK 的 `query()` 方法可以编程式触发 agent session，替代 Pi 的 session 创建。

**不直接复制**: Pi session 创建 API (`pi.createSession()` 等)。改用 Agent SDK 的 `query()` + hooks 实现等价的 session 生命周期管理。

### 10. Runtime Launcher → Shell 脚本 + claude CLI

**Pi 实现**: `launch-linear-pi-runtime.ps1` 维护独立 runtime checkout，sync master，安装依赖，启动 WezTerm + `pi` 命令。

**Claude Code 承载**:
- Launcher 脚本结构**保留**（checkout sync、依赖安装、WezTerm 启动）。
- 将 `pi` 命令替换为 `claude` CLI 命令。
- 启动参数映射：`claude --model <model> --allowedTools <tools> --permission-mode <mode>`。
- `/reload-master` 等价：shell 脚本执行 git sync + 依赖安装，然后重启 claude session。

**WezTerm 配置**: 保留现有 WezTerm Lua 配置和快捷键绑定，只替换启动命令。

### 11. Audit / Readback → PostToolUse Hook + MCP Server

**Pi 实现**: 
- `state/audit.jsonl` 记录所有 Linear apply 的开始、每个 operation、readback 和结束状态。
- Readback 在每个 mutation 后回读 Linear 对象确认写入成功。
- `observability.ts` extension 提供运行时观测。

**Claude Code 承载**:
- `PostToolUse` hook 匹配 Linear MCP 写入工具，自动记录 audit log。
- MCP server 内部实现 readback 逻辑（mutation 后立即查询确认）。
- Audit log 格式和路径约定保留。

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "mcp__linear.*",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/claude-code-audit-hook.mjs"
          }
        ]
      }
    ]
  }
}
```

### 12. Model Trust Boundary → settings.json + CLI Flag

**Pi 实现**: `.pi/settings.json` 的 `enabledModels` 字段白名单化受信模型，`scripts/config-security-gate.mjs` 阻止通配符。

**Claude Code 承载**:
- `.claude/settings.json` 中不直接等价 `enabledModels`。
- 使用 Claude Code 的 managed policy（组织级）或 CLI `--model` flag 固定模型。
- Subagent 定义中通过 `model` frontmatter 字段指定模型。
- `scripts/config-security-gate.mjs` 适配为检查 `.claude/settings.json` 和 subagent 定义中的 model 约束。

**安全边界保留**: 通过 CI 验证（`npm run validate`）确保配置文件中不出现未审查的模型引用。Runtime 层面依赖 Claude Code 的 authentication 和 subscription 机制限制可用模型。

### 13. Workspace Manifest Sync → MCP Server 或 Skill

**Pi 实现**: `workspace-sync.ts` extension + `scripts/workspace-sync.mjs` 同步 Linear labels、members、workflow states、teams 到本地 manifest。

**Claude Code 承载**: 
- 将 `workspace-sync.mjs` 封装为 MCP server tool，或作为 skill 内的脚本调用。
- Claude Code 原生支持通过 `Bash` 工具执行 Node.js 脚本。
- Manifest 文件路径和格式约定保留。

### 14. Repo-Map Governance → 脚本 + Skill

**Pi 实现**: `repo-map.mjs` / `repo-map-drift.mjs` 实现 repo-map 检测、draft、apply 流程，通过 `pi_ask_user(flow=repo_map)` 收集用户输入。

**Claude Code 承载**:
- 脚本（`repo-map.mjs`、`repo-map-drift.mjs`）**保留**，它们是独立的 Node.js 工具。
- 用户交互从 `pi_ask_user` 改为 Claude Code 原生对话交互（Claude 在 skill 执行中直接询问用户）。
- Skill 定义流程步骤，脚本执行实际操作。

---

## 安全边界总结

| 安全要求 | Pi 实现 | Claude Code 实现 | 等价性 |
|---|---|---|---|
| 默认 dry-run | env + write guard extension | env + `PreToolUse` hook | 等价 |
| 用户确认后写入 | `pi_ask_user(plan_confirmation)` → artifact | 对话确认 → artifact → `PreToolUse` hook 校验 | 等价 |
| 幂等写入 | idempotencyKey + readback | idempotencyKey + readback（逻辑保留） | 等价 |
| 审计日志 | extension 内 audit + `state/audit.jsonl` | `PostToolUse` hook + `state/audit.jsonl` | 等价 |
| Token 不进 Linear/git | SYSTEM.md 约束 + 代码检查 | CLAUDE.md 约束 + hooks + `.claudeignore` | 等价 |
| Model 白名单 | `enabledModels` + config gate | CLI flag + managed policy + CI gate | 等价 |
| Webhook 签名验证 | bridge server HMAC-SHA256 | bridge server HMAC-SHA256（保留） | 不变 |
| Permission deny-first | Pi write guard | Claude Code permission rules deny-first | 更严格 |

**不放宽真实 Linear 写入权限**: 所有现有门禁（`ALLOW_LINEAR_WRITES`、`LINEAR_WRITE_MODE`、artifact 验证、readback、audit）在 Claude Code 实现中保留等价语义。`PreToolUse` hook exit code 2 的阻止能力与 Pi write guard 的 `throw` 等价。

---

## 不直接复制的 Pi 专用实现

以下是 Pi 框架专有的实现细节，在 Claude Code 中没有直接对应物，需要用 Claude Code 原生机制重建：

| Pi 专用实现 | 原因 | Claude Code 替代 |
|---|---|---|
| `pi.registerTool()` | Pi extension API | MCP server `tool` protocol |
| `ctx.ui.confirm()` / `ctx.ui.ask()` | Pi 内置 UI 框架 | hooks + permission rules + CLI 交互 |
| `ctx.hasUI` 运行时检测 | Pi session 属性 | permission mode 配置 + hook 逻辑分支 |
| `ctx.reload()` | Pi hot-reload | session 重启 / `--init` 维护模式 |
| `.pi/sessions/` 状态管理 | Pi session 持久化 | Claude Code 原生 session 管理 |
| Pi compaction 参数调优 | `reserveTokens` / `keepRecentTokens` | Claude Code 原生 compaction（`CLAUDE.md` 自动 survive） |
| `enableSkillCommands` 开关 | Pi settings 字段 | Claude Code skills 默认即 slash commands |
| Pi 主题/样式 | Pi UI 定制 | 不适用（CLI 环境） |

---

## 可复用的行为策略

以下是当前实现中与 Pi 框架无关的行为策略和协议，可直接在 Claude Code 中复用：

| 行为策略 | 承载文件 | 复用方式 |
|---|---|---|
| Fact Pack 输出格式 | `schemas/fact-pack.schema.json` | 保留 schema，skill 内引用 |
| Write plan 结构 | `schemas/` + `scripts/write-plan-builder.mjs` | 保留脚本，MCP/hook 调用 |
| Plan reviewer 规则 | `scripts/plan-reviewer.mjs` | 保留脚本，skill 内调用 |
| ApprovalArtifact 格式 | `scripts/write-confirmation-artifact.ts` | 保留格式，hook 内校验 |
| Audit log 格式 | `state/audit.jsonl` 约定 | 保留格式，hook 内写入 |
| Readback 协议 | `scripts/linear-cli.mjs` 内逻辑 | 保留脚本，MCP server 内调用 |
| 项目描述字段归一化 | `scripts/project-field-normalizer.mjs` | 保留脚本 |
| Workspace manifest 格式 | `scripts/linear-workspace-manifest.mjs` | 保留脚本 |
| Repo-map YAML 格式 | `config/repo-map.yaml` | 保留格式和治理流程 |
| 项目治理模板 | `scripts/project-governance-template.mjs` | 保留脚本 |
| Linear object resolver | `scripts/linear-*-resolver.mjs` | 保留脚本 |
| Config security gate | `scripts/config-security-gate.mjs` | 适配检查目标后保留 |

---

## 迁移顺序

基于依赖关系和阻塞关系，推荐以下迁移顺序：

```
Phase 0: ADR (本文档) ← WEN-301
    │
    ├─→ Phase 1: Runtime launcher + claude CLI 启动 ← WEN-302
    │       输出: launch 脚本、.claude/ 基础结构、能启动 claude session
    │
    ├─→ Phase 2: SYSTEM + skills + prompts 迁移 ← WEN-303
    │       输出: CLAUDE.md、.claude/skills/、.claude/settings.json
    │       依赖: Phase 1 (需要能启动 session 验证)
    │
    ├─→ Phase 3: Fact Pack 重建 ← WEN-304
    │       输出: MCP server 或脚本封装、Linear/GitHub/web 事实采集
    │       依赖: Phase 2 (需要 skills 定义采集流程)
    │
    └─→ Phase 4: 写入治理重建 ← WEN-305
            输出: PreToolUse/PostToolUse hooks、审批 artifact、audit
            依赖: Phase 2 + Phase 3 (需要 plan 流程和事实层)
```

Phase 1–4 在 Phase 0 完成后可并行启动骨架搭建，但完整验证需按依赖顺序。

---

## 决策记录

### D1: MCP server vs. Bash 脚本暴露工具

**决策**: 核心 Linear 操作封装为 MCP server，辅助脚本通过 Bash 工具调用。

**理由**: MCP server 提供结构化的工具描述和参数校验，适合高频使用的 Linear CRUD 操作。辅助脚本（plan-reviewer、workspace-sync 等）调用频率低，通过 Bash 工具 + skill 编排即可，无需额外 MCP 维护成本。

### D2: 写入门禁用 PreToolUse hook 而非 permission rules 实现

**决策**: 使用 `PreToolUse` hook 脚本实现细粒度写入门禁，permission rules 作为外层兜底。

**理由**: Permission rules（allow/deny）只支持工具级别的粗粒度控制。写入门禁需要检查 artifact 有效性、环境变量、plan digest 等运行时状态，这要求脚本级别的逻辑。Hook 脚本 exit code 2 阻止执行的机制与 Pi write guard 的 throw 等价。

### D3: 保留独立 Node.js 脚本而非全部 MCP 化

**决策**: `scripts/` 下的验证、格式化、审计脚本保留为独立 Node.js 模块，通过 hooks 和 Bash 工具调用。

**理由**: 这些脚本已有完善的测试（`npm test`）和 CI 集成。全部 MCP 化会增加维护负担且无法利用现有测试基础设施。保留脚本也使 webhook bridge 可以继续复用相同逻辑。

### D4: Webhook bridge 保留 Express 架构，runner 改用 Agent SDK

**决策**: Bridge server 结构不变，`pi-runner.ts` 改为调用 Claude Code Agent SDK。

**理由**: Bridge server 的 webhook 验签、event dispatch、queue 管理与 Agent 框架无关。只有 runner（启动 Agent session 处理任务）需要从 Pi API 迁移到 Claude Code Agent SDK。

---

## 验证清单

- [x] 覆盖 SYSTEM/skills/prompts/extensions/tools/write guard/webhook/launcher/state 映射
- [x] 明确每项能力使用 CLAUDE.md、.claude settings、skills、subagents、hooks、MCP、CLI 或 SDK 承载
- [x] 标出不直接复制的 Pi 专用实现与可复用的行为策略
