---
name: linear-project-report
description: >-
  读取 Linear Project 当前状态，输出中文项目进展报告，覆盖范围、里程碑、Cycles、Issues、阻塞、依赖、风险、决策、下阶段计划和状态更新建议。
  触发场景：用户说"输出进展报告"、"项目周报"、"项目现在怎么样"、"总结风险和进度"、"给领导发项目状态"。
---

# Linear 项目进展报告

本 Skill 用于从 Linear 读取项目事实，形成可给管理层、产研团队或项目干系人阅读的中文进展报告。重点是事实、风险、阻塞、下一步和需要决策的事项。

---

## 1. 触发条件

- "根据 Linear 中的某个 project 输出当前项目进展报告"
- "这个项目现在进度怎么样"
- "生成项目周报"
- "总结风险、阻塞、里程碑进展"
- "给领导发一份项目状态"
- "根据 Linear 项目更新输出报告"

---

## 2. 最终产出

1. **项目概览**：名称、状态、负责人、时间范围、目标、健康状态判断
2. **进度摘要**：已完成/进行中/未开始/已取消/本周期变化
3. **Milestone 进展**：每个里程碑的状态、完成度、目标日期、风险
4. **Cycle 进展（如适用）**：当前/下一 Cycle 的目标、纳入 Issues、完成率、顺延风险
5. **Issue 进展**：按状态/优先级/Milestone/Cycle/负责人聚合，逾期/阻塞/无人负责的问题
6. **依赖与阻塞**：blocked/blocking/related、跨项目依赖、解除条件
7. **风险判断**：范围/时间/质量/架构/资源/外部依赖风险
8. **决策请求**：需要决策的事项、选项、建议和影响
9. **下阶段计划**：下 7-14 天应完成什么、推荐调整项
10. **可选**：一条可发布到 Linear 的项目状态更新草案

---

## 3. 读取 Linear 数据

必须读取或尝试读取：

- **Project**：名称、描述、状态、负责人、成员、目标日期、更新时间、URL
- **Milestones**：名称、描述、目标日期、进度、关联 Issues
- **Issues**：标题、描述、状态（Backlog/Todo/In Progress/Done/Canceled）、优先级、负责人、创建/更新时间、估算、labels、milestone、cycle、project
- **Issue relations**：blocked by、blocks、related、duplicate
- **Project updates**：最近 3-5 条、健康状态、主要变化
- **Project dependencies**：上游/下游项目、阻塞关系
- **Cycles（如工具支持）**：当前 Cycle、下一 Cycle、时间窗口、纳入 Issues、完成率

如工具可用，也读取 Project graph、完成预测、Cycle 信息、PR/GitHub links、Comments 中的风险或决策。

---

## 4. 不确定性处理

不要根据空白字段猜测项目进度。使用以下表达：

- "Linear 中未记录负责人。"
- "该 Issue 没有验收标准。"
- "未找到目标日期。"
- "无法从当前数据判断是否逾期。"
- "最近项目更新不足，风险判断置信度较低。"

如果数据不足，仍输出报告，但增加"数据质量问题"部分。

---

## 5. 健康状态判断

### 正常（onTrack）

- 关键 Milestone 按计划推进
- 没有 P0 阻塞
- 核心 Issue 有负责人
- 最近更新显示风险可控
- 目标日期未明显受威胁

### 有风险（atRisk）

满足任一条件：

- 存在关键 blocked issue
- 目标日期临近但核心 Issue 未完成
- 多个 Issue 无负责人或验收标准
- 新需求导致范围扩大
- 依赖外部系统/团队但解除条件不清
- 质量、测试、监控、上线准备滞后

### 偏离（offTrack）

满足任一条件：

- 关键 Milestone 已逾期且仍未完成
- 核心路径被阻塞且无解除计划
- 上线日期不可达
- 关键风险已经发生
- 大量 Issues 长期停滞
- 项目状态更新长时间缺失

---

## 6. 进度聚合规则

### 按状态聚合

将 Issue 分为：Backlog/Triage、Todo、In Progress、In Review、Done、Canceled、Blocked（通过 relation 或 label 判断）。

不同 workspace 的工作流名称可能不同，优先使用 Linear 状态类型；如果只有状态名称，按语义映射。

### 按 Milestone 聚合

每个 Milestone 计算：总 Issue 数、Done 数、In Progress 数、Blocked 数、无负责人 Issue 数、目标日期是否临近或逾期。

### 按 Cycle 聚合

