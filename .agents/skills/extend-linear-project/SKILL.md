---
name: extend-linear-project
description: 读取一个现有 Linear Project，围绕新增需求做影响分析、范围调整、Milestone/Issue/依赖更新，并生成一次最终确认后可写入且通过最终校验的 write plan。
---

# Extend Linear Project

## Purpose

Extend exactly one Linear Project at a time. Do not load or plan the whole workspace unless the user is only choosing which project to inspect next.

## Flow

1. Resolve one target Project by id, key, URL, or exact name.
2. Build a compact Fact Pack for that Project and its mapped repo.
3. Load current Project baseline from the Fact Pack with `fact_project_baseline_load`.
4. Re-read full Linear Project context only when the baseline is absent, stale, or missing fields required for the impact analysis.
5. Classify the new requirement as in-scope enhancement, MVP change, architecture change, suggested split, or later backlog.
6. Produce an impact analysis for product scope, architecture, data/API boundaries, issues, dependencies, risks, and docs.
7. Prefer updating or adding Issues under existing Milestones when appropriate; do not create placeholder Milestones just to satisfy a reviewer.
8. Use `linear_build_write_plan` once for structured operations. It builds the write plan, runs final validation, asks for one `plan_confirmation`, applies immediately only after approval, then reads back and summarizes changed Linear URLs. Use `linear_validate_and_apply_write_plan` only when starting from an existing write plan file.

## Output Requirements

- Current baseline.
- New requirement facts and assumptions.
- Recommended changes and non-changes.
- Write plan summary with idempotency key.
- Risks, rollback, and evidence refs.
- Baseline loader status and raw evidenceRef; do not paste full Project JSON.

## Do Not

- Process multiple Projects in one extension run.
- Invent repo-map fields or Linear object IDs.
- Ask for a second confirmation after final approval.
