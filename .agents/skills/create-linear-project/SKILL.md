---
name: create-linear-project
description: >-
  从模糊想法出发，通过多轮澄清生成完整项目需求、技术架构，并在 Linear 新建 Project、Milestones、Cycles、Issues、依赖关系和状态更新。
  触发场景：用户说"新建项目"、"从 0 规划"、"把想法落到 Linear"、"创建项目说明、里程碑、issues"。
---

# 新建 Linear Project

本 Skill 用于从 0 创建 Linear 项目。把一个模糊想法变成可执行、可追踪、中文优先的 Linear Project。

---

## 1. 触发条件

- "帮我在 Linear 新建一个项目"
- "把这个想法规划成一个 Linear 项目"
- "创建完整项目说明、里程碑、issues、依赖和状态更新"
- "从零规划一个产品/系统"
- "我有一个想法，帮我落到 Linear"

---

## 2. 最终产出

必须产出或写入：

1. **Linear Project**：格式为 `repo-name｜中文描述`，完整中文项目说明（目标、用户、场景、边界、约束、非目标、产品范围、技术架构摘要、ADR 列表、模块划分、数据模型、API 边界、部署架构、成功指标、风险、依赖、待确认项）。
2. **Milestones**：至少 4 个（通常 5 个），每个包含目标、完成标准、时间窗口、关联 Issues。
3. **Cycles（如适用）**：当前/下一 Cycle 的目标、时间窗口、纳入 Issues、顺延 Issues、容量风险。Cycle 不替代 Milestone，只表达执行节奏。
4. **Issues**：通常 6-12 个，直接归属 Milestone。每个包含背景、范围、交付物、验收标准、技术说明、依赖、风险、完成定义。较大 Issue 可创建 sub-issue 拆分，但不引入额外层级。
5. **依赖关系**：Issue relations（`blocked by` / `blocks` / `related`），必要时 Project dependencies。
6. **项目状态更新**：一条中文状态更新，默认 `onTrack`。

### Label 规则

每个新建 Issue 必须包含：

1. **Task-difficulty**（必选，每个 Issue 必须有且仅有一个）：根据任务涉及的模块数量、跨系统依赖、算法复杂度、状态管理复杂度、调试难度综合判断。
   - `High-difficulty`：需要深度逻辑推理、系统性问题解决、大量上下文处理的复杂任务
   - `Medium-difficulty`：需要多步逻辑和中等上下文理解的标准任务
   - `Low-difficulty`：上下文隔离、逻辑简单的直接任务
2. **Area**（可选，根据 Issue 涉及的工程领域选择）：
   - `Backend`：服务端计算、数据库、API 开发、核心系统架构
   - `Frontend`：用户界面、客户端逻辑、视觉样式、用户交互
   - 一个 Issue 可以同时打 Backend 和 Frontend（如全栈任务）；也可以不打 Area（如纯需求/文档/项目管理类 Issue）。
3. 已有独立 label（Bug、Feature、Improvement 等）根据 Issue 性质选择添加，不受 Label Group 规则影响。

#### 写入示例

创建 Issue 时在 `labels` 字段传入 label ID 数组，例如：

```json
{
  "labels": ["<High-difficulty-label-id>", "<Backend-label-id>"]
}
```

更新已有 Issue 的 labels 时使用 append-only 策略，不要覆盖已有 label。

---

## 3. 输入收集

### 第 1 轮：最小输入

如果用户只给了一个想法，先问最多 5 个问题：

```
为了把它创建成可执行的 Linear 项目，我需要先确认 5 件事：

1. 目标用户是谁？主要使用场景是什么？
2. 你希望 MVP 必须解决哪 1-3 个核心问题？
3. 明确不做什么？有没有必须排除的范围？
4. 是否有上线时间、团队规模、技术栈或存量系统约束？
5. 成功指标是什么？例如转化率、效率、成本、质量、收入、留存、工时节省等。
```

如果用户要求"先按你的判断规划"，可以继续，但必须把缺失信息写为假设和待确认项。

### 第 2 轮：范围和架构

```
我还需要确认几个会影响架构与 Linear 拆分的问题：

1. 系统是否需要登录、权限、组织/团队隔离、审计日志？
2. 是否涉及支付、个人信息、敏感数据、企业客户数据或合规要求？
3. 是否需要对接第三方系统？如果有，列出系统名和调用方向。
4. 主要数据实体有哪些？例如用户、订单、任务、文档、项目、消息等。
5. 预期部署在哪里？例如 Vercel、AWS、GCP、阿里云、Kubernetes、内部服务器等。
```

### 第 3 轮：交付计划

```
为了创建里程碑和 Issues，我还需要确认：

1. 期望首版周期是几周？是否需要拆成 1-2 周的 Linear Cycle 执行节奏？
2. 是否已有设计、原型、PRD、接口文档或数据库约束？
3. 哪些工作最容易阻塞其他工作？
4. 是否需要灰度、内测、Beta、GA 等分阶段发布？
5. Linear 中应该归属哪个 team / workspace / initiative？
```

---

## 4. 结构化工作流

