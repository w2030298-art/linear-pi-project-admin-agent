---
name: linear-portfolio-review
description: >-
  扫描 Linear workspace 中所有活跃 Project，逐项分析项目状态健康度、Cycle 执行节奏，给出状态维护建议和下一步应推进为 Ready 或纳入 Cycle 的 Issue 建议。经用户确认后批量执行建议操作。
  触发场景：用户说"审查所有项目状态"、"哪些 Issue 该推进了"、"项目状态维护"、"全局项目巡检"、"下一步做什么"。
---

# Linear 全局项目巡检与推进建议

本 Skill 对 Linear workspace 中所有活跃项目做一次全面巡检，产出两类可执行建议：

1. **项目状态维护建议**：识别每个 Project 的健康度问题，给出具体修复动作。
2. **Issue 推进建议**：为每个 Project 推荐下一步应流转为 Ready 状态或纳入当前/下一 Cycle 的 Issue。

所有建议经用户确认后才执行写入。Pi 交互模式下，确认只能走一次 `ask_user`；不要要求用户先输入固定确认句再进行二次确认。

---

## 1. 触发条件

- "审查所有项目状态"
- "全局项目巡检"
- "哪些 Issue 该推进了"
- "项目状态维护"
- "下一步做什么"
- "帮我看看 Linear 项目们现在怎么样"

---

## 2. 数据采集

### 2.1 采集范围

按以下顺序读取（工具调用失败时标注"未读取"并继续）：

1. **list_projects**：`includeMilestones: true`，获取所有活跃项目（排除 archived）。
2. 对每个 Project：
   - **get_project**：`includeMilestones: true`，读取描述、状态、目标日期。
   - **list_issues**：按 `project` 过滤，`limit: 250`，`includeArchived: false`，获取全部 Issue。
   - **get_status_updates**：`type: "project"`，按 `project` 过滤，`limit: 3`，获取最近状态更新。
   - **Cycle 信息**：读取当前/下一 Cycle 及 Issue 的 Cycle 归属（工具支持时）。
3. **list_issue_statuses**：获取当前 team 的工作流状态列表，确认 "Ready" 对应的状态名。

### 2.2 采集结果结构

为每个 Project 构建内部分析模型：

```
Project:
  name, id, state, targetDate, description(摘要), url
  milestones: [{ name, targetDate, sortOrder }]
  issues: [{
    id, identifier, title, state, priority, assignee,
    milestone, cycle, labels, createdAt, updatedAt,
    blockedBy: [], blocks: [], relatedTo: []
  }]
  recentUpdates: [{ date, health, body(摘要) }]
  cycles: [{ name, startsAt, endsAt, issueCount, completedCount }]
```

---

## 3. 项目状态分析维度

对每个 Project 逐项检查以下维度，产出具体建议。

### 3.1 项目状态更新时效

| 信号 | 判断 | 建议 |
|---|---|---|
| 最近状态更新 > 14 天前 | 状态更新滞后 | 建议发布一条新的项目状态更新 |
| 从未发布状态更新 | 缺失状态更新 | 建议发布首条状态更新 |
| 最近更新 ≤ 7 天 | 正常 | 无需操作 |

### 3.2 健康状态一致性

| 信号 | 判断 | 建议 |
|---|---|---|
| 最近更新 health 为 onTrack，但存在逾期 Milestone 或多个 blocked Issue | 健康状态偏乐观 | 建议将健康状态调整为 atRisk |
| 最近更新 health 为 atRisk/offTrack，但所有 Milestone 和 Issue 均按计划 | 健康状态偏悲观 | 建议将健康状态调整为 onTrack |
| 无状态更新可参照 | 无法判断 | 建议发布状态更新以建立基线 |

### 3.3 Issue 状态分布异常

| 信号 | 判断 | 建议 |
|---|---|---|
| In Progress + Ready Issue 均为 0，但项目状态为 started | 无推进中或就绪工作 | 建议推进合适 Issue 为 Ready |
| In Progress Issue > 5（单人项目） | 并行过多 | 建议聚焦，将低优先级 Issue 退回 Todo |
| Done 比例 > 80% 但项目未标记完成 | 接近完成 | 建议检查剩余 Issue，考虑关闭项目 |
| Backlog/Triage Issue 长期无变化 | 积压沉淀 | 建议清理或归档 |