如果读取到 Cycle 信息，计算当前/下一 Cycle 的：总 Issue 数、Done 数、In Progress 数、Blocked 数、High-difficulty 数、顺延风险、是否超过单人并行容量。

Cycle 风险信号：

- 当前 Cycle 有未解除 blocked by 的核心 Issue。
- 当前 Cycle 同时包含多个 High-difficulty Issue 且均未完成。
- Cycle 结束前核心 Issue 仍为 Todo/Backlog。
- Issue 属于 vNext/Later，但被放入当前 Cycle。
- 当前 Cycle 无明确目标或与 Milestone 目标不一致。

### 按 Issue 健康度判断

核心 Issue 有以下情况时标记风险：

- 没有负责人或验收标准
- blocked by 未解除
- 更新时间过久
- Milestone 目标日期临近但状态仍为 Todo/Backlog
- 范围过大且没有拆分子任务
- 涉及上线/安全/权限/数据迁移但缺少测试或回滚说明

### 按 Label 聚合

#### Task-difficulty 覆盖率

统计所有 Issue 中有/无 Task-difficulty label 的数量和比例。覆盖率低于 80% 时在报告中标记为数据质量问题，并建议补充。

#### Area 分布

统计 Backend / Frontend / 无 Area label 的 Issue 数量，帮助了解工作负载在前后端的分布。

#### 按 difficulty 的进度分布

| Task-difficulty | 总数 | Done | In Progress | Todo | Backlog |
|---|---:|---:|---:|---:|---:|
| High-difficulty | | | | | |
| Medium-difficulty | | | | | |
| Low-difficulty | | | | | |
| 未标记 | | | | | |

---

## 7. 风险识别规则

### 范围风险

信号：新增需求频繁但 Project description 未更新、vNext 内容进入当前 Milestone、非目标被创建为当前 Issue、Issue 描述不清。

### 时间风险

信号：目标日期临近但核心 Issue 未开始、Milestone 逾期、关键 blocked issue 无解除日期、进行中 Issues 长时间无更新。

### Cycle 风险

信号：当前 Cycle 容量过载、Issue 顺延原因未记录、Cycle 内 Issue 依赖未解除、Cycle 目标与 Milestone 目标脱节。

### 技术风险

信号：ADR 缺失、数据模型/API 边界未确认、第三方集成未验证、权限/安全/审计/监控任务滞后。

### 质量风险

信号：QA/测试/监控任务未开始、多个 Issue 无验收标准、缺少 E2E/契约/性能/安全测试、上线 Milestone 未包含回滚和告警。

### 数据质量风险

信号：Linear 中缺少负责人/Milestone/目标日期、Project updates 长期缺失、Issue 状态与描述不一致、依赖只写在描述中没有 relation。

---

## 8. 写入或不写入规则

**默认行为**：输出报告 + Linear 状态更新草案，不主动写入 Linear。

只有在用户明确要求时，才发布项目状态更新：

- "把这份报告作为 project update 发到 Linear"
- "发布项目状态更新"
- "写入 Linear"

发布后必须回读确认：Project update 是否创建、健康状态是否正确、内容是否完整、URL/ID。

---

## 9. 最终回复模板

```markdown
已生成 Linear 项目进展报告。

## 项目
- Project：[名称 / URL]
- 报告周期：[日期范围]
- 健康状态：[正常 / 有风险 / 偏离]

## 关键结论
- [结论 1]
- [结论 2]
- [结论 3]

## 主要风险
- [风险]

## Cycle 摘要
- 当前/下一 Cycle：[目标 / 窗口 / 风险 / 不适用]

## 需要决策
- [决策]

## 下一步
- [下一步]

## 状态更新
- 已发布到 Linear / 已生成草案但未发布
```

---

## 10. 报告质量门禁

结束前检查：

- 是否明确引用 Linear 中实际存在的数据
- 是否没有把缺失信息臆测成事实
- 是否按 Milestone 和 Issue 两个层级说明进度
- 是否在 Cycle 可用时说明当前/下一 Cycle 的目标、容量和顺延风险
- 是否识别了阻塞和依赖
- 是否给出健康状态和理由
- 是否列出下阶段计划
- 是否输出可发布的项目状态更新草案
- 如果发布到 Linear，是否回读确认
- 是否报告了 Task-difficulty label 覆盖率
- 是否建议为缺失 label 的 Issue 补充 Task-difficulty

---

## 详细模板

完整报告模板和状态更新草案模板见 [references/templates.md](references/templates.md)。
