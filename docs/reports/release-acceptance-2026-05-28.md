# v0.1 上线验收报告

日期：2026-05-28  
覆盖 Linear issues：WEN-247、WEN-252、WEN-255、WEN-256；补充 WEN-257、WEN-258  
本地基线 commit：`ce72f3de35a9255df979aec210f29f068e97e591`

## 验收命令

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm run validate` | 通过 | `ok: true`, `missing: []` |
| `npm run test:plan-review` | 通过 | `plan reviewer tests passed` |
| `npm run plan:review -- examples/project-plan.sample.json --strict` | 通过 | `status: pass`, `findings: []`, `executedMutation: false` |
| `npm run plan:review -- examples/write-plan.sample.json --strict` | 通过 | `status: pass`, `findings: []`, `executedMutation: false` |
| `npm run linear:smoke` | 通过 | Linear viewer 可读取，`sourceType: linear_live` |
| `npm run linear:workspace` | 通过 | 读取 1 个 team、21 个 labels、5 个 users |
| `node scripts/workspace-sync.mjs --write-draft` | 通过 | `unmappedLabels: []`, `newTeams: []` |
| `npm run fact:pack -- --task "smoke test"` | 通过 | 输出 `facts`、`conflicts`、`evidenceGaps`、`planningImplications` |
| `node scripts/fact-pack.mjs --task "smoke test" --web` | 通过 | Web provider 为 Tavily，输出 web evidence |
| `npm run test:webhook-signature` | 通过 | 真签名通过、假签名拒绝、当前 timestamp 通过、过期 timestamp 拒绝 |
| `node state/portfolio-review/build-portfolio-snapshot.mjs` | 通过 | 输出 `state/portfolio-review/portfolio-snapshot-2026-05-28.json`，扫描 7 个 active projects |
| `npm run test:linear-snapshot` | 通过 | 覆盖 Duplicate 终态、relation 方向、Cycle open/high-open/blocked 统计，以及 workspace projects/cycles/workflowStates 输出 |
| `npm run test:retrieval-ux` | 通过 | 覆盖 docs 复合查询 tokenized 召回、official web 域过滤、Linear Issue exact lookup 识别 |
| `node scripts/linear-cli.mjs issue WEN-258` | 通过 | exact identifier lookup 返回 WEN-258，不使用全文 contains 搜索语义 |
| `node scripts/local-evidence.mjs docs --query "Fact Pack write guard dry-run operations"` | 通过 | 返回 `tokens`、`score`、`matchedTokens`，复合查询可召回 docs |
| `npm run fact:web -- --query "Linear GraphQL API official docs" --official --max 5` | 通过 | `officialDomains: ["linear.app"]`，结果 URL 均为 `linear.app` |
| `npx tsc --noEmit` | 通过 | TypeScript 编译检查无错误 |
| `git diff --check` | 通过 | 仅出现 Windows LF/CRLF 提示，无 whitespace error |

## 流程验证

- `/workspace-sync`：脚本 fallback 已验证，生成 `state/workspace.manifest.draft.json`；manifest 已补入 `repo:linear-pi-project-admin-agent`，当前无 unmapped labels。
- `/portfolio-review`：portfolio snapshot 生成脚本已验证；脚本现在会加载仓库 `.env`，不需要额外 `node -r dotenv/config`。
- `linear_workspace_snapshot` / `npm run linear:workspace`：现在包含 projects、cycles、workflowStates，避免 portfolio review 依赖超大的单项目上下文输出。
- Linear relation 方向已固化到回归测试：`relations(type=blocks)` 表示当前 Issue blocks 其他 Issue，`inverseRelations(type=blocks)` 表示当前 Issue blocked by 其他 Issue。
- `/cycle-plan`：`.pi/prompts/cycle-plan.md` 存在；运维手册明确 current / next Cycle 纳入规则。
- 状态更新机制：`docs/OPERATIONS.md` 已提供可复用 Project Update 模板，WEN-256 本次 Linear 同步使用同一结构。
- 检索入口：WEN-258 将 exact Issue lookup、local docs tokenized search、CLI official web filter 固化为脚本与 Pi tool 入口，避免把全文搜索误当成精确查询。

## 明确缺口

- Fact Pack smoke 未传入 `--linear`，因此报告中保留 “No Linear project key/id provided” evidence gap；这不影响脚本能力，只说明该 smoke 是通用任务。
- Fact Pack 记录 local repo `dirty: true`，原因是本次 WEN-247/WEN-252/WEN-255/WEN-256 的未提交工作树改动。
- OAuth app、permanent HTTPS endpoint、dispatch UI、dashboard、多 workspace SaaS 化保留为 vNext / Later。