### 3.4 Label 覆盖率

| 信号 | 判断 | 建议 |
|---|---|---|
| Task-difficulty label 覆盖率 < 80% | label 缺失 | 列出缺失 label 的 Issue，建议补充 |

### 3.5 Cycle 执行节奏

| 信号 | 判断 | 建议 |
|---|---|---|
| 当前 Cycle 无 Issue，但项目有 Ready/Todo 核心 Issue | Cycle 未承接执行 | 建议选择 1-3 个 Issue 纳入当前或下一 Cycle |
| 当前 Cycle 有多个 High-difficulty Issue 且均未完成 | 单人容量过载 | 建议保留最关键 Issue，其余顺延 |
| 当前 Cycle 存在 blocked Issue | 周期目标有风险 | 建议先解除阻塞或移出 Cycle |
| 下一 Cycle 为空且当前 Milestone 未完成 | 缺少后续执行计划 | 建议规划下一 Cycle |

### 3.6 数据完整性

| 信号 | 判断 | 建议 |
|---|---|---|
| Issue 无 Milestone 归属 | 里程碑关联缺失 | 建议为这些 Issue 分配 Milestone |
| Issue 无负责人且状态为 In Progress | 进行中但无负责人 | 建议分配负责人 |
| Milestone 无目标日期 | 里程碑缺少时间窗口 | 建议设定目标日期 |

---

## 4. Issue 推进建议算法

### 4.1 候选筛选

从每个 Project 的 Issue 中筛选候选项：

1. **状态为 Todo 或 Backlog**（排除已完成、已取消、已在 Ready 或 In Progress 的 Issue）。
2. **无未解除的 blockedBy**（所有阻塞项已完成或已取消）。
3. **未归档**。

### 4.2 评分排序

对候选 Issue 按以下维度打分，总分越高越优先推荐：

| 维度 | 权重 | 评分规则 |
|---|---:|---|
| 优先级 | 30% | Urgent=100, High=75, Medium=50, Low=25, None=10 |
| Milestone 紧迫度 | 25% | 目标日期 ≤ 7 天=100, ≤ 14 天=70, ≤ 30 天=40, 其他=10, 无日期=20 |
| 阻塞影响力 | 25% | 该 Issue blocks 其他 Issue 的数量 × 25（上限 100） |
| 依赖就绪度 | 10% | 所有 blockedBy 已解除=100, 无依赖=80, 部分未解除=0 |
| 状态就绪度 | 10% | Todo=100, Backlog=50 |

### 4.3 推荐数量

- 每个 Project 推荐 1-3 个 Issue（取决于当前 Ready + In Progress 数量）。
- 如果当前 Ready + In Progress ≥ 3，不推荐新增（单人项目聚焦原则）。
- 如果当前 Ready + In Progress = 0，至少推荐 1 个。
- 如果启用 Cycle，当前 Cycle 默认最多推荐 1-3 个 Issue；超过容量时只给出顺延建议，不直接写入。

### 4.4 推荐输出格式

每条推荐包含：Issue 标识符、标题、当前状态、所属 Milestone、推荐原因（命中了哪些评分维度）。

---

## 5. 分析报告输出

### 5.1 报告结构

