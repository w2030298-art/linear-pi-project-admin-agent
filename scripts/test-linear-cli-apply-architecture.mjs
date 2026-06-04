#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const requiredModules = [
  'scripts/linear-apply/schema.mjs',
  'scripts/linear-apply/normalize.mjs',
  'scripts/linear-apply/final-validation.mjs',
  'scripts/linear-apply/mcp-adapter.mjs',
  'scripts/linear-apply/readback-diff.mjs',
  'scripts/linear-apply/audit.mjs',
  'scripts/linear-apply/command.mjs',
  'scripts/linear-mcp-match.mjs'
];

for (const modulePath of requiredModules) {
  assert.equal(fs.existsSync(modulePath), true, `${modulePath} should exist`);
  if (modulePath.endsWith('linear-mcp-match.mjs')) continue;
  assert.match(fs.readFileSync(modulePath, 'utf8'), /@ts-check/, `${modulePath} should opt into TypeScript checkJs`);
}

const commandSource = fs.readFileSync('scripts/linear-apply/command.mjs', 'utf8');
assert.doesNotMatch(commandSource, /executor\.mjs/);
assert.match(commandSource, /mutateMcp/);
assert.match(commandSource, /readbackMcp/);
assert.equal(fs.existsSync('scripts/linear-apply/executor.mjs'), false);

const cli = fs.readFileSync('scripts/linear-cli.mjs', 'utf8');
assert.ok(cli.length < 20_000, 'linear-cli.mjs should no longer own the full apply pipeline');
assert.doesNotMatch(cli, /function validateWritePlan/);
assert.doesNotMatch(cli, /async function normalizeInput/);
assert.doesNotMatch(cli, /async function mutate/);
assert.doesNotMatch(cli, /async function readback/);
assert.doesNotMatch(cli, /function appendAudit/);
assert.match(cli, /from '\.\/linear-apply\/command\.mjs'/);
assert.match(cli, /validate-write-plan/);

const tsconfig = JSON.parse(fs.readFileSync('tsconfig.test.json', 'utf8'));
assert.ok(tsconfig.include.includes('.pi/extensions/**/*.ts'));
assert.ok(tsconfig.include.includes('services/**/*.ts'));
assert.ok(tsconfig.include.includes('scripts/test-*.ts'));
assert.ok(tsconfig.include.includes('scripts/linear-apply/**/*.mjs'));
assert.equal(tsconfig.compilerOptions.allowJs, true);
assert.equal(tsconfig.compilerOptions.checkJs, true);

const typecheck = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json', '--noEmit'], { encoding: 'utf8' });
assert.equal(typecheck.status, 0, typecheck.stderr || typecheck.stdout);

const schemaModule = await import('./linear-apply/schema.mjs');
assert.equal(typeof schemaModule.parseWritePlan, 'function');
assert.throws(
  () => schemaModule.parseWritePlan({ operations: [{ type: 'issue.create', input: { title: 'bad', cycleId: 'cycle-1' } }] }, { dryRun: true }),
  /cycleId is not supported/
);
assert.throws(
  () => schemaModule.parseWritePlan({ operations: [{ type: 'unknown.create', input: {} }] }, { dryRun: true }),
  /unsupported type/
);

console.log('linear cli apply architecture tests passed');
