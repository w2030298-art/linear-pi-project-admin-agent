#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adrPath = path.join(root, 'docs/ADR-002-m6-write-stack-decisions.md');
const scopePath = path.join(root, 'docs/SCOPE_FREEZE.md');
const policyPath = path.join(root, 'config/write-policy.yaml');
const envExamplePath = path.join(root, '.env.example');

const adr = fs.readFileSync(adrPath, 'utf8');
const scope = fs.readFileSync(scopePath, 'utf8');
const policy = parseYaml(fs.readFileSync(policyPath, 'utf8'));
const envExample = fs.readFileSync(envExamplePath, 'utf8');

assert.match(adr, /路径 A.*官方 Linear MCP/);
assert.match(adr, /拒绝路径 B/);
assert.match(adr, /LINEAR_WRITE_BACKEND.*sdk.*mcp/s);
assert.match(adr, /planDigest 全量退场/);
assert.match(adr, /保留极简 idempotencyKey/);
assert.match(adr, /T3 分阶段并存安全网/);
assert.match(adr, /L4\/L5 硬 deny.*protectedFields 保留/s);

assert.match(scope, /M6 解冻/);
assert.match(scope, /已解冻/);
assert.match(scope, /WEN-312/);
assert.match(scope, /ADR-002/);

assert.equal(policy.levels.L4.default, 'deny');
assert.equal(policy.levels.L5.default, 'deny');
assert.ok(policy.protectedFields.includes('token'));
assert.ok(policy.protectedFields.includes('secret'));
assert.ok(policy.protectedFields.includes('apiKey'));

assert.match(envExample, /LINEAR_WRITE_BACKEND=sdk/);

console.log('test-m6-decisions-wen312: all assertions passed');
