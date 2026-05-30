#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

assert.equal(fs.existsSync('AGENTS.md'), false, 'root AGENTS.md should not steer Codex development sessions');

const validateLayout = fs.readFileSync('scripts/validate-layout.mjs', 'utf8');
assert.doesNotMatch(validateLayout, /['"]AGENTS\.md['"]/);

const system = fs.readFileSync('SYSTEM.md', 'utf8');
assert.match(system, /Linear Project Admin Runtime/);
assert.match(system, /Fact Pack/);
assert.match(system, /dry-run/);
assert.match(system, /一.*Project|one.*Project/i);

const readme = fs.readFileSync('README.md', 'utf8');
const deployment = fs.readFileSync('docs/DEPLOYMENT.md', 'utf8');
assert.doesNotMatch(readme, /^AGENTS\.md\s+#/m);
assert.doesNotMatch(deployment, /^\s*-\s*`AGENTS\.md`/m);
assert.doesNotMatch(deployment, /`AGENTS\.md`\s*[\r\n]/);

const samplePlan = fs.readFileSync('examples/project-plan.sample.json', 'utf8');
assert.doesNotMatch(samplePlan, /AGENTS\.md Fact Pack protocol/);
assert.doesNotMatch(samplePlan, /"source":\s*"AGENTS\.md"/);

const planReviewerTest = fs.readFileSync('scripts/test-plan-reviewer.mjs', 'utf8');
assert.doesNotMatch(planReviewerTest, /source:\s*'AGENTS\.md'/);

console.log('runtime instruction boundary tests passed');
