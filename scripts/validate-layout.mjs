import fs from 'node:fs';
import { json } from './utils.mjs';
import { validateConfigSecurityGate } from './config-security-gate.mjs';

const required = [
  '.pi/settings.json',
  '.mcp.json',
  '.claude/settings.json',
  '.claude/skills/fact-pack/SKILL.md',
  '.pi/extensions/linear-admin-tools.ts',
  '.pi/extensions/fact-source-router.ts',
  '.pi/extensions/runtime-master-reload.ts',
  '.github/workflows/runtime-ci.yml',
  '.agents/skills/10-fact-ingestion/SKILL.md',
  'config/fact-sources.yaml',
  'config/repo-map.yaml',
  'config/workspace.manifest.json',
  'schemas/repo-map.schema.json',
  'services/linear-bridge/src/server.ts',
  'scripts/config-security-gate.mjs',
  'scripts/repo-map.mjs',
  'scripts/repo-map-drift.mjs',
  'scripts/plan-reviewer.mjs',
  'scripts/portfolio-snapshot-utils.mjs',
  'scripts/retrieval-utils.mjs',
  'scripts/test-linear-snapshot.mjs',
  'scripts/test-config-security-gate.mjs',
  'scripts/test-retrieval-ux.mjs',
  'scripts/test-write-confirmation-ux.ts',
  'scripts/test-runtime-reload-master.ts',
  'scripts/test-runtime-local-protection.mjs',
  'scripts/test-runtime-instruction-boundary.mjs',
  'scripts/test-runtime-deployment-gates.mjs',
  'scripts/runtime-acceptance.mjs',
  'scripts/test-repo-map-drift.mjs',
  'examples/project-plan.sample.json',
  'examples/write-plan.sample.json',
  'README.md',
  'docs/DEPLOYMENT.md',
  'docs/SCOPE_FREEZE.md',
  'docs/ADR-002-m6-write-stack-decisions.md',
  'docs/SECURITY.md',
  'docs/OPERATIONS.md',
  'docs/CLAUDE_CODE_FACT_PACK.md'
];

const missing = required.filter(p => !fs.existsSync(p));
const configSecurity = validateConfigSecurityGate();
const ok = missing.length === 0 && configSecurity.ok;
json({ ok, missing, configSecurity });
if (!ok) process.exit(1);
