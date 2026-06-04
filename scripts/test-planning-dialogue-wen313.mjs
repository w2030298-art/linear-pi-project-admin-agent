#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const planningSkill = read('.agents/skills/20-project-planning/SKILL.md');
const coreSkill = read('.agents/skills/00-linear-admin-core/SKILL.md');
const orchestration = parseYaml(read('config/orchestration-policy.yaml'));

assert.match(planningSkill, /五步协作循环/);
assert.match(planningSkill, /What.*Why.*Who.*How/s);
assert.match(planningSkill, /2.?3 个带权衡的方案|至少 2 个可行方案/);
assert.match(planningSkill, /挑战至少 1 个关键假设/);
assert.match(planningSkill, /锚定事实/);
assert.match(planningSkill, /收敛后出计划/);
assert.match(planningSkill, /禁止.*方案对比.*你选哪个方案/s);
assert.match(planningSkill, /收敛计划事实一致性/);
assert.match(planningSkill, /禁止.*同一条目同时出现在/);
assert.ok(planningSkill.split('\n').length >= 55, 'planning skill should be ~60-80 lines');

assert.match(coreSkill, /两段式/);
assert.match(coreSkill, /## 协作对话/);
assert.match(coreSkill, /## 收敛计划/);
assert.match(coreSkill, /方案对比完成后须.*主动.*继续假设挑战/);
assert.match(coreSkill, /不得包含事实锚定阶段仍为假设/);

assert.equal(orchestration.planning.dialogue.requireFourGrid, true);
assert.equal(orchestration.planning.dialogue.minAlternatives, 2);
assert.equal(orchestration.planning.dialogue.minAssumptionChallenges, 1);
assert.equal(orchestration.planning.dialogue.requireFactAnchoring, true);
assert.equal(orchestration.planning.dialogue.outputFormat, 'two_section');
assert.equal(orchestration.planning.dialogue.prohibitOptionSelectionBeforeSteps3And4, true);
assert.equal(orchestration.planning.dialogue.requireFactAssumptionConsistencyInConvergedPlan, true);
assert.equal(orchestration.planning.dialogue.promptInputBinding, 'pi_slash_arguments_via_ARGUMENTS');

const prompts = [
  '.pi/prompts/create-project.md',
  '.pi/prompts/extend-project.md',
  '.pi/prompts/portfolio-review.md',
  '.pi/prompts/project-report.md',
  '.pi/prompts/fact-pack.md',
  '.pi/prompts/workspace-sync.md'
];

for (const rel of prompts) {
  const text = read(rel);
  assert.doesNotMatch(text, /^目标：.*可写入 Linear/m, `${rel} should not open with writable-plan-only goal`);
  assert.match(text, /协作对话|四格|锚定事实|收敛|Fact Pack|两段式/s, `${rel} should reference dialogue-first planning`);
  assert.match(text, /详细要求信息：\$ARGUMENTS/, `${rel} should pass slash input through a user-facing detail field`);
  assert.match(text, /\$ARGUMENTS/, `${rel} should use Pi-supported slash arguments`);
  assert.doesNotMatch(text, /\{\{input\}\}/, `${rel} should not use unsupported template placeholders`);
  assert.doesNotMatch(text, /用户输入|Pi slash 参数|输入绑定|prompt template/i, `${rel} should not expose template mechanics`);
}

assert.match(read('.pi/prompts/create-project.md'), /五步协作循环/);
assert.match(read('.pi/prompts/create-project.md'), /\$ARGUMENTS/);
assert.match(read('.pi/prompts/create-project.md'), /禁止在方案对比后直接进入/);
assert.match(read('.pi/prompts/extend-project.md'), /五步协作对话|五步协作/);
assert.match(read('.pi/prompts/fact-pack.md'), /锚定事实/);

console.log('test-planning-dialogue-wen313: all assertions passed');
