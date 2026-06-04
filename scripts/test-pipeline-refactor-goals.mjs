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
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

const piSettings = JSON.parse(read('.pi/settings.json'));
assert.equal(piSettings.enableSkillCommands, false);
assert.deepEqual(piSettings.prompts, ['prompts']);
assert.deepEqual(piSettings.skills, ['../.agents/skills']);
assert.equal(piSettings.extensions.includes('extensions/linear-plan-reviewer.ts'), false);

const promptSkillMap = {
  'create-project.md': { skill: 'create-linear-project', mode: 'Create Project Mode' },
  'extend-project.md': { skill: 'extend-linear-project', mode: 'Extend Project Mode' },
  'fact-pack.md': { skill: 'fact-ingestion', mode: 'Fact Pack Mode' },
  'issue-dispatch.md': { skill: 'issue-orchestration', mode: 'Issue Dispatch Mode' },
  'portfolio-review.md': { skill: 'linear-portfolio-review', mode: 'Portfolio Review Mode' },
  'project-report.md': { skill: 'linear-project-report', mode: 'Report Mode' },
  'workspace-sync.md': { skill: 'workspace-sync', mode: 'Workspace Sync Mode' }
};

const activePromptFiles = fs.readdirSync(path.join(root, '.pi/prompts')).filter(file => file.endsWith('.md')).sort();
assert.deepEqual(activePromptFiles, Object.keys(promptSkillMap).sort(), 'Active Pi prompts should be the single slash interface');

for (const [file, { skill, mode }] of Object.entries(promptSkillMap)) {
  const text = read('.pi/prompts/' + file);
  assert.ok(text.split('\n').length <= 42, file + ' should stay a thin routing prompt');
  assert.doesNotMatch(text, /\{\{input\}\}/, file + ' should not use unsupported placeholders');
  assert.match(text, /\$ARGUMENTS/, file + ' should bind slash arguments');
  assert.match(text, new RegExp('\\*\\*' + mode + '\\*\\*'), file + ' should expose mode label');
  assert.match(text, new RegExp('Call skill:\\s*' + skill), file + ' should route to skill');
  assert.match(text, /Detailed requirements: \$ARGUMENTS/, file + ' should pass slash input');
  assert.match(text, /Behavior sources:/, file + ' should list behavior sources');
  assert.match(text, /collaboration-first planning/, file + ' should be planning-centered');
  assert.match(text, /writes are only the thin output adapter/, file + ' should keep writes as adapter');
  assert.match(text, /linear_validate_and_apply_write_plan/, file + ' should name the single write interface');
  assert.doesNotMatch(text, /ask_user|confirmedByUser|linear_apply_write_plan|write_confirmation|plan_confirmation|Prompt template|template variable|Cursor Agent/i, file + ' should not carry duplicate confirmation protocols');
}

for (const file of ['create-project.md', 'extend-project.md']) {
  const text = read('.pi/prompts/' + file);
  assert.match(text, /four-grid questions/i);
  assert.match(text, /2-3 weighted options|2-3 weighted/i);
  assert.match(text, /challenge assumptions/i);
  assert.match(text, /anchor facts/i);
  assert.match(text, /convergence/i);
}

for (const file of ['fact-pack.md', 'portfolio-review.md', 'project-report.md', 'workspace-sync.md', 'issue-dispatch.md']) {
  const text = read('.pi/prompts/' + file);
  assert.match(text, /fact/i);
  assert.match(text, /assumptions|pending confirmations/i);
  assert.match(text, /evidence gaps|evidenceRef/i);
}

const portfolioPrompt = read('.pi/prompts/portfolio-review.md');
assert.match(portfolioPrompt, /handle at most one Project|one Project only|single project/i);
assert.doesNotMatch(portfolioPrompt, /all active|workspace-wide full review/i);

const issueOrchestrationSkill = read('.agents/skills/40-issue-orchestration/SKILL.md');
assert.match(issueOrchestrationSkill, /派发 brief|issue dispatch brief/i);
assert.match(issueOrchestrationSkill, /不内嵌外部 agent 长模板|does not embed external agent/i);

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
  assert.doesNotMatch(read(file), /\bcycles?\b|Cycle|cycleId|Agent:CyclePlan|\/cycle-plan/i, file + ' should not carry active cycle facts');
}

assert.equal(fs.existsSync(path.join(root, '.pi/prompts/cycle-plan.md')), false);
assert.equal(fs.existsSync(path.join(root, '.agents/skills/linear-cycle-planning/SKILL.md')), false);
assert.doesNotMatch(read('config/fact-sources.yaml'), /portfolio_review/);

const sampleRaw = {
  ok: true,
  sourceType: 'linear_live',
  data: {
    project: {
      id: 'project-1',
      name: 'Sample Project',
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
    message: 'Blocked linear_apply_write_plan: real writes require one plan_confirmation approval from pi_ask_user before apply.'
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
