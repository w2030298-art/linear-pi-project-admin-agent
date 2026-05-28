---
name: linear-cycle-planning
description: >-
  当用户要求规划、复盘或调整 Linear Cycle，审计 rollover / auto-add 进入 Cycle 的 Issue，
  或根据当前/下一 Cycle 安排 1-2 周工作时使用。
---

# Linear Cycle 规划

本 Skill 用于在 Linear 原生 Cycle 自动化基础上做规划补强。Linear 负责时间盒、未来 Cycle、未完成 Issue rollover、可选 auto-add、capacity 和 graph；Agent 负责语义排期、自动纳入审计、容量治理、风险说明和授权后写回。

Cycle 是团队时间盒，不替代 Project、Milestone 或 Issue 层级。

---

## 1. 触发条件

- "规划下个 cycle"
- "本周期应该做什么"
- "把这些 issues 排进 cycle"
- "调整当前 cycle 范围"
- "做一次 cycle 复盘"
- "根据 Linear 帮我安排接下来 1-2 周"
- "检查自动 rollover / auto-add 进来的 issue 是否合理"
- "基于 Linear 自带 cycle 自动化帮我补强规划"

---

## 2. 核心原则

- **Milestone 是交付阶段，Cycle 是执行节奏**：Issue 仍直接归属 Milestone；Cycle 只表达本周期/下周期推进窗口。
- **先识别 Linear 原生自动化，再做补强**：先读取或说明无法读取 Cycle 设置、rollover、auto-add、capacity / graph，再输出 Agent 判断。
- **默认不关闭原生 Cycle 自动化**：保留 Linear 的节奏、rollover、未来 Cycle、图表和容量提示；重点审计 auto-add 和 rollover 带来的范围污染。
- **只纳入可执行 Issue**：需求清楚、验收标准明确、未被未完成依赖阻塞、优先级与 Milestone 目标一致。
- **审计自动进入 Cycle 的 Issue**：对 rollover / auto-add / 来源不明的 Issue 标记保留、顺延、移出建议或待澄清。
- **控制单人并行量**：默认当前 Cycle 同时推进 1-3 个核心 Issue；避免多个 High-difficulty Issue 并行。
- **保留顺延原因**：不纳入 Cycle 的候选 Issue 必须说明原因，例如依赖未解除、范围不清、优先级不足、超出容量。
- **写入前确认**：除非用户明确要求直接写入，否则只输出 Cycle 计划和状态更新草案。

---

## 3. 读取 Linear 数据与自动化基线

必须读取或尝试读取：

- Team Cycle 设置：是否启用 Cycles、周期长度、开始日、团队时区、cooldown、未来 Cycle 数量。
- Cycle 自动化：未完成 Issue rollover 是否可观察、auto-add active issues 是否开启、auto-add 覆盖 Active / Started / Completed 的哪类 Issue（如工具支持）。
- Project：名称、目标、状态、目标日期、最近状态更新。
- Milestones：名称、目标日期、关联 Issues。
- Issues：标题、描述、状态、优先级、负责人、labels、Milestone、Cycle、更新时间。
- Issue relations：blocked by、blocks、related。
- Cycle：当前 Cycle、下一 Cycle、开始/结束时间、已纳入 Issues、完成率、capacity / graph 摘要（如工具支持）。
- Issue activity/history：Cycle 归属变化、rollover 迹象、auto-add 迹象、最近状态变化（如工具支持）。

如果无法读取 Cycle 或自动化设置信息，不要中断；标注"Cycle 数据未读取"或"Cycle 自动化设置未读取"，并基于 Project / Milestone / Issues 生成待写入计划。不要把推断写成事实。

读取后先输出一个简短基线：

```markdown
## Linear 原生自动化基线
- Cycles：已启用 / 未启用 / 未读取
- 周期设置：长度、开始日、cooldown、未来 Cycle 数量
- Rollover：可观察到 / 未观察到 / 工具不可判定
- Auto-add active issues：开启 / 关闭 / 未读取
- Capacity / graph：正常 / 有风险 / 未读取
- 需要人工确认：任何不可逆或大范围设置变更
```

---

## 4. 最小澄清

如果用户未说明周期目标，最多问 5 个问题：

```markdown
为了规划 Cycle，我需要确认：

1. 要规划当前 Cycle 还是下一 Cycle？周期窗口是几天/几周？
2. 本 Cycle 的唯一目标是什么？例如交付某个 Milestone、解除阻塞、完成验证。
3. 本周期最大可投入时间是多少？是否只允许单线推进？
4. 哪些 Issue 必须纳入？哪些明确不纳入？
5. 是否允许我调整由 rollover / auto-add 带来的 Cycle 归属，并把确认后的结果写回 Linear？
```

如果用户要求"按你的判断来"，可以继续，但必须把周期窗口、容量和目标写为假设。

---

## 5. 自动纳入审计与候选 Issue 筛选

先把当前 Cycle 中的 Issue 分类：

| 分类 | 判定方式 | 处理原则 |
|---|---|---|
| 手动规划 | 有明确用户/Agent 规划记录或与 Cycle 目标一致 | 按候选筛选规则复核，通常优先保留 |
| Rollover | 上个 Cycle 未完成后进入当前 Cycle，或 activity 显示周期结束后迁入 | 检查是否仍符合本 Cycle 目标；多次 rollover 要标记风险 |
| Auto-add | 状态 Active / Started / Completed 且此前无 Cycle，进入当前/下个 Cycle | 只保留与目标直接相关且可执行的 Issue |
| 来源不明 | 工具无法判断进入原因 | 标记为"来源未确认"，按普通候选复核 |

对 rollover Issue 必须回答：

