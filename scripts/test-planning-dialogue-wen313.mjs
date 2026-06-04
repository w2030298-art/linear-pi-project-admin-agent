#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const planningSkill = read('.agents/skills/20-project-planning/SKILL.md');
const coreSkill = read('.agents/skills/00-linear-admin-core/SKILL.md');
const orchestration = parseYaml(read('config/orchestration-policy.yaml'));

assert.match(planningSkill, /Project Planning/);
assert.match(planningSkill, /What.*Why.*Who.*How/s);
assert.match(planningSkill, /2.?3|MVP|vNext/);
assert.match(planningSkill, /### 3\./);
assert.match(planningSkill, /Fact Pack|evidenceRef/);
assert.match(planningSkill, /converged|write plan/i);
assert.ok(planningSkill.split('\n').length >= 55);

assert.match(coreSkill, /Linear Admin Core/);
assert.match(coreSkill, /linear_validate_and_apply_write_plan/);
assert.match(coreSkill, /write plan/);
assert.match(coreSkill, /readback/);
assert.match(coreSkill, /audit/);

assert.equal(orchestration.planning.dialogue.requireFourGrid, true);
assert.equal(orchestration.planning.dialogue.minAlternatives, 2);
assert.equal(orchestration.planning.dialogue.minAssumptionChallenges, 1);
assert.equal(orchestration.planning.dialogue.requireFactAnchoring, true);
assert.equal(orchestration.planning.dialogue.outputFormat, 'two_section');
assert.equal(orchestration.planning.dialogue.prohibitOptionSelectionBeforeSteps3And4, true);
assert.equal(orchestration.planning.dialogue.requireFactAssumptionConsistencyInConvergedPlan, true);
assert.equal(orchestration.planning.dialogue.promptInputBinding, 'pi_slash_arguments_via_ARGUMENTS');

for (const rel of [
  '.pi/prompts/create-project.md',
  '.pi/prompts/extend-project.md',
  '.pi/prompts/portfolio-review.md',
  '.pi/prompts/project-report.md',
  '.pi/prompts/fact-pack.md',
  '.pi/prompts/workspace-sync.md'
]) {
  const text = read(rel);
  assert.doesNotMatch(text, /^Goal:.*writable Linear/m);
  assert.match(text, /collaboration|four-grid|anchor facts|convergence|Fact Pack|two-section/i);
  assert.match(text, /Detailed requirements: \$ARGUMENTS/);
  assert.match(text, /\$ARGUMENTS/);
  assert.doesNotMatch(text, /\{\{input\}\}/);
  assert.doesNotMatch(text, /user input|Pi slash parameters|input binding|prompt template/i);
}

assert.match(read('.pi/prompts/create-project.md'), /five-step collaboration loop/);
assert.match(read('.pi/prompts/create-project.md'), /\$ARGUMENTS/);
assert.match(read('.pi/prompts/create-project.md'), /After options, challenge assumptions and anchor facts/);
assert.match(read('.pi/prompts/extend-project.md'), /five-step collaboration/i);
assert.match(read('.pi/prompts/fact-pack.md'), /anchor/i);

console.log('test-planning-dialogue-wen313: all assertions passed');
