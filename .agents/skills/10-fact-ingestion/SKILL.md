---
name: fact-ingestion
description: Build a Fact Pack from Linear, GitHub, local repos, local docs, and web search before project planning, extension, reports, issue dispatch, repo-map work, or workspace sync. Cycle planning is disabled.
---

# Fact Ingestion

Use this skill to build a Fact Pack before Linear planning or reporting work.

## Triggers

- New project planning.
- Existing project extension.
- Project or portfolio reports.
- Issue dispatch.
- Repo-map or workspace-sync work.
- Requests to plan from repo, docs, web, or Linear facts.

Cycle planning is disabled. Do not use Fact Pack construction to prepare Cycle planning or `cycleId` writes.

## Source Priority

1. Linear live data for project management facts.
2. GitHub remote evidence for remote repository facts.
3. Local repo evidence for working-copy facts.
4. Local docs for project documentation.
5. Web search for external or recent facts with citations.
6. User input for confirmed decisions.

## Output Requirements

- `facts`: every fact needs source type, source, timestamp, and confidence.
- `conflicts`: identify the conflicting sources.
- `evidenceGaps`: keep important missing evidence explicit.
- `planningImplications`: explain the impact on non-cycle Linear planning.

## Boundaries

- Do not treat web search as current repo implementation.
- Do not treat a dirty local branch as remote mainline fact.
- Do not write user ideas as confirmed decisions.
- Do not plan, assign, or write Cycles.
