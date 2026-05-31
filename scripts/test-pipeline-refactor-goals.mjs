#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  buildEvidenceBackedFact,
  compactFactPack,
  evidenceStorePathForFactPack
} from './fact-pack-utils.mjs';
import { linearWriteGuardDecision } from '../.pi/extensions/linear-write-guard.ts';

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assertNoCycleNoise(file) {
  const text = read(file);
  assert.doesNotMatch(
    text,
    /\bcycles?\b|Cycle|cycleId|Agent:CyclePlan|\/cycle-plan/i,
    `${file} should not carry active cycle facts or disabled-cycle instructions`
  );
}

for (const file of [
  'SYSTEM.md',
  'README.md',
  'config/orchestration-policy.yaml',
  'docs/OPERATIONS.md',
  'docs/FACT_SOURCES.md',
  '.agents/AGENTS.md',
  '.agents/skills/10-fact-ingestion/SKILL.md',
  '.agents/skills/create-linear-project/SKILL.md',
  '.agents/skills/extend-linear-project/SKILL.md',
  '.agents/skills/linear-project-report/SKILL.md',
  '.agents/skills/linear-portfolio-review/SKILL.md',
  '.pi/prompts/create-project.md',
  '.pi/prompts/extend-project.md',
  '.pi/prompts/portfolio-review.md'
]) {
  assertNoCycleNoise(file);
}

assert.equal(fs.existsSync(path.join(root, '.pi/prompts/cycle-plan.md')), false, 'cycle prompt should be removed from active prompts');
assert.equal(fs.existsSync(path.join(root, '.agents/skills/linear-cycle-planning/SKILL.md')), false, 'cycle planning skill should be removed from active skills');

const factSources = read('config/fact-sources.yaml');
assert.doesNotMatch(factSources, /portfolio_review/, 'Fact Pack policy should not force workspace-wide portfolio review');

const portfolioPrompt = read('.pi/prompts/portfolio-review.md');
assert.match(portfolioPrompt, /一次最多处理一个\s*Project|single project/i);
assert.doesNotMatch(portfolioPrompt, /所有活跃|all active|workspace 中所有/i);

const sampleRaw = {
  ok: true,
  sourceType: 'linear_live',
  data: {
    project: {
      id: 'project-1',
      name: '示例项目',
      url: 'https://linear.app/example/project/project-1',
      issues: {
        nodes: Array.from({ length: 80 }, (_, index) => ({
          identifier: `WEN-${index + 1}`,
          title: `Issue ${index + 1}`,
          description: 'x'.repeat(300)
        }))
      }
    }
  }
};
const fact = buildEvidenceBackedFact({
  claim: 'Linear project context was retrieved for project-1.',
  sourceType: 'linear_live',
  source: 'linear:project-1',
  confidence: 'high',
  raw: sampleRaw,
  factPackId: 'fact-test',
  evidenceKey: 'linear-project'
});
assert.equal(fact.rawRef, null, 'Fact Pack facts should not inline raw evidence');
assert.equal(fact.evidenceRef, 'state/fact-packs/evidence/fact-test/linear-project.json');
assert.ok(fact.summary.length < 1200, 'fact summary should stay compact');
assert.doesNotMatch(JSON.stringify(fact), /Issue 80/, 'fact object should not include full raw payload');
assert.equal(
  evidenceStorePathForFactPack('fact-test', 'linear-project'),
  'state/fact-packs/evidence/fact-test/linear-project.json'
);

const compacted = compactFactPack({
  id: 'fact-test',
  facts: [fact],
  assumptions: [],
  openQuestions: [],
  conflicts: [],
  evidenceGaps: [],
  planningImplications: []
});
assert.ok(JSON.stringify(compacted).length < 2500, 'compact Fact Pack should be small enough for prompt context');
assert.equal(compacted.evidenceManifest.length, 1);
assert.equal(compacted.evidenceManifest[0].path, fact.evidenceRef);

assert.deepEqual(
  linearWriteGuardDecision({ dryRun: false, confirmationChannel: 'ask_user', confirmedByUser: false }),
  {
    action: 'block',
    message: 'Blocked linear_apply_write_plan: real writes require pi_ask_user(flow=write_confirmation) approval before apply.'
  }
);

const runtimeCheck = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'scripts/install-wezterm-linear-pi-shortcut.ps1',
    '-SkipRuntimeInit',
    '-SelfTestAllowedRuntimeDirty'
  ],
  { cwd: root, encoding: 'utf8' }
);
assert.equal(runtimeCheck.status, 0, runtimeCheck.stderr || runtimeCheck.stdout);
assert.match(runtimeCheck.stdout, /ignoredRuntimeDirtyAllowed/i);

console.log('pipeline refactor goal tests passed');
