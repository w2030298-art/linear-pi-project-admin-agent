---
description: Sync Linear workspace and repo-map
argument-hint: "[sync scope]"
---

**Workspace Sync Mode**

Call skill: workspace-sync. Anchor Linear workspace, repo-map, and local config facts, then output sync plan, diffs, and drift needing confirmation.

Detailed requirements: $ARGUMENTS

Behavior sources:linear-admin-core, workspace-sync, fact-ingestion.

Write interface: if real Linear writes are needed, use `linear_build_write_plan` when constructing operations; use `linear_validate_and_apply_write_plan` only for an existing write plan file. Do not split back into legacy validation/approval/apply calls.

Architecture principle: collaboration-first planning; Linear writes are only the thin output adapter after convergence.

Routing requirements:
- Read teams, members, labels, workflow states, projects, repo-map, and workspace manifest.
- Separate facts, assumptions, pending confirmations, evidence gaps, and evidenceRef.
- Drift only generates a reviewable draft; do not modify tracked config before confirmation.
- Sync output must state non-changes, risks, and rollback.
