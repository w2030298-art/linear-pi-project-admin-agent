#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const requiredFiles = [
  '.mcp.json',
  '.claude/settings.json',
  '.claude/skills/fact-pack/SKILL.md',
  'docs/CLAUDE_CODE_FACT_PACK.md'
];

for (const file of requiredFiles) {
  assert.equal(fs.existsSync(file), true, `${file} should exist`);
}

const mcp = JSON.parse(fs.readFileSync('.mcp.json', 'utf8'));
assert.equal(mcp.mcpServers.github.command, 'docker');
assert.deepEqual(mcp.mcpServers.github.env.GITHUB_TOOLSETS.split(','), [
  'context',
  'repos',
  'issues',
  'pull_requests',
  'actions'
]);

const settings = JSON.parse(fs.readFileSync('.claude/settings.json', 'utf8'));
assert.match(settings.permissions.deny.join('\n'), /ALLOW_LINEAR_WRITES=true/);
assert.match(settings.permissions.deny.join('\n'), /LINEAR_WRITE_MODE=real/);
assert.equal(settings.env.LINEAR_WRITE_MODE, 'dry-run');
assert.equal(settings.env.ALLOW_LINEAR_WRITES, 'false');

const skill = fs.readFileSync('.claude/skills/fact-pack/SKILL.md', 'utf8');
for (const phrase of [
  'Linear Project facts: SDK-backed auditable CLI',
  'GitHub remote facts: GitHub MCP',
  'Local repo facts: auditable CLI',
  'Local docs facts: Claude Code native',
  'Web facts: web-search adapter',
  'do not fall back to runtime `cwd`, `LOCAL_REPO_ROOTS`, or `GITHUB_DEFAULT_*`'
]) {
  assert.match(skill, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const docs = fs.readFileSync('docs/CLAUDE_CODE_FACT_PACK.md', 'utf8');
assert.match(docs, /Carrier Matrix/);
assert.match(docs, /facts`, `conflicts`, `evidenceGaps`, `planningImplications`, and `evidenceManifest`/);

const schema = JSON.parse(fs.readFileSync('schemas/fact-pack.schema.json', 'utf8'));
for (const key of ['facts', 'conflicts', 'evidenceGaps', 'planningImplications']) {
  assert.equal(schema.required.includes(key), true, `schema should require ${key}`);
}
assert.equal(Object.hasOwn(schema.properties, 'evidenceManifest'), true);

console.log('claude code fact pack tests passed');
