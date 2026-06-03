# ADR-002: M6 写入栈降级前置决策

| 字段 | 值 |
|---|---|
| 状态 | Accepted |
| 日期 | 2026-06-03 |
| 关联 Issue | WEN-312 |
| 阻塞 | WEN-313 ~ WEN-322（M6 全部后续 Issue） |

## 背景

M6 里程碑「架构重构：规划对话化·写入栈降级·全量去重」触碰到 `docs/SCOPE_FREEZE.md` 冻结的层级 2 写入栈（`scripts/linear-apply/*`、4 个手搓 resolver、`@linear/sdk` executor、计划哈希绑定体系、企业级 write-policy 等）。在启动 WEN-313 及后续任务前，必须先完成三项显式决策并记录为 ADR。

---

## 决策 1：解冻 SCOPE_FREEZE

**决定**：解冻 v0.1 范围冻结，允许 M6 写入栈重构进入 repo 变更范围。

**解冻理由**：

- M6 目标是对层级 2 写入栈做结构性降级（MCP 迁移、计划哈希体系退场、builder 合并、policy 收缩），与 v0.1 冻结时的「写入治理稳定验收」假设冲突。
- 继续冻结会阻塞 WEN-313 ~ WEN-322 共 10 个 Issue，且与已接受的 ADR-001（Claude Code 迁移）写入治理保留策略不一致。
- 安全边界（dry-run 默认、confirmed-only、L4/L5 deny、protectedFields）不在解冻范围内删除，仅允许重构实现方式。

**新范围（M6 允许变更）**：

| 区域 | 允许变更 |
|---|---|
| 写入执行栈 | `scripts/linear-apply/*`、4 个 resolver、MCP adapter |
| 写入计划构建 | `write-plan-builder.mjs`、`low-risk-write-plan.mjs` 合并 |
| 确认 UX | `pi-ask-user.ts`、plan_confirmation、legacy write_confirmation 删除 |
| 计划哈希绑定 | 全量删除，以 readback diff 替代（WEN-317） |
| write-policy | 从企业 L0-L5 收缩为 solo 模式（WEN-316） |
| 规划 skill | 重写为五步协作循环（WEN-313） |
| 测试与文档 | 删除随复杂度蒸发的测试，更新至新架构现实（WEN-322） |

**仍冻结（不进入 M6）**：

- OAuth app 全流程、多 workspace SaaS 化、dispatch UI、dashboard、长期 HTTPS endpoint 托管。
- 无确认自动写入、`PI_AUTO_RUN=true` 默认化。
- GitHub MCP 写入型 toolsets 扩展。
- `.env`、token、secret 进 Git 或 Linear。

解冻记录见 `docs/SCOPE_FREEZE.md` 顶部「M6 解冻」节。

---

## 决策 2：写入路径 A/B

**决定**：选定 **路径 A（官方 Linear MCP 推荐）**，拒绝路径 B（瘦身自建 `@linear/sdk`）。

| 维度 | 路径 A：官方 MCP | 路径 B：瘦身 @sdk |
|---|---|---|
| 执行 | Linear MCP `save_*` / `get_*` / `list_*` | 保留 hand-rolled executor + 4 resolver，仅删冗余 |
| 维护 | 官方 schema 演进由 MCP 承担 | 仍需自维护 GraphQL mutation + 分页 resolver |
| 代码量 | T3 阶段 2 净删 ~1500 行 resolver/executor | 仅瘦身，无法达成 M6 去重目标 |
| 风险 | MCP host 可用性、语义差异 | 持续维护负担，与 ADR-001 MCP 方向冲突 |

**路径 A 理由**：

1. 当前手搓栈（4 resolver 739 行 + executor 89 + command 316 + normalize 339）与官方 MCP 能力高度重叠。
2. WEN-319/320 已设计 MCP adapter + 分阶段迁移，路径 B 无法复用该设计。
3. ADR-001 明确 Pi extensions → MCP server 重建方向，路径 A 与之对齐。

---

## 决策 3：T3 分阶段并存安全网

**决定**：**采用** T3 分阶段并存安全网（推荐方案）。

| 阶段 | 行为 | 负责 Issue |
|---|---|---|
| 1 | 新增 MCP adapter，与旧 `@linear/sdk` 并存；`LINEAR_WRITE_BACKEND` 默认 `sdk` | WEN-319 |
| 2 | 测试 workspace 双路径 dry-run 平价比对 | WEN-319 |
| 3 | 平价通过后默认切 `mcp`，旧路径降级为 fallback | WEN-319 |
| 4 | 删除旧 executor + 4 resolver，MCP 为唯一执行路径 | WEN-320 |

**安全网约束**：

- 平价验证通过前，禁止删除旧 `@linear/sdk` 执行栈。
- 任一路径 dry-run 或 real apply 失败时，可回退 `LINEAR_WRITE_BACKEND=sdk`。
- 双路径平价测试必须在隔离测试 workspace 执行，不在生产 workspace 做 A/B 对比写入。

