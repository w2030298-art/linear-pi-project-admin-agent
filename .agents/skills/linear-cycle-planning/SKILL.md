---
name: linear-cycle-planning
description: >-
  Deprecated disabled skill. Use only when a user asks about Linear Cycle
  planning, assignment, rollover, or cycleId writes, so the agent can refuse the
  cycle-specific action and redirect to non-cycle project planning.
---

# Linear Cycle Planning Disabled

Cycle functionality is disabled for this agent.

Rules:

- Do not plan current, next, or future Linear Cycles.
- Do not create, update, assign, remove, or audit Linear Cycle membership.
- Do not include `cycleId` in Linear write plans.
- Do not dispatch `Agent:CyclePlan` work.
- If the user asks for cycle work, state that cycle functionality is disabled and offer Project, Milestone, Issue, dependency, or report work without cycle fields.
