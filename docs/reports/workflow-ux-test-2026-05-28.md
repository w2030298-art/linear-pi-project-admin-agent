# Linear Project Admin Runtime 工作流程全量体验复测报告（v2）

日期：2026-05-28  
报告版本：v2，按用户反馈重新测试  
测试性质：高维流程体验测试 + 全管线 / 全 Skill / 全 Plugin 覆盖复测  
是否写入 Linear：本轮复测未新增 Linear mutation；仅执行 dry-run apply。历史真实写入结果仅作为审计链回放证据引用。  
核心目标：验证体验是否顺畅、逻辑是否清晰、操作是否便捷，并补强证据链。

---

## 0. 本轮与上一版的区别

上一版报告主要基于刚完成的 portfolio review 真实链路复盘。用户指出证据链不足，因此本轮重新执行了以下额外测试：

1. **全 Skill 覆盖**：读取并核对 15 个 Skill 文件，包含核心协议、事实采集、规划、架构、Issue 编排、workspace sync、reporting、web research、agent session、governance、create/extend/cycle/portfolio/report 专项技能。
2. **全 Plugin 覆盖**：读取并测试 `.pi/extensions/` 下所有 9 个 extension / guard / observability 文件所对应的工具或行为。
3. **全管线 smoke**：重新执行事实层、workspace sync、project plan review、write plan dry-run、portfolio snapshot、webhook bridge、Linear read、GitHub read、local repo/docs read、web research、TypeScript compile、layout validate。
4. **插件工具实测**：直接调用 Pi tool：`linear_workspace_snapshot`、`linear_get_project_context`、`linear_search_issues`、`github_repo_snapshot`、`github_file_read`、`local_docs_search`、`web_research`、`linear_plan_quality_review`、`workspace_manifest_diff`、`fact_conflict_report`、`linear_apply_write_plan` dry-run。
5. **证据链补强**：本报告将每条结论关联到具体命令、工具、文件或日志。

---

## 1. 总体结论

复测后结论比上一版更明确：

> Runtime 的核心管线已经可运行，安全治理和事实优先逻辑扎实；但产品体验仍偏“专家运维工具”，还不是完全顺手的一键工作流。最大体验短板不是能力缺失，而是不同入口之间的 schema、错误提示、结果摘要和操作前置检查不够统一。

| 维度 | 评分 | 较上一版变化 | 依据 |
|---|---:|---|---|
| 体验顺畅度 | 7.0 / 10 | +0.5 | 复测显示大多数管线可一次运行，但仍有 search / web official / local docs 查询语义问题。 |
| 逻辑清晰度 | 8.8 / 10 | +0.3 | 全 Skill 与全 prompt 均围绕 Fact Pack → Plan → Review → Dry-run → Confirm → Readback 展开。 |
| 操作便捷度 | 6.0 / 10 | +0.5 | CLI 与工具入口可用，但用户仍需要理解 dry-run、confirmed-only、operations schema。 |
| 安全可信度 | 8.8 / 10 | +0.3 | write guard、dry-run apply、audit、readback 均实际验证；本轮未越权写入。 |
| 可观测性 | 8.3 / 10 | +0.3 | audit log、Fact Pack、snapshot、tool outputs 完整，但缺人类可读 apply/audit summary。 |
| 错误可恢复性 | 6.5 / 10 | +0.5 | 问题可定位，但部分错误仍需 Agent 自行解释，工具原始反馈不够直接。 |

---

## 2. 测试证据总览

### 2.1 本轮 Fact Pack

| 项 | 结果 |
|---|---|
| Governance/report Fact Pack | `state/fact-packs/fact-5dfb8ae39efd.json` |
| Full pipeline smoke Fact Pack | `state/fact-packs/fact-162ff17d8670.json` |
| full smoke 输入 | `workflow full pipeline smoke --linear c642b249... --repo linear-pi-project-admin-agent` |
| Fact Pack 结果 | 成功，包含 Linear project context、GitHub repo snapshot、local repo snapshot |
| evidence gaps | full smoke 中为 `[]` |
| conflict | 本地 repo dirty，与 GitHub remote 主线需区分 |

### 2.2 关键只读证据

