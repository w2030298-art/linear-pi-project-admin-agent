import fs from 'node:fs';
import { json } from './utils.mjs';

const required = [
  'AGENTS.md',
  '.pi/settings.json',
  '.pi/extensions/linear-admin-tools.ts',
  '.pi/extensions/fact-source-router.ts',
  '.pi/extensions/runtime-master-reload.ts',
  '.agents/skills/10-fact-ingestion/SKILL.md',
  'config/fact-sources.yaml',
  'config/repo-map.yaml',
  'config/workspace.manifest.json',
  'schemas/repo-map.schema.json',
  'services/linear-bridge/src/server.ts',
  'scripts/repo-map.mjs',
  'scripts/repo-map-drift.mjs',
  'scripts/plan-reviewer.mjs',
  'scripts/portfolio-snapshot-utils.mjs',
  'scripts/retrieval-utils.mjs',
  'scripts/test-linear-snapshot.mjs',
  'scripts/test-retrieval-ux.mjs',
  'scripts/test-write-confirmation-ux.ts',
  'scripts/test-runtime-reload-master.ts',
  'scripts/test-repo-map-drift.mjs',
  'examples/project-plan.sample.json',
  'examples/write-plan.sample.json',
  'README.md',
  'docs/DEPLOYMENT.md',
  'docs/SCOPE_FREEZE.md',
  'docs/SECURITY.md',
  'docs/OPERATIONS.md'
];

const missing = required.filter(p => !fs.existsSync(p));
json({ ok: missing.length === 0, missing });
if (missing.length) process.exit(1);