---

## 决策 4：LINEAR_WRITE_BACKEND 策略

**决定**：引入环境变量 `LINEAR_WRITE_BACKEND`，取值 `sdk` | `mcp`。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `LINEAR_WRITE_BACKEND` | `sdk` | M6 阶段 1 默认旧路径；WEN-319 平价通过后改为 `mcp` |
| `LINEAR_WRITE_MODE` | `dry-run` | 不变 |
| `ALLOW_LINEAR_WRITES` | `false` | 不变 |

**切换规则**：

```bash
# 阶段 1（WEN-319 开发/验证）
LINEAR_WRITE_BACKEND=sdk   # 默认，生产等价行为
LINEAR_WRITE_BACKEND=mcp    # 新路径验证

# 阶段 3（WEN-319 平价通过后）
LINEAR_WRITE_BACKEND=mcp    # 新默认
LINEAR_WRITE_BACKEND=sdk    # 紧急 fallback，T3 阶段 2 完成后移除
```

实现细节（adapter 接口、平价测试命令）由 WEN-319 定义；本 ADR 仅锁定策略与默认值时序。

---

## 决策 5：计划哈希绑定退场 → 极简 idempotencyKey + readback diff

**决定**：**计划哈希绑定全量退场**（WEN-317），**保留极简 idempotencyKey** 仅用于审计去重与 replay skip；**审批 artifact 仅绑定 `writePlanPath` + `idempotencyKey`**；**apply 后以 readback diff 校验计划与实际偏差**。

| 机制 | M6 前 | M6 后 |
|---|---|---|
| 计划哈希（sha256(writePlan)） | builder/dry-run/apply 三处校验，绑定确认 artifact | **删除** |
| idempotencyKey | 写入计划 + artifact + audit 去重 | **保留**，降级为朴素字符串（无 hash 派生链） |
| 审批绑定 | writePlanPath + idempotencyKey + 计划哈希 | **仅** writePlanPath + idempotencyKey |
| dry-run 冻结 | 写入 manifest/resolutions 并可能重算计划哈希 | 写入 manifest/resolutions，**不重算**计划哈希 |
| 确认完整性 | 哈希比对防篡改 | apply 后 **readback diff**（计划 vs 实际）告警 |

**理由**：单人 solo 工具不需要企业级防篡改 digest 链；readback diff 足以发现计划与实际偏差（WEN-317 详述）。idempotencyKey 仍用于 `state/audit.jsonl` 去重、`progress.mjs` replay skip 和 artifact store 键，不可删除。

**过渡期（WEN-312 ~ WEN-317）**：现有计划哈希逻辑保持运行直至 WEN-317 合并；本 ADR 提前锁定退场方向，避免 M6 中途再争论。

---

## 决策 6：L4/L5 硬 deny 与 protectedFields 保留

**决定**：**保留** `config/write-policy.yaml` 中 L4/L5 硬 deny 与 `protectedFields` 列表，M6 不做放宽。

```yaml
# 不变 — WEN-316 policy 收缩时不删除以下硬边界
L4:
  description: delete, archive, cancel projects, close many issues
  default: deny
L5:
  description: secrets, tokens, personal sensitive data
  default: deny
protectedFields:
  - token
  - secret
  - password
  - apiKey
  - privateKey
```

WEN-316 仅收缩 L0-L3 的 confirm/require 语义至 solo 模式；L4/L5 deny 与 protectedFields 为不可协商安全边界。

---

## 验收对照（WEN-312）

| 验收项 | 状态 | 证据 |
|---|---|---|
| SCOPE_FREEZE 已解冻 | ✅ | `docs/SCOPE_FREEZE.md` M6 解冻节 |
| 写入路径 A/B 已选定 | ✅ | 本 ADR 决策 2：路径 A |
| LINEAR_WRITE_BACKEND 策略已确认 | ✅ | 本 ADR 决策 4 |
| 计划哈希退场、保留 idempotencyKey + readback diff 已确认 | ✅ | 本 ADR 决策 5 |
| L4/L5 硬 deny 与 protectedFields 保留已确认 | ✅ | 本 ADR 决策 6 + `config/write-policy.yaml` |

---

## 后续 Issue 依赖

```
WEN-312 (本 ADR)
  ├── WEN-313 规划对话化
  ├── WEN-315 builder 合并
  ├── WEN-316 policy 降级（保留 L4/L5）
  ├── WEN-317 计划哈希退场（保留 idempotencyKey，readback diff）
  ├── WEN-318 确认归一
  ├── WEN-319 T3 阶段 1 MCP adapter + 双路径
  ├── WEN-320 T3 阶段 2 删旧栈
  ├── WEN-321 god-file 拆分
  ├── WEN-314 DRY utils
  └── WEN-322 测试文档收敛
```