| 来源 | 证据 |
|---|---|
| Linear live | `linear_workspace_snapshot` 成功返回 teams、labels、users、projects、cycles、workflowStates |
| Linear project | `linear_get_project_context(c642b249...)` 成功读取项目、milestones、updates、issues |
| GitHub remote | `github_repo_snapshot(w2030298-art/linear-pi-project-admin-agent)` 成功，default branch `master`，public repo |
| GitHub file | `github_file_read(README.md)` 成功读取远端 README |
| Local repo | `npm run fact:local` 成功，branch `master`，commit `ce72f3d...`，dirty=true |
| Local docs | `local_docs_search("Linear")` 成功返回 docs 下多份文档 |
| Web | `web_research(... includeDomains=[linear.app])` 成功返回 Linear 官方 docs |
| Audit | `state/audit.jsonl` 有 apply start / operation / end / readback 记录 |

---

## 3. 全 Skill 覆盖测试

### 3.1 已加载 / 已读取的 Skill

| Skill | 路径 | 覆盖方式 | 结果 |
|---|---|---|---|
| linear-admin-core | `.agents/skills/00-linear-admin-core/SKILL.md` | 读取并用于测试框架 | 通过 |
| fact-ingestion | `.agents/skills/10-fact-ingestion/SKILL.md` | 读取 + `fact_pack_build` / CLI Fact Pack | 通过 |
| project-planning | `.agents/skills/20-project-planning/SKILL.md` | 读取 + project-plan sample review | 通过 |
| architecture-decomposition | `.agents/skills/30-architecture-decomposition/SKILL.md` | 读取 + GitHub/local/docs evidence 验证 | 通过 |
| issue-orchestration | `.agents/skills/40-issue-orchestration/SKILL.md` | 读取 + write-plan sample review/apply dry-run | 通过 |
| workspace-sync | `.agents/skills/50-workspace-sync/SKILL.md` | 读取 + `workspace_manifest_diff` + CLI sync | 通过 |
| evidence-based-reporting | `.agents/skills/60-evidence-based-reporting/SKILL.md` | 读取 + project context/report evidence | 通过 |
| web-research | `.agents/skills/70-web-research/SKILL.md` | 读取 + CLI/tool web search | 通过，有 official filter caveat |
| linear-agent-session | `.agents/skills/80-linear-agent-session/SKILL.md` | 读取 + bridge startup + webhook signature test | 部分通过，未做真实 Linear webhook delivery |
| governance | `.agents/skills/90-governance/SKILL.md` | 读取 + 本报告 + manifest/audit/dirty 检查 | 通过 |
| create-linear-project | `.agents/skills/create-linear-project/SKILL.md` | 读取 + referenced templates + project-plan sample | 通过 |
| extend-linear-project | `.agents/skills/extend-linear-project/SKILL.md` | 读取 + referenced templates + project context baseline | 通过 |
| linear-cycle-planning | `.agents/skills/linear-cycle-planning/SKILL.md` | 读取 + workspace cycles / portfolio snapshot | 部分通过，未执行真实 cycle reassignment |
| linear-portfolio-review | `.agents/skills/linear-portfolio-review/SKILL.md` | 读取 + portfolio snapshot + previous real apply audit | 通过 |
| linear-project-report | `.agents/skills/linear-project-report/SKILL.md` | 读取 + project context + status update evidence | 通过 |

### 3.2 Skill 模板引用测试

读取了 create/extend/report 共同引用的模板：

- `.agents/skills/create-linear-project/references/templates.md`

覆盖内容：

- 需求规格包模板。
- 技术架构规格模板。
- ADR 模板。
- Project description 模板。
- Issue 描述模板。
- 首条项目状态更新模板。

结论：模板完整，能支撑 create / extend / report 三类规划产出。

### 3.3 Skill 层体验判断

优点：

- Skill 分层清晰：核心协议、事实层、规划、架构、Issue、workspace、reporting、governance、专项任务各司其职。
- 所有 Linear 管理任务都能落到一致的事实优先和 dry-run 写入协议。

不足：

- Skill 是提示/流程资产，不是可单独执行的自动化测试对象；目前只能通过读取、命令 smoke 和工具调用间接验证。
- `linear-cycle-planning` 的「rollover / auto-add 来源审计」受限于当前工具不能读取完整 Linear activity/history，因此只能部分验证。
- create/extend/project-report 的模板是共享的，但路径引用对 Agent 来说需要手动 follow，最好在 validate 脚本中自动检查引用文件存在。

---

## 4. Slash Prompt 覆盖测试

### 4.1 已发现 Prompt

命令：`find .pi/prompts -maxdepth 1 -type f`

结果：

