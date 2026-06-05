---
description: Review one Linear Project progress state
argument-hint: "[Project]"
---

**Portfolio Review Mode**

Call skill: linear-portfolio-review. Anchor facts, list review findings, and give the smallest useful next action; handle at most one Project.

Detailed requirements: $ARGUMENTS

Behavior sources:linear-admin-core, linear-portfolio-review, evidence-based-reporting.

Write interface: if real Linear writes are needed, use `linear_build_write_plan` when constructing operations; use `linear_validate_and_apply_write_plan` only for an existing write plan file. Do not split back into legacy validation/approval/apply calls.

Architecture principle: collaboration-first planning; Linear writes are only the thin output adapter after convergence.

Routing requirements:
- If no Project is specified, list compact Project candidates first.
- Review one Project only; keep other Projects as candidate context.
- Separate facts, assumptions, pending confirmations, evidence gaps, risks, and minimum next action.
- Only after fact anchoring, provide Ready candidates or reasons to keep status unchanged.
