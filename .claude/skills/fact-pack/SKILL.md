---
name: fact-pack
description: Build a Claude Code native Fact Pack for Linear Project Admin work by collecting Linear, GitHub, local, local docs, and web evidence through MCP, SDK-backed CLI, or auditable local CLI adapters.
allowed-tools: Read Glob Grep Bash mcp__github__get_file_contents mcp__github__search_code mcp__github__search_issues mcp__github__search_pull_requests mcp__github__list_commits mcp__github__list_pull_requests WebSearch WebFetch
---

# Fact Pack

Use this skill before complex Linear planning, reporting, issue dispatch, repo-map repair, or workspace sync.

## Required Contract

Build or refresh a compact Fact Pack with:

- `facts`
- `conflicts`
- `evidenceGaps`
- `planningImplications`
- `evidenceManifest`

Raw evidence must stay on disk under `state/fact-packs/evidence/<fact-id>/`; do not paste large JSON into the conversation.

## Source Adapters

Use the adapters in this order:

1. Linear Project facts: SDK-backed auditable CLI, `node scripts/linear-cli.mjs project <project-id-or-key>`.
2. GitHub remote facts: GitHub MCP from project `.mcp.json`; use `node scripts/github-evidence.mjs snapshot` only as the local REST/CLI audit fallback.
3. Local repo facts: auditable CLI, `node scripts/local-evidence.mjs --root <repo-map-localPath>`.
4. Local docs facts: Claude Code native `Read`, `Glob`, and `Grep` scoped to repo-map `docs`; summarize through the Fact Pack instead of inlining full files.
5. Web facts: web-search adapter, `node scripts/web-search.mjs`, only when current external/official evidence is required and citations are preserved.

## Repo-Map Rule

For a selected `repoKey`, repo-map is the source of truth. If the repo-map entry is missing GitHub owner/repo/defaultBranch or `localPath`, record an `evidenceGaps` item and do not fall back to runtime `cwd`, `LOCAL_REPO_ROOTS`, or `GITHUB_DEFAULT_*`.

## Command

Prefer the orchestrator:

```bash
node scripts/fact-pack.mjs --task "$ARGUMENTS" --repo <repoKey> --web
```

Use `--no-github`, `--no-local`, or `--no-linear` only when intentionally proving gap behavior or running tests.