| Prompt | 目标 | 结果 |
|---|---|---|
| `create-project.md` | 新建项目规划 | 存在，可读 |
| `extend-project.md` | 扩展已有项目 | 存在，可读 |
| `fact-pack.md` | 建立 Fact Pack | 存在，可读 |
| `portfolio-review.md` | 全局项目巡检 | 存在，可读 |
| `cycle-plan.md` | Cycle 规划 | 存在，可读 |
| `project-report.md` | 项目报告 | 存在，可读 |
| `workspace-sync.md` | workspace manifest 同步 | 存在，可读 |
| `issue-dispatch.md` | Issue 派发 prompt | 存在，可读 |

### 4.2 Prompt 体验判断

优点：

- 每个 prompt 都有明确目标和必须读取的事实来源。
- Prompt 与 Skill 能对应起来，用户语义入口比较清晰。

不足：

- 当前测试环境无法直接模拟 Pi TUI slash prompt 选择，只能通过文件读取和底层工具验证。
- `issue-dispatch.md` 是手工复制给 coding agent 的模板，和 Linear-native 自动派发之间还未完全闭环。

建议：

- 增加 `npm run test:prompts`，检查每个 prompt 是否能映射到一个 Skill、一个 Fact Pack 策略和一个写入策略。

---

## 5. 全 Plugin / Extension 覆盖测试

### 5.1 Extension 文件清单

命令：`find .pi/extensions -maxdepth 1 -type f`

| Extension | 作用 | 覆盖方式 | 结果 |
|---|---|---|---|
| `fact-source-router.ts` | `fact_pack_build` / `fact_conflict_report` | tool 调用 + CLI Fact Pack | 通过 |
| `github-evidence.ts` | GitHub repo/file evidence | `github_repo_snapshot` / `github_file_read` | 通过 |
| `linear-admin-tools.ts` | Linear workspace/project/search/apply | 全部对应工具调用 | 通过，search 有语义 caveat |
| `linear-plan-reviewer.ts` | deterministic plan review | `linear_plan_quality_review` + CLI review | 通过 |
| `linear-write-guard.ts` | write guard | `linear_apply_write_plan` dry-run + 历史真实 apply | 通过，但错误文案需优化 |
| `local-repo-docs.ts` | local repo/docs evidence | `local_repo_snapshot` / `local_docs_search` | 通过，query 语义有 caveat |
| `observability.ts` | audit log hooks | `state/audit.jsonl` tool events / apply events | 通过 |
| `web-research.ts` | Tavily/Brave web evidence | `web_research` tool + CLI web search | 通过，CLI official filter caveat |
| `workspace-sync.ts` | manifest diff | `workspace_manifest_diff` | 通过 |

### 5.2 Plugin 工具实测结果

| Tool | 输入 | 结果 | 体验评价 |
|---|---|---|---|
| `linear_workspace_snapshot` | `{}` | 成功，含 projects/cycles/workflowStates | 好，已比早期 workspace summary 更完整 |
| `linear_get_project_context` | `c642b249...` | 成功，返回完整 project context | 信息完整但输出巨大 |
| `linear_search_issues` | query=`WEN-239` | 返回 WEN-241 | 可用但不适合精确 identifier 查询 |
| `linear_apply_write_plan` | `examples/write-plan.sample.json`, dryRun=true | 成功编译 3 个 operations，无写入 | 好，能验证 write guard/apply pipeline |
| `linear_plan_quality_review` | `examples/write-plan.sample.json` | pass | 好 |
| `workspace_manifest_diff` | writeDraft=true | 成功，unmappedLabels=[] | 好 |
| `fact_pack_build` | governance/report 与 full smoke | 成功 | 好 |
| `fact_conflict_report` | `fact-162ff17d8670.json` | 成功，指出 local dirty conflict | 好 |
| `github_repo_snapshot` | repo master | 成功 | 好 |
| `github_file_read` | README.md | 成功 | 好 |
| `local_repo_snapshot` | root 当前仓库 | 成功，dirty=true | 好 |
| `local_docs_search` | query=`Fact Pack write guard dry-run operations` | 0 结果 | 查询召回不稳定 |
| `local_docs_search` | query=`Linear` | 返回多份 docs | 可用但依赖 query 命中 |
| `web_research` | Linear official docs + includeDomains | 成功，返回 linear.app 官方结果 | 好 |

---

## 6. 全管线命令复测

### 6.1 基础仓库 / 类型 / 布局

