---
name: fact-ingestion
description: Build a compact Fact Pack from Linear, GitHub, local repos, local docs, and web search before Linear project planning, extension, reporting, issue dispatch, repo-map work, or workspace sync.
---

# Fact Ingestion

Use this skill before Linear planning or reporting work. The goal is not to load every source into the model; the goal is to produce a compact digest with pointers to raw evidence stored on disk.

## Source Priority

1. Linear live data for project management facts.
2. GitHub remote evidence for repository facts.
3. Local repo evidence for working-copy facts.
4. Local docs for project documentation.
5. Web search for external or recent facts with citations.
6. User input for confirmed decisions.

## Output Contract

- `facts`: short claims with source type, source, timestamp, confidence, summary, and `evidenceRef`.
- `evidenceManifest`: file paths for full raw evidence under `state/fact-packs/evidence/`.
- `conflicts`: source conflicts that affect planning.
- `evidenceGaps`: important missing evidence.
- `planningImplications`: concrete impact on Linear planning.

## Boundaries

- Do not paste large raw JSON into the prompt.
- Do not treat web search as current repo implementation.
- Do not treat a dirty local branch as remote mainline fact.
- Do not write user ideas as confirmed decisions.