```markdown
# Linear 全局项目巡检报告

**报告日期**：[YYYY-MM-DD]
**扫描项目数**：[n]
**需要操作的项目数**：[n]

---

## 项目 1：[项目名称]

### 当前概况
| 维度 | 值 |
|---|---|
| 项目状态 | [started/planned/paused/completed/canceled] |
| 目标日期 | [日期 / 未设定] |
| 最近状态更新 | [日期 / 从未更新] |
| 健康状态 | [onTrack/atRisk/offTrack / 无] |
| Issue 总数 | [n] |
| Done | [n] |
| In Progress | [n] |
| Todo | [n] |
| Backlog | [n] |
| Blocked | [n] |

### 状态维护建议
- [ ] 建议 1：[具体操作]
- [ ] 建议 2：[具体操作]

### 推荐推进为 Ready 的 Issue
| 排名 | Issue | 标题 | 当前状态 | Milestone | 推荐原因 |
|---:|---|---|---|---|---|
| 1 | [ID] | [标题] | [状态] | [M] | [原因] |

### Cycle 建议
- 当前/下一 Cycle：[纳入 Issue / 顺延 Issue / 不适用]

---

## 项目 2：[项目名称]
...

---

## 操作汇总

### 状态维护操作
| # | 项目 | 操作类型 | 具体内容 |
|---:|---|---|---|
| 1 | [项目] | 发布状态更新 | [内容摘要] |
| 2 | [项目] | 补充 label | [Issue 列表] |

### Issue 推进操作
| # | 项目 | Issue | 操作 |
|---:|---|---|---|
| 1 | [项目] | [Issue ID] | 状态 → Ready |
| 2 | [项目] | [Issue ID] | 纳入当前/下一 Cycle |

请确认以上操作，或告诉我需要调整哪些项。
```

---

## 6. 用户确认与执行

### 6.1 确认协议

展示报告后，等待用户确认。用户可能的回应：

| 用户回应 | 处理 |
|---|---|
| "全部执行" / "确认" | 执行所有建议操作 |
| "只执行状态维护" | 仅执行状态维护操作，跳过 Issue 推进 |
| "只推进 Issue" | 仅执行 Issue 状态流转，跳过状态维护 |
| "只规划 Cycle" | 仅执行或起草 Cycle 归属调整，跳过状态维护和 Ready 流转 |
| "去掉第 X 项" / "调整 XX" | 修改操作列表后重新确认 |
| "不执行" | 结束，不写入任何内容 |

### 6.2 执行顺序

```text
1. 补充缺失 labels（save_issue 的 labels append-only）
2. 补充缺失 Milestone 归属（save_issue 设置 milestone）
3. 流转 Issue 状态为 Ready（save_issue 设置 state 为 "Ready"）
4. 设置 Issue 的 Cycle 归属（仅在用户确认且工具支持时）
5. 发布项目状态更新（save_status_update）
6. 回读校验每个写入操作的结果
```

### 6.3 写入安全

- 每次写入后回读确认。
- 不修改已完成或已取消的 Issue。
- 不覆盖已有 labels，使用 append-only。
- 状态更新内容包含本次巡检发现和执行的操作摘要。
- 如果任何写入失败，报告失败项并继续其余操作。

---

## 7. 状态更新草案模板

当建议发布项目状态更新时，按以下模板生成草案：

```markdown
# 项目巡检状态更新｜[YYYY-MM-DD]

## 当前进度
- Issue 完成率：[n/total]（[x%]）
- 进行中：[n] 个
- 阻塞：[n] 个

## 本次巡检发现
- [发现 1]
- [发现 2]

## 本次执行操作
- [操作 1]
- [操作 2]

## 主要风险
- [风险]

## 下一步
- [下一步]
```

---

## 8. 最终回复模板

```markdown
已完成 Linear 全局项目巡检。

## 巡检范围
- 扫描项目数：[n]
- 需要操作的项目数：[n]

## 执行结果
- 状态更新：发布 [n] 条
- Label 补充：[n] 个 Issue
- Issue 推进为 Ready：[n] 个
- Issue 纳入 Cycle：[n] 个
- 失败/跳过：[n] 项

## 各项目摘要
| 项目 | 健康度 | 维护操作 | 推进 Issue |
|---|---|---:|---:|
| [项目] | [状态] | [n] | [n] |

## 推荐下一步
- [下一步]
```

---

## 9. 质量门禁

结束前检查：

- 是否读取了所有活跃项目的 Issues、Milestones、状态更新。
- 是否对每个项目都输出了分析（即使某些项目"一切正常"也应说明）。
- 是否没有遗漏无状态更新的项目。
- Issue 推进建议是否考虑了依赖关系（不推荐仍被阻塞的 Issue）。
- Issue 推进建议是否考虑了当前 Ready + In Progress 数量（单人项目聚焦原则）。
- Cycle 建议是否考虑当前 Cycle 容量、阻塞和 Milestone 目标。
- 所有建议是否在用户确认后才执行。
- 写入后是否回读校验。
- 是否报告了 Task-difficulty label 覆盖率。