| 命令 | 结果 | 证据摘要 |
|---|---|---|
| `npm run validate` | 通过 | `{ ok: true, missing: [] }` |
| `npx tsc --noEmit` | 通过 | 无输出，退出成功 |
| `git diff --check` | 通过但有换行 warning | 仅 LF→CRLF warning，无 whitespace error |

体验判断：基础工程入口顺畅。`git diff --check` warning 不阻断，但对用户会造成噪音，建议统一 `.gitattributes`。

### 6.2 Plan / Write Plan reviewer 管线

| 命令 | 结果 | 证据摘要 |
|---|---|---|
| `npm run test:plan-review` | 通过 | `plan reviewer tests passed` |
| `npm run plan:review -- examples/project-plan.sample.json --strict` | 通过 | `status: pass`, `executedMutation: false` |
| `npm run plan:review -- examples/write-plan.sample.json --strict` | 通过 | `status: pass`, `executedMutation: false` |
| `linear_plan_quality_review(examples/write-plan.sample.json)` | 通过 | `status: pass`, `findings: []` |

体验判断：计划质量检查稳定，是当前最顺的管线之一。

### 6.3 Linear 事实层管线

| 命令 / 工具 | 结果 | 证据摘要 |
|---|---|---|
| `npm run linear:smoke` | 通过 | viewer 可读 |
| `npm run linear:workspace` | 通过 | 1 team、21 labels、5 users、projects、cycles、workflowStates |
| `linear_workspace_snapshot` | 通过 | 同样返回 workspace summary |
| `linear_get_project_context` | 通过 | 成功读取项目和 11 个 issues |
| `linear_search_issues` | 部分通过 | query WEN-239 返回 WEN-241，说明是全文搜索不是 exact lookup |

体验判断：读取能力强，但需要增加 exact issue lookup 工具，否则用户按 Issue ID 搜索会困惑。

### 6.4 GitHub 事实层管线

| 命令 / 工具 | 结果 | 证据摘要 |
|---|---|---|
| `npm run fact:repo -- --owner ... --repo ...` | 通过 | repo public，defaultBranch master，README sha 返回 |
| `github_repo_snapshot` | 通过 | 同上 |
| `github_file_read README.md` | 通过 | 远端 README 完整返回 |

体验判断：GitHub REST fallback 可用。当前 open PR / workflowRuns 为空，属于事实而不是失败。

### 6.5 Local repo/docs 管线

| 命令 / 工具 | 结果 | 证据摘要 |
|---|---|---|
| `npm run fact:local` | 通过 | branch master, commit ce72f3d, dirty=true |
| `local_repo_snapshot` | 通过 | 同上 |
| `local_docs_search("Linear")` | 通过 | 返回 DEPLOYMENT、FACT_SOURCES、OPERATIONS 等 |
| `local_docs_search("Fact Pack write guard dry-run operations")` | 0 结果 | 精确复合 query 召回不足 |

体验判断：本地事实可用，但 docs search 需要更好的分词 / 多关键词召回。

### 6.6 Web research 管线

| 命令 / 工具 | 结果 | 证据摘要 |
|---|---|---|
| `web_research(... includeDomains=[linear.app])` | 通过 | 返回 `linear.app/developers/graphql`、`linear.app/docs/api-and-webhooks` |
| `npm run fact:web -- --query ... --official` | 通过但有 caveat | 结果中仍包含非官方 rollout.com |

体验判断：tool 级 includeDomains 比 CLI `--official` 更可靠。CLI official filter 需要修复或改名为 “prefer official”。

### 6.7 Fact Pack 管线

| 命令 / 工具 | 结果 | 证据摘要 |
|---|---|---|
| `fact_pack_build` governance/report | 通过 | `fact-5dfb8ae39efd.json` |
| `npm run fact:pack -- --task "workflow full pipeline smoke" --linear ... --repo ...` | 通过 | `fact-162ff17d8670.json`，evidenceGaps=[] |
| `fact_conflict_report(fact-162...)` | 通过 | 指出 local dirty conflict |

体验判断：Fact Pack 管线可用。带 `--linear` 和 `--repo` 时证据链明显更充分；不带目标时 evidence gap 容易泛化。

### 6.8 Workspace sync 管线

| 命令 / 工具 | 结果 | 证据摘要 |
|---|---|---|
| `node scripts/workspace-sync.mjs --write-draft` | 通过 | `unmappedLabels: []`, `newTeams: []`, draft path 存在 |
| `workspace_manifest_diff(writeDraft=true)` | 通过 | 同上 |

