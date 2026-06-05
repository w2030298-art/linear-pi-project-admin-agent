---
description: Generate a Linear Project status report
argument-hint: "<Project>"
---

**Report Mode**

Call skill: linear-project-report. Generate a Project status report from current Linear Project state and evidenceRef, separating facts, assumptions, risks, blockers, and next-stage plan.

Detailed requirements: $ARGUMENTS

Behavior sources:linear-admin-core, linear-project-report, evidence-based-reporting.

Write interface: if real Linear writes are needed, use `linear_build_write_plan` when constructing operations; use `linear_validate_and_apply_write_plan` only for an existing write plan file. Do not split back into legacy validation/approval/apply calls.

Architecture principle: collaboration-first planning; Linear writes are only the thin output adapter after convergence.

Routing requirements:
- Anchor facts before generating the report.
- Separate facts, assumptions, evidence gaps, risks, blockers, decisions, and next-stage plan.
- Reference Linear Project, Milestones, Issues, Project Updates, GitHub / local evidenceRef.
- Project Update draft can only be a convergence output.
