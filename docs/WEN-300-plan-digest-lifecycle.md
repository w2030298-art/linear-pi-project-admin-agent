# WEN-300：planDigest 生命周期导致一次写入出现多次计划确认

> 本文档只记录问题现状、真实体验与逻辑链条，**不提出修复方案**。
> 相关 issue：[WEN-300](https://linear.app/wentaoxu-personal-workplace/issue/WEN-300)

## 摘要

Linear 写入协议承诺「用户对 exact dry-run plan 做一次最终确认」，但当前框架在 builder、dry-run、apply 三个阶段对 `planDigest` 的权威性不一致。用户在 UI 上确认的是「计划意图」，系统校验的是「某一阶段的精确 digest」。当 pre-dry-run digest 的 approval artifact 已存在却不能 apply 时，同一 `writePlanPath` / `idempotencyKey` 的再次确认会被 `duplicate_confirmation` 阻断，Agent 只能重新生成 v2 write plan，导致同一写入意图经历多次 plan confirmation。

## WEN-299 创建链条复盘

以下链条来自创建 WEN-299 时的真实体验（2026-06-02）。

| 阶段 | 事件 | planDigest / 状态 |
|------|------|-------------------|
| 1. Builder | `write-plan-builder` 生成 write plan | `sha256:84c13d…`（pre-dry-run） |
| 2. Quality review | 通过 | 不变 |
| 3. Dry-run | `linear_apply_write_plan(dryRun=true)` 固化 manifest/resolutions | `sha256:3f0529…`（post-dry-run，同一文件） |
| 4. Plan confirmation | Agent 用 builder 返回的 pre-dry-run digest 调用 `pi_ask_user(plan_confirmation)` | artifact 绑定 `84c13d…` |
| 5. Real apply | 安全门禁校验 artifact vs 当前 write plan | `plan_digest_mismatch`，写入被拦截 |
| 6. 再次确认 | 用 post-dry-run digest 对同一 path/key 重试 | `duplicate_confirmation` |
| 7. v2 write plan | 新建 `…-v2.json`，dry-run 后用户再次确认 | `sha256:695ab1…`，apply 成功 |

**结论**：用户主观上只同意「创建 WEN-299」一次意图，但框架状态机要求两次 plan confirmation 才能完成一次真实写入。

## 三阶段 digest 状态冲突点

### Builder 阶段（`scripts/write-plan-builder.mjs`）

- 基于 operations、project、source 等字段计算 `planDigest`。
- 此时 write plan **不含** `manifestHash`、`manifestPath`、`resolutions` 等 dry-run 冻结字段。
- Builder 返回的 `workflow.approval.params.planDigest` 即此 pre-dry-run digest。
- Builder 编排提示顺序为：quality review → dry-run → **plan_confirmation（使用 builder digest）** → apply。

### Dry-run 阶段（`scripts/linear-workspace-manifest.mjs` → `freezePlanManifest`）

- `linear_apply_write_plan(dryRun=true)` 调用 `freezePlanManifest`，向同一 write plan 文件写入：
  - `manifestHash`、`manifestPath`、`manifestCompleteness`
  - 各 operation 的 `resolutions`
- 随后 **重新计算** `planDigest` 并持久化到同一 `writePlanPath`。
- 审计事件：`linear_apply_manifest_compile`，记录新的 `planDigest`。

### Apply 阶段（`scripts/write-confirmation-artifact.ts` + `scripts/linear-apply/command.mjs`）

- Real apply 读取 write plan 文件中的 **当前** `planDigest`（post-dry-run）。
- `consumeWriteConfirmationArtifact` 严格比对 artifact 绑定的 `planDigest` 与 apply 参数中的 `planDigest`。
- 不一致时返回 `plan_digest_mismatch`，审计事件：`linear_apply_artifact_validation`，`ok=false`。

**核心冲突**：dry-run 在概念上是「验证步骤」，但在实现上会 **改变** approval binding 所依赖的 write plan digest；builder 编排提示却仍将 pre-dry-run digest 作为确认对象传给 Agent。

## 为何不可 apply 的 artifact 仍导致 duplicate_confirmation

Artifact store 键为 `writePlanPath::idempotencyKey`（见 `write-confirmation-artifact.ts` 中 `artifactKey`）。

`registerWriteConfirmationArtifact` 逻辑：

1. 若同一 key 下已存在 **未使用且未过期** 的 artifact → 抛出错误。
2. `pi_ask_user` 捕获后返回 `status: duplicate_confirmation`。
3. **不区分** artifact 绑定的 `planDigest` 是否与当前 write plan 一致。
4. **不区分** 该 artifact 是否曾导致 `plan_digest_mismatch` 而被 apply 拒绝。

因此：第一次确认创建的 artifact（绑定 pre-dry-run digest）虽然无法通过 apply 校验，但仍占用该 key 的「pending confirmation」槽位，阻止同一计划用正确 digest 再次确认。

Agent 在不绕过安全门禁的前提下，只能：

- 更换 `writePlanPath`（如生成 `-v2.json`），或
- 更换 `idempotencyKey`

才能发起新的 plan confirmation——这从用户视角等同于「同一意图被要求确认多次」。

## 用户视角

| 用户感知 | 系统实际处理 |
|----------|--------------|
| 看到结构化计划摘要，点击「Yes」同意创建 WEN-299 | artifact 绑定的是 builder 阶段的 digest，而非 dry-run 后文件中的 digest |
| 认为已完成「一次最终确认」 | apply 阶段校验的是 post-dry-run digest，与 artifact 不匹配 |
| 被要求再次确认 v2 计划 | 并非用户误操作，而是 digest 漂移 + artifact 去重规则的组合结果 |
| UI 未暴露 digest 变化或 artifact 不可用原因 | 需查 audit、`write-plans/` 文件、artifact store 才能理解 |

用户无法从确认 UI 判断：这是安全门禁、digest 漂移、pending artifact，还是 Agent 重复提交。

## Agent 视角

Agent 遵循「build plan → quality review → dry-run → plan_confirmation → apply」协议时面临结构性冲突：

1. **Builder 返回值**：`planDigest` 与 `workflow.approval.params.planDigest` 均为 pre-dry-run 值；编排提示在 dry-run **之后**调用 plan_confirmation，却引用 builder digest。
2. **Dry-run 返回值**：包含 post-dry-run `planDigest`，但 builder workflow 未将其作为唯一确认对象。
3. **安全协议**：「不要二次确认」与「不能绕过 plan_digest_mismatch 门禁」不可同时满足——第一次确认无效，第二次确认被 duplicate 阻断。
4. **唯一合规路径**：生成 v2 write plan（新 path 或新 idempotencyKey），再次 dry-run 与 plan_confirmation。

严格遵守安全协议反而可能触发重复确认；不重复确认则无法真实写入。

## 审计可见性

相关审计事件类型：

- `linear_apply_manifest_compile`：dry-run 后 digest 变化
- `linear_apply_artifact_validation`：`plan_digest_mismatch` 时 `ok=false`
- `pi_ask_user` 返回：`duplicate_confirmation`

这些结构性状态 **未** 在 plan confirmation UI 中自然暴露；排查成本转移给用户与 Agent。

## 问题影响

- 降低用户对 `plan_confirmation`「一次最终确认」语义的信任。
- 低风险单次 issue 创建场景下，重复确认尤为明显。
- Agent 在「不要二次确认」与「不能绕过安全门禁」之间陷入结构性冲突。
- Artifact store 对「已确认但无法 apply」与「可继续确认的同一计划」无清晰状态区分。

## 本文不包含

- 修复方案或实现路径。
- 放宽 approval artifact、planDigest、dry-run、readback 或 audit 安全边界的建议。
- 对用户误操作或 Agent 文案选择的归因。

## 验收对照（问题状态说明）

- [x] 能复盘 WEN-299 创建链条中为何同一写入意图经历多次 plan confirmation。
- [x] 能指出 builder digest、dry-run digest、apply digest 的状态冲突点。
- [x] 能解释不可 apply 的 approval artifact 为何仍导致 `duplicate_confirmation`。
- [x] 能从用户视角描述「同意同一计划」与系统处理为不同确认对象的原因。
- [x] 能从 Agent 视角描述严格遵守安全协议为何被迫重新生成 v2 write plan。

## 相关代码入口

- Builder digest：`scripts/write-plan-builder.mjs`（`buildWritePlan`、`buildWorkflow`）
- Dry-run digest 重算：`scripts/linear-workspace-manifest.mjs`（`freezePlanManifest`）
- Artifact 注册与去重：`scripts/write-confirmation-artifact.ts`（`registerWriteConfirmationArtifact`）
- Apply 校验：`scripts/write-confirmation-artifact.ts`（`validateArtifactState` → `plan_digest_mismatch`）
- 表征测试：`scripts/test-plan-digest-lifecycle-wen300.ts`

## 相关 issue

- WEN-299：计划确认 UI 结构化中文展示（触发本问题的写入场景）
- WEN-298：计划确认三选项与唯一写入授权
- WEN-288：结构化 write plan builder