体验判断：体验顺畅。当前 manifest 与 Linear 无明显 drift。

### 6.9 Portfolio review 管线

| 命令 / 工具 | 结果 | 证据摘要 |
|---|---|---|
| `node state/portfolio-review/build-portfolio-snapshot.mjs` | 通过 | 扫描 7 active projects，1 inactive excluded |
| `npm run test:linear-snapshot` | 通过 | 覆盖 Duplicate、relation direction、Cycle open/high-open/blocked |
| 历史真实 apply audit | 通过 | 6/6 issue.update to Ready，readback 成功 |

体验判断：portfolio snapshot 现在稳定。建议继续将其封装为正式 Pi tool，减少脚本路径暴露。

### 6.10 Cycle planning 管线

已验证部分：

- `linear-cycle-planning` Skill 已读取。
- `cycle-plan.md` Prompt 已读取。
- `linear_workspace_snapshot` 返回 Cycle #1/#2/#3。
- portfolio snapshot 可统计 Cycle issueCount/open/highOpen/blocked。

未完全验证部分：

- 未读取 Linear 原生 Cycle 自动化设置（rollover / auto-add / capacity graph）。
- 未执行真实 cycle assignment dry-run write plan。
- 未验证 Issue activity/history 判断 rollover 来源。

体验判断：Cycle planning 的语义规则清楚，但数据入口还不完整。该管线属于**部分通过**。

### 6.11 Project report 管线

已验证：

- `linear-project-report` Skill 已读取。
- `project-report.md` Prompt 已读取。
- `linear_get_project_context` 成功读取目标 Project 的 milestones、issues、project updates。
- `evidence-based-reporting` Skill 已读取。

未执行：

- 未生成并发布 Linear Project Update；本轮无写入授权，也不应写入。

体验判断：报告生成所需基础数据可用。主要体验风险是 `linear_get_project_context` 输出过大，需要摘要化。

### 6.12 Linear Agent Session / Bridge 管线

| 命令 / 工具 | 结果 | 证据摘要 |
|---|---|---|
| `npm run test:webhook-signature` | 通过 | 真签名 accepted，假签名 rejected，timestamp 检查通过 |
| `timeout 8s npm run bridge:dev` | 通过启动 | `linear-pi-bridge listening on 8787` |
| `linear-agent-session` Skill | 已读取 | 入口、行为、dry-run comment、approve 后写入规则存在 |

未完全验证：

- 未从真实 Linear webhook 发送 delivery 到本地 bridge。
- 未验证 Agent:* label 到 queue item 的完整 E2E。
- 未验证 Pi runner 后续接管任务。

体验判断：bridge 基础可启动，签名逻辑通过；Linear-native 唤醒仍是**半链路验证**，需要真实 webhook 环境补测。

### 6.13 Write Guard / Apply 管线

| 测试 | 结果 | 证据摘要 |
|---|---|---|
| `linear_apply_write_plan(examples/write-plan.sample.json, dryRun=true)` | 通过 | 编译 3 个 operations，未写入 |
| 历史真实 `portfolio-review-2026-05-28-conservative-ready-batch` | 通过 | 6/6 issue.update，readback 成功，audit 完整 |
| `state/audit.jsonl` | 通过 | 存在 apply start / each operation / apply end |

体验判断：真实写入链路已证明可用；但 schema 和确认语义仍需要产品化封装，避免用户重复确认与排障。

---

## 7. 关键体验发现

### 7.1 顺畅的部分

1. **读事实来源很顺**：Linear、GitHub、local、web 都能在当前环境读取。
2. **Fact Pack 充分性提升明显**：带 `--linear` 和 `--repo` 后 evidence gaps 为空。
3. **Plan reviewer 稳定**：project-plan / write-plan sample 均通过 strict review，且不执行 mutation。
4. **Workspace sync 稳定**：manifest diff 无 unmapped labels / newTeams。
5. **Portfolio snapshot 已工程化**：能扫描 7 个 active projects，并有回归测试覆盖复杂规则。
6. **Write apply dry-run 体验较好**：能展示 operations、resolved labelIds/teamId/stable UUID。

### 7.2 不顺畅的部分

