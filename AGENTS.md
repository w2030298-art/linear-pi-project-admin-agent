# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

A Node (ESM + TypeScript) scaffold for a Linear-native "project administrator" Pi agent: fact ingestion (Linear/GitHub/local/web), a webhook bridge, write governance, and project-plan review. See `README.md`, `SYSTEM.md`, and `docs/` for details.

## Common Commands

- Install: `npm install`
- Layout + config-security validation: `npm run validate`
- Merge-gate test suite: `npm test` (config-security, typecheck, webhook signature/prompt-injection, write-plan validation, validate/apply tool)
- Webhook bridge dev server: `npm run bridge:dev`
- Many focused checks: see the `test:*` scripts in `package.json`.

## Cursor Cloud specific instructions

- Node deps are installed automatically on VM startup (`npm install`). `npm install` warns that `undici` wants Node `>=22.19` while the VM has `22.14`; this is only a warning and `npm run validate`, `npm test`, and the bridge all run fine.
- CI is configured for Windows, but `npm run validate` and `npm test` pass on this Linux VM with no extra setup or secrets.
- Runnable service: `npm run bridge:dev` (tsx) starts the Express Linear webhook bridge on `BRIDGE_PORT` (default `8787`) with a health endpoint at `GET /healthz`. It boots without any external secrets; Linear writes and webhook verification require the env vars in `.env.example`.
- Real Linear/GitHub/web operations (`npm run linear:smoke`, `fact:pack`, etc.) need the corresponding API keys from `.env.example`; without them only the local validation/test/bridge flows are exercisable.
