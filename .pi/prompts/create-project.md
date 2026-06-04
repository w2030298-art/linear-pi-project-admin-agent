---
description: Create a Linear Project draft
argument-hint: "[requirement description]"
---

**Create Project Mode**

Call skill: create-linear-project. Run the five-step collaboration loop: four-grid questions -> 2-3 weighted options -> assumption challenge -> fact anchoring -> converged plan.

Detailed requirements: $ARGUMENTS

Behavior sources:linear-admin-core, project-planning, create-linear-project.

Write interface: if real Linear writes are needed, use only `linear_validate_and_apply_write_plan`; do not split back into the old three-step flow.

Architecture principle: collaboration-first planning; Linear writes are only the thin output adapter after convergence.

Routing requirements:
- Start with four-grid questions (What / Why / Who / How), then provide 2-3 weighted options.
- After options, challenge assumptions and anchor facts before any plan selection.
- Do not turn unread Linear / GitHub / local / web information into facts.
- After convergence, output PRD, non-goals, success metrics, Milestones, Issues, Relations, and a reviewable plan.
