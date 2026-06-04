---
description: Build a task Fact Pack
argument-hint: "<task or Project>"
---

**Fact Pack Mode**

Call skill: fact-ingestion. Build a compact Fact Pack for the current task, anchoring facts before listing assumptions, evidence gaps, and planning implications.

Detailed requirements: $ARGUMENTS

Behavior sources:linear-admin-core, fact-ingestion, fact-pack.

Write interface: if real Linear writes are needed, use only `linear_validate_and_apply_write_plan`; do not split back into the old three-step flow.

Architecture principle: collaboration-first planning; Linear writes are only the thin output adapter after convergence.

Routing requirements:
- Prefer Linear, GitHub, local repo, local docs, and necessary web evidence.
- Separate facts, assumptions, pending confirmations, evidence gaps, and evidenceRef.
- Output a compact digest; do not paste long raw evidence into context.
- If target Project or repo-map is unclear, report evidence_gap first.
