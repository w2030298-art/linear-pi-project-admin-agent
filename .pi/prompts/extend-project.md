---
description: Extend an existing Linear Project
argument-hint: "<Project> [new requirement]"
---

**Extend Project Mode**

Call skill: extend-linear-project. Run five-step collaboration for one existing Linear Project, then produce impact analysis and a converged plan after facts are anchored.

Detailed requirements: $ARGUMENTS

Behavior sources:linear-admin-core, project-planning, extend-linear-project.

Write interface: if real Linear writes are needed, use only `linear_validate_and_apply_write_plan`; do not split back into the old three-step flow.

Architecture principle: collaboration-first planning; Linear writes are only the thin output adapter after convergence.

Routing requirements:
- Handle exactly one Project.
- Run four-grid questions and 2-3 weighted options, then challenge assumptions and anchor facts.
- Classify the new requirement as in-scope enhancement, MVP change, architecture change, suggested split, or later backlog.
- After convergence, output impact analysis plus Milestone / Issue / dependency changes.
