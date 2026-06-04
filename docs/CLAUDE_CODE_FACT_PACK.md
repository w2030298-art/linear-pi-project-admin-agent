# Claude Code Fact Pack Source Adapters

WEN-304 rebuilds Fact Pack collection as a Claude Code native workflow without copying Pi extension APIs. The retained contract is the Fact Pack schema: `facts`, `conflicts`, `evidenceGaps`, `planningImplications`, and `evidenceManifest`.

## Carrier Matrix

| Source | Primary carrier | Auditable fallback | Write permission |
|---|---|---|---|
| Linear Project facts | SDK-backed CLI: `scripts/linear-cli.mjs project` using `@linear/sdk` | Future Linear MCP wrapper may call the same CLI/read path | Read-only for Fact Pack |
| GitHub remote facts | Project MCP server in `.mcp.json` using GitHub MCP | `scripts/github-evidence.mjs snapshot` REST/CLI evidence writer | Read-only |
| Local repo facts | Claude Code shell + `scripts/local-evidence.mjs --root <repo-map-localPath>` | Native `Read`/`Glob`/`Grep` for targeted inspection | Read-only |
| Local docs facts | Claude Code native `Read`/`Glob`/`Grep` scoped by repo-map `docs` | `scripts/local-evidence.mjs` summary | Read-only |
| Web facts | Web search adapter `scripts/web-search.mjs` with Tavily/Brave citations | Claude Code `WebSearch`/`WebFetch` when the session has those tools | Read-only |

## Claude Code Assets

- `.mcp.json` declares the shared project GitHub MCP server.
- `.claude/settings.json` denies sensitive files and real Linear write-mode switches while allowing read-only evidence commands.
- `.claude/skills/fact-pack/SKILL.md` is the project skill and slash-command entrypoint.
- `scripts/fact-pack.mjs` remains the auditable orchestrator and writes raw evidence under `state/fact-packs/evidence/<fact-id>/`.

## Repo-Map Completeness Rule

For an explicit `repoKey`, repo-map must provide GitHub owner/repo/defaultBranch, Linear locator, `localPath`, docs, and evidenceWeight. If GitHub or `localPath` is missing, the Fact Pack records an evidence gap and does not fall back to runtime `cwd`, `LOCAL_REPO_ROOTS`, or `GITHUB_DEFAULT_*`.

This preserves the safety boundary from the Pi runtime: wrapper/runtime clones can differ from implementation repos, but local and GitHub evidence must come from the selected repo-map entry only.