1. **Issue search 语义不直观**：搜索 `WEN-239` 返回 WEN-241，说明 `linear_search_issues` 是全文 contains，而不是 identifier exact lookup。
2. **Web official filter 不一致**：tool 使用 `includeDomains` 可以锁定 linear.app；CLI `--official` 仍返回非官方站点。
3. **Local docs search 召回不稳定**：复合查询 `Fact Pack write guard dry-run operations` 返回 0，但单词 `Linear` 能召回大量文档。
4. **Project context 输出过大**：适合机器，不适合直接给用户阅读。
5. **Cycle planning 数据未完全闭环**：缺少 rollover / auto-add / capacity graph / issue activity 来源。
6. **写入计划体验仍依赖 schema 知识**：用户不应该理解 `operations`、`confirmedByUser`、`dryRun=false`、`ALLOW_LINEAR_WRITES` 的组合逻辑。

---

## 8. 风险与缺口

| 风险 / 缺口 | 等级 | 说明 | 建议 |
|---|---|---|---|
| Write Plan schema 仍可能被写成旧 `mutations` | P0 | 上一轮已真实踩坑 | 所有生成器统一输出 `operations`；reviewer 拒绝 `mutations` |
| `linear_search_issues` 不适合按 ID 精确查找 | P1 | query `WEN-239` 返回 WEN-241 | 新增 `linear_get_issue(identifierOrId)` |
| CLI web `--official` 不能强制过滤官方域 | P1 | 返回 rollout.com | 修复过滤逻辑或改名 `--prefer-official` |
| local docs search 缺少分词/多关键词召回 | P1 | 精确复合 query 0 结果 | 增加 tokenization、OR matching、score 排序 |
| Cycle planning 缺少 Linear automation baseline | P1 | rollover/auto-add/capacity 不可证 | 扩展 Linear query 或标注为不可读取 |
| Project context/readback 输出太长 | P2 | 对话噪音大 | 返回 summary + detailsPath |
| audit log 人类不可读 | P2 | JSONL 复查成本高 | 自动生成 audit summary markdown |
| local repo dirty 持续存在 | P2 | GitHub remote 与 local working copy 事实冲突 | 报告中持续区分 local vs remote，必要时 commit/push |

---

## 9. 推荐改进路线

### P0：写入体验统一

- 所有 write plan 生成器只输出 `operations`。
- `linear_plan_quality_review` 对 `mutations` 给出明确错误。
- apply 前输出 preflight：

```json
{
  "planPath": "...",
  "confirmedByUser": true,
  "planDryRun": false,
  "LINEAR_WRITE_MODE": "confirmed-only",
  "ALLOW_LINEAR_WRITES": true,
  "willWrite": true
}
```

### P1：检索工具补齐

- 新增 `linear_get_issue`：支持 exact identifier / UUID。
- 改造 `local_docs_search`：复合查询分词召回。
- 修复 `web-search.mjs --official`：严格过滤官方域，或明确叫 prefer official。

### P1：Portfolio / Cycle 一等工具化

- 将 `build-portfolio-snapshot.mjs` 封装为 `linear_portfolio_snapshot` tool。
- Cycle planning 增加 automation baseline 字段：
  - rollover 可观察性。
  - auto-add 设置可观察性。
  - capacity / graph 是否可读取。

### P2：结果摘要产品化

- `linear_get_project_context` 返回摘要 + `detailsPath`。
- `linear_apply_write_plan` 返回：
  - summary table。
  - full readback path。
  - rollback plan path。
- 每次 apply 自动生成 `state/audit-reports/<idempotencyKey>.md`。

---

## 10. 最终评价

本轮复测覆盖了：

- 15 个 Skill。
- 8 个 slash prompt。
- 9 个 Pi extension / plugin。
- Linear / GitHub / local repo / local docs / web / Fact Pack / workspace sync / portfolio snapshot / plan review / webhook bridge / write guard / audit 等主要管线。

更充分证据链表明：

1. **能力链路是成立的**：事实采集、规划审查、workspace sync、portfolio snapshot、dry-run apply、真实 apply 回读都有可复现证据。
2. **体验链路还有摩擦**：尤其是检索语义、write plan schema、preflight、结果摘要。
3. **最高优先级不是继续加能力，而是统一交互契约**：让用户不需要理解内部 schema 和环境开关，也能知道“现在会不会真的写入”。

一句话结论：

> 这是一个已经可运行、可审计、可治理的 Linear 项目管理员 Runtime；下一阶段应把“专家级安全工具”打磨成“确认一次即可顺滑执行、失败原因一眼可懂”的产品化工作流。
