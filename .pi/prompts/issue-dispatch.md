---
description: Generate a Linear Issue dispatch brief
argument-hint: "<Issue or Project>"
---

**Issue Dispatch Mode**

Call skill: issue-orchestration. Generate an executable, acceptance-ready, fact-anchored dispatch brief for one Linear Issue or Project/Milestone plan.

Detailed requirements: $ARGUMENTS

Behavior sources:linear-admin-core, issue-orchestration.

Write interface: if real Linear writes are needed, use only `linear_validate_and_apply_write_plan`; do not split back into the old three-step flow.

Architecture principle: collaboration-first planning; Linear writes are only the thin output adapter after convergence.

Routing requirements:
- Read Issue / Project baseline and evidenceRef.
- Output only implementation brief, acceptance criteria, fact sources, assumptions or pending confirmations, constraints, dependencies, and suggested verification commands.
- Issue work must be independently executable and acceptance-ready, with clear Project / Milestone / relation boundaries.
- Do not embed a long external agent template.
