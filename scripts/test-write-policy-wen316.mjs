#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policyPath = path.join(root, 'config/write-policy.yaml');
const readmePath = path.join(root, 'README.md');
const policy = parseYaml(fs.readFileSync(policyPath, 'utf8'));
const readme = fs.readFileSync(readmePath, 'utf8');

assert.equal(policy.version, 2);
assert.equal(policy.mode, 'solo');
assert.equal(policy.levels.L0.confirm, false);
assert.equal(policy.levels.L1_L2.confirm, 'once');
assert.equal(policy.levels.L1_L2.confirmVia, 'plan_confirmation');
assert.equal(policy.levels.L1_L2.requireReadback, true);
assert.equal(policy.levels.L1_L2.requireAudit, true);
assert.equal(policy.levels.L4.default, 'deny');
assert.equal(policy.levels.L5.default, 'deny');
assert.equal(policy.mutationDefaults.confirmOnceVia, 'ask_user_plan_confirmation');
assert.equal(policy.mutationDefaults.readbackRequired, true);
assert.equal(policy.mutationDefaults.auditLogRequired, true);
assert.ok(!policy.levels.L1, 'enterprise L1 level should be removed');
assert.ok(!policy.levels.L2, 'enterprise L2 level should be removed');
assert.ok(!policy.levels.L3, 'enterprise L3 level should be removed');
assert.ok(!policy.levels.L1_L2?.requireImpactReport, 'L3 requireImpactReport must be removed');

for (const field of ['token', 'secret', 'apiKey']) {
  assert.ok(policy.protectedFields.includes(field), `protectedFields must include ${field}`);
}

assert.match(readme, /solo/i);
assert.match(readme, /plan_confirmation/i);
assert.match(readme, /readback diff/i);
assert.match(readme, /五道闸.*solo|solo.*五道闸|L0.?L5.*solo/s);

console.log('test-write-policy-wen316: all assertions passed');
