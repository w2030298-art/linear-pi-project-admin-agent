# Linear MCP Write Backend

WEN-320 removed the hand-rolled `@linear/sdk` executor and four resolver modules. Real Linear mutations now go exclusively through the Linear MCP server configured in `config/mcp.servers.json`.

## Architecture

```text
linear_apply_write_plan(dryRun=false)
  -> write-plan-execution (confirmed-only gate)
  -> linear-apply/command.mjs
       compileOperations + manifest validation
       connectLinearMcp()
       mutateMcp()  -> save_issue | save_status_update | ...
       readbackMcp() -> get_issue | get_project | ...
       verifyApplyReadback() -> planned vs actual diff + audit
```

Key modules:

| Module | Role |
| --- | --- |
| `scripts/linear-apply/command.mjs` | Apply orchestration, progress checkpoints, audit |
| `scripts/linear-apply/mcp-adapter.mjs` | MCP connect, tool mapping, `mutateMcp` / `readbackMcp` |
| `scripts/linear-mcp-match.mjs` | Thin name/id matching against cached workspace manifest |
| `scripts/linear-apply/readback-diff.mjs` | Post-apply planned-vs-actual diff |
| `scripts/linear-apply/audit.mjs` | Append-only audit events |

## Configuration

- `LINEAR_WRITE_BACKEND=mcp` (default; only supported value)
- `LINEAR_API_KEY` — bearer token for `https://mcp.linear.app/mcp`
- `config/mcp.servers.json` — Linear MCP transport (`streamable-http`)

Dry-run and real apply both report `writeBackend: "mcp"` in CLI JSON output.

## Operation mapping

| Write plan type | MCP tool | Readback tool |
| --- | --- | --- |
| `issue.create` / `issue.update` | `save_issue` | `get_issue` |
| `issueRelation.create` | `save_issue` (`relatedTo`) | `get_issue` |
| `projectUpdate.create` | `save_status_update` | `get_status_updates` |
| `project.update` | (via normalize + MCP readback) | `get_project` |

Unsupported operation types fail at compile or MCP mapping time; there is no SDK fallback path.

## Confirmation and safety

Solo write flow (see `config/write-policy.yaml` v2):

1. Quality review + dry-run compile (no user confirmation)
2. One `pi_ask_user(flow=plan_confirmation)` approval artifact
3. Real apply via MCP with manifest drift check, per-operation readback, checkpoint resume, and final readback diff

Legacy `write_confirmation` and conversation text fallback are removed from the supported UX path (WEN-318). Real apply requires an interactive planning approval artifact unless tests inject `--confirmation-channel ask_user` on the CLI.

## Smoke and regression tests

```bash
npm run linear:smoke          # MCP connectivity via linear-cli
npm run test:write-backend-wen320
npm run test:linear-apply-reliability
npm run test:readback-diff
npm run test:linear-cli-apply-architecture
```

Live MCP smoke requires `LINEAR_API_KEY`. Unit tests mock `connectLinearMcp` or use `{ mock: true }` in `mcp-adapter.mjs`.

## Deleted legacy stack

The following were removed in WEN-320 and must not be reintroduced:

- `scripts/linear-apply/executor.mjs`
- `scripts/linear-object-resolver.mjs`
- `scripts/linear-project-resolver.mjs`
- `scripts/linear-issue-resolver.mjs`
- `scripts/linear-project-status-resolver.mjs`
- Resolver-specific regression scripts (`test:issue-resolver`, etc.)

See `docs/ADR-002-m6-write-stack-decisions.md` for decision context.
