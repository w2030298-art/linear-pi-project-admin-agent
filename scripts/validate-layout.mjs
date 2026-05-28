import fs from 'node:fs';
import { json } from './utils.mjs';

const required = [
  'AGENTS.md',
  '.pi/settings.json',
  '.pi/extensions/linear-admin-tools.ts',
  '.pi/extensions/fact-source-router.ts',
  '.agents/skills/10-fact-ingestion/SKILL.md',
  'config/fact-sources.yaml',
  'config/workspace.manifest.json',
  'services/linear-bridge/src/server.ts',
  'README.md',
  'docs/DEPLOYMENT.md'
];

const missing = required.filter(p => !fs.existsSync(p));
json({ ok: missing.length === 0, missing });
if (missing.length) process.exit(1);