### Step 1：确认项目定位

输出项目定位草案（中文项目名、一句话目标、主要用户、核心场景、MVP 范围、非目标、关键约束、成功指标、主要风险、待确认项）。

项目名称格式：`repo-name｜中文描述`（如果关联 GitHub 仓库）。

### Step 2：生成需求规格包

使用 [references/templates.md](references/templates.md) 中的"需求规格包模板"。

### Step 3：生成技术架构规格

使用 [references/templates.md](references/templates.md) 中的"技术架构规格模板"。

### Step 4：生成 ADR

根据项目复杂度决定 ADR 数量：

- 大型/架构复杂项目：至少 ADR-001 到 ADR-006（架构风格、数据存储、API 通信、身份认证与权限、部署与发布、可观测性）。如涉及异步/事件、第三方集成、数据隔离、LLM，追加 ADR-007 到 ADR-010。
- 中小型/个人研究项目：按需输出关键 ADR，不强制最低数量。

### Step 5：设计 Linear Project description

使用 [references/templates.md](references/templates.md) 中的 "Project description 模板"。

### Step 6：设计 Milestones

默认 5 个：

| Milestone | 目标 |
|---|---|
| M0｜需求澄清与范围冻结 | 明确用户、场景、范围、非目标、成功指标 |
| M1｜架构决策与技术基线 | 完成架构规格、ADR、工程基线 |
| M2｜核心 MVP 闭环 | 实现核心用户路径端到端 |
| M3｜集成、数据与质量验证 | 外部集成、测试、性能、安全验证 |
| M4｜上线、监控与运营交接 | 灰度、上线、回滚、运营交接 |

### Step 6.5：设计 Cycles（如适用）

当用户要求周期推进，或项目已经进入执行规划时，设计当前/下一 Cycle：

- Cycle 是团队时间盒，不替代 Milestone。
- 默认周期为 1-2 周；如果用户未提供，写为假设。
- 当前 Cycle 只纳入依赖清楚、验收标准明确、可在周期内完成或取得明确进展的 Issue。
- 单人项目默认当前 Cycle 同时推进 1-3 个核心 Issue，避免多个 High-difficulty Issue 并行。
- 对未纳入的候选 Issue 说明顺延原因和解除条件。

### Step 7：设计 Issues

从以下清单中选择 6-12 个（不要机械全选）：

1. 需求与范围：完成 PRD、MVP 边界和验收标准
2. 用户体验与流程：完成核心用户旅程和交互规格
3. 技术架构：完成架构设计、ADR 和工程基线
4. 数据模型：设计核心实体、关系、迁移和数据质量规则
5. API 边界：定义服务接口、事件、错误码和契约测试
6. 核心业务模块：[模块名] MVP 闭环
7. 权限与安全：身份认证、授权、审计和数据保护
8. 第三方集成：[系统名] 对接与异常处理
9. 可观测性与运维：日志、指标、Trace、告警和仪表盘
10. 质量验证：测试策略、自动化测试、性能与安全验证
11. 发布上线：灰度、回滚、文档、运营交接
12. 项目管理与风险：依赖跟踪、状态更新和决策闭环

每个 Issue 必须归属 Milestone；如果进入当前或下一执行窗口，再额外设置 Cycle 归属。

### Step 8：建立依赖关系

默认依赖逻辑：

- 需求与范围 `blocks` 技术架构、UX、数据模型
- 技术架构 `blocks` API 边界、核心业务模块、部署
- 数据模型 `blocks` 核心业务模块、API 边界
- 权限与安全 `blocks` 上线
- 可观测性与质量验证 `blocks` 上线

---

## 5. Linear 写入流程

```text
1. 确认 workspace / team / initiative
2. 检查是否存在同名或相似项目
3. project.create
4. project.update(description/status/targetDate/lead)
5. projectMilestone.create × N
6. cycle 定位/创建/规划（仅在团队启用 Cycle、工具支持且用户授权时）
7. issue.create × N
8. issue.update (attach milestone/project/cycle/labels/priority)
9. 校验每个 Issue 是否包含 Task-difficulty label，缺失则补充
10. issueRelation.create × N
11. projectUpdate.create
12. 回读校验
```

写入后必须回读确认 Project URL/ID、Milestones 数量、Issues 数量、依赖关系、状态更新。

---

## 6. 首条项目状态更新

健康状态默认 `onTrack`（有明确风险则 `atRisk`）。内容包括：本次完成、当前计划、风险与阻塞、需要决策、下次更新前应完成。

---

## 7. 最终回复模板

```markdown
已完成 Linear 新建项目规划。

## 写入结果
- Project：[名称 / URL]
- Milestones：[数量]
- Cycles：[已规划 / 已写入 / 不适用]
- Issues：[数量]
- 依赖关系：[数量]
- 项目状态更新：已发布 / 已起草

## 关键假设
- [假设]

## 需要你确认
- [确认项]

## 推荐下一步
- [下一步]
```

---

## 详细模板

所有详细模板（需求规格包、技术架构规格、ADR、Project description、Issue 描述、状态更新）见 [references/templates.md](references/templates.md)。
