---
name: create-linear-project
description: 从模糊想法出发，生成一个可审查、可最终校验、可一次最终确认后写入 Linear 的 Project、Milestones、Issues、依赖关系和状态更新草案。
---

# Create Linear Project

## Purpose

Turn a rough idea into one Linear Project plan. Keep the model context small: use compact Fact Pack summaries in the prompt and keep raw evidence in `state/fact-packs/evidence/`.

## Flow

1. Identify the target repo or ask one concise question if no repo/project anchor exists.
2. Build a compact Fact Pack.
3. Separate facts, assumptions, recommendations, decisions, and open questions.
4. Draft PRD scope, non-goals, success metrics, architecture, milestones, issues, and dependencies.
5. Generate the write plan with idempotency, readback, and audit requirements.
6. Call `linear_validate_and_apply_write_plan` once. It runs final validation, asks for one `plan_confirmation`, applies immediately only after approval, then performs readback and audit.

## Output Requirements

- Chinese-first Linear content unless the user requests English.
- Project name follows `repo-name｜中文描述`.
- Milestones are delivery stages.
- Issues are independently executable and reviewable.
- Every Issue has acceptance criteria and exactly one Task-difficulty label.
- Write plans include idempotency key, readback requirement, and audit requirement.

## Do Not

- Create speculative features.
- Invent missing Linear, GitHub, or local repo facts.
- Ask for more than one final write approval.
- Write secrets or credentials into Linear.