- 为什么上个 Cycle 未完成。
- 本 Cycle 是否仍应继续推进。
- 是否需要缩小范围、拆分 sub-issue、调整验收标准或顺延。
- 如果连续多个 Cycle rollover，是否应从当前 Cycle 移出并重新澄清。

对 auto-add Issue 必须回答：

- 是否只是因为状态活跃而被系统纳入。
- 是否符合本 Cycle 唯一目标。
- 是否存在未解除依赖、缺失验收标准或缺失 Task-difficulty label。
- 是否建议保留、移出当前 Cycle、放入下个 Cycle、移回 Backlog 或先澄清。

优先纳入满足以下条件的 Issue：

1. 状态为 Todo / Ready / In Progress，且不是 Done / Canceled。
2. 归属当前目标 Milestone，或是解除当前 Milestone 阻塞所必需。
3. 无未完成的 blocked by；若有阻塞，解除条件明确且可在本 Cycle 内完成。
4. 有验收标准或完成定义。
5. Task-difficulty label 已存在；缺失时先列为数据质量问题。

默认不纳入：

- 范围仍不清楚的 Issue。
- 依赖未解除且本周期无法解除的 Issue。
- 与本 Cycle 目标无直接关系的 vNext / Later Issue。
- 会导致当前 Cycle 并行量超过容量的低优先级 Issue。
- 仅因 auto-add 进入 Cycle、但不符合本 Cycle 目标的 Issue。

---

## 6. Cycle 计划输出

```markdown
# Cycle 计划：[名称 / 日期窗口]

## 0. Linear 原生自动化基线
| 项目 | 当前情况 | 判断 |
|---|---|---|
| Cycles / Rollover / Auto-add / Capacity | [读取结果] | [保留 / 需复核 / 未读取] |

## 1. Cycle 目标
- 目标：
- 对应 Project：
- 对应 Milestone：
- 成功标准：

## 2. 当前 Cycle 自动纳入审计
| Issue | 来源 | 当前状态 | 判断 | 原因 |
|---|---|---|---|---|
| [ID] | 手动规划 / Rollover / Auto-add / 来源不明 | [状态] | 保留 / 顺延 / 移出建议 / 待澄清 | [原因] |

## 3. 纳入 Issues
| Issue | Milestone | 当前状态 | 难度 | 来源 | 纳入原因 | 完成标准 |
|---|---|---|---|---|---|---|
| [ID] | [M] | [状态] | [difficulty] | [来源] | [原因] | [标准] |

## 4. 顺延 / 不纳入
| Issue | 原因 | 解除条件 | 建议去向 |
|---|---|---|---|
| [ID] | [原因] | [条件] | 下个 Cycle / Backlog / 需要澄清 |

## 5. 风险与容量
| 风险 | 影响 | 缓解 |
|---|---|---|
| [风险] | [影响] | [缓解] |

## 6. 写入计划
- Cycle：创建 / 更新 / 仅规划不写入
- Linear 原生设置：保持 / 建议调整 auto-add / 不调整
- Issue cycle 归属：新增 [n] 个，保留 [n] 个，移出/顺延 [n] 个
- Labels：append-only 补充 [n] 个 Task-difficulty label / 不补充
- 状态更新：发布 / 起草
```

---

## 7. 写入流程

只有在用户明确授权后执行写入：

```text
1. 定位目标 team、Project、Cycle
2. 回读或确认 Linear 原生 Cycle 设置，尤其是 auto-add 与 cooldown
3. 如工具支持且需要，创建或更新 Cycle；不要改过去 Cycle；不要在未明确确认时提前 start cycle
4. 将确认纳入的 Issue 追加/设置到目标 Cycle
5. 对 rollover / auto-add 产生的顺延 Issue，只在用户确认时移出当前 Cycle 或改入下一 Cycle / Backlog
6. 如发现缺失 Task-difficulty label，按 append-only 补充
7. 发布或起草项目状态更新
8. 回读确认 Cycle、Issue 归属、labels 和状态更新结果
```

不得在未确认时批量移动 Issue 的 Cycle 归属。不得声称工具不支持的 Cycle 写入已经完成。不得把 Linear 原生自动化设置的推断值写成已确认事实。

---

## 8. Cycle 状态更新草案

```markdown
# Cycle 状态更新｜[YYYY-MM-DD]

**健康状态**：[正常 / 有风险 / 偏离]
**一句话摘要**：[本 Cycle 目标与当前判断]

## 本 Cycle 目标
- [目标]

## 本次纳入
- [Issue ID]：[标题]，原因：[原因]

## 自动纳入审计
- [Issue ID]：[Rollover / Auto-add / 来源不明]，判断：[保留 / 顺延 / 移出建议 / 待澄清]，原因：[原因]

## 顺延或排除
- [Issue ID]：[标题]，原因：[原因]

## 风险与阻塞
- [风险/阻塞]：解除条件 [条件]

## 下次检查前应完成
- [具体动作]
```

---

## 9. 质量门禁

结束前检查：

- 是否明确 Cycle 与 Milestone 的关系，没有把 Cycle 当成新层级。
- 是否读取或说明无法读取 Cycle 数据和原生自动化设置。
- 是否区分 Linear 原生自动化结果与 Agent 的治理建议。
- 是否审计 rollover / auto-add / 来源不明 Issue。
- 是否列出纳入、顺延和不纳入 Issue 的理由。
- 是否检查 blocked by / blocks 关系。
- 是否控制当前 Cycle 并行量。
- 是否保留缺失 label、验收标准、负责人、目标日期等数据质量问题。
- 是否避免未授权调整 auto-add、提前 start cycle、批量移动 Issue。
- 如果写入 Linear，是否回读确认 Cycle 和 Issue 归属。
