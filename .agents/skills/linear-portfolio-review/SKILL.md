---
name: linear-portfolio-review
description: 先列出 Project 候选摘要，再一次最多选择一个 Linear Project 做健康审查、Issue 推进建议和可确认写入计划。
---

# Single Project Review

## Purpose

Avoid workspace-wide context overload. This skill may list Project candidates, but analysis and write planning must handle one Project per run.

## Flow

1. If no Project is specified, fetch a compact Project list and ask the user or triggering context to choose one.
2. Build a compact Fact Pack for the selected Project.
3. Review the selected Project's status update freshness, milestone progress, issue readiness, blockers, labels, ownership, and repo alignment.
4. Recommend the smallest useful next action: status update draft, move one ready candidate, add missing label, clarify dependency, or no-op.
5. If writing is needed, compile one dry-run plan for this Project only.
6. Ask for one final approval, apply, read back, and audit.

## Output Requirements

- Target Project identity and evidence refs.
- Findings grouped by severity.
- At most one Project's write plan.
- No batch mutation across Projects.

## Do Not

- Scan and analyze every active Project into the prompt.
- Batch write across Projects.
- Create duplicate snapshot files for the same review.
