#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildWritePlan } from './write-plan-builder.mjs';
import { reviewWritePlan } from './plan-reviewer.mjs';

const workspaceManifest = {
  evidenceRef: 'state/fact-packs/fact-608e61ad4f4b.json',
  teams: [{ id: 'team-1', key: 'WEN', name: 'Wen Team' }],
  labels: [
    { id: 'label-backend', name: 'Backend', teamKey: 'WEN', group: 'Area' },
    { id: 'label-bug', name: 'Bug', teamKey: 'WEN', group: 'Type' }
  ],
  workflowStates: [
    { id: 'state-progress', name: 'In Progress', type: 'started', teamKey: 'WEN' }
  ],
  projectMilestones: [
    { id: 'milestone-1', name: 'M1', projectId: 'project-1' }
  ]
};

const projectBaseline = {
  project: {
    id: 'project-1',
    name: 'Demo Project',
    url: 'https://linear.app/demo/project/demo'
  }
};

function assertReviewPass(writePlan, message) {
  const review = reviewWritePlan(writePlan, { workspaceManifest });
  assert.equal(review.ok, true, `${message}: ${JSON.stringify(review.findings, null, 2)}`);
}

{
  const result = buildWritePlan({
    kind: 'single',
    projectBaseline,
    workspaceManifest,
    source: { issueIdentifier: 'WEN-288' },
    operations: [{
      type: 'projectUpdate.create',
      body: 'Project update body',
      health: 'onTrack'
    }]
  });
  assert.equal(result.ok, true);
  assert.match(result.idempotencyKey, /^write-plan-project-1-/);
  assert.equal(result.writePlan.operations[0].key, 'project-update-1');
  assert.equal(result.summary.operationCount, 1);
  assert.equal(result.nextToolCalls.approval.params.flow, 'plan_confirmation');
  assert.equal(result.nextToolCalls.apply.params.dryRun, false);
  assertReviewPass(result.writePlan, 'project update builder output must pass review');
}

{
  const result = buildWritePlan({
    workspaceManifest,
    operations: [{
      type: 'projectUpdate.create',
      body: 'Missing target project'
    }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'evidence_gap');
  assert.match(result.evidenceGaps.join('\n'), /targetProjectId|projectBaseline\.project\.id/i);
}

{
  const result = buildWritePlan({
    projectBaseline,
    workspaceManifest,
    operations: [{
      type: 'issue.create',
      title: 'Missing milestone',
      description: 'Acceptance criteria:\n- Builder blocks missing milestone',
      teamKey: 'WEN',
      labelNames: ['Backend']
    }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'evidence_gap');
  assert.match(result.evidenceGaps.join('\n'), /milestone/i);
}

{
  const result = buildWritePlan({
    projectBaseline,
    workspaceManifest,
    operations: [{
      type: 'issue.create',
      title: 'Create builder issue',
      description: 'Acceptance criteria:\n- Builder creates a reviewed write plan',
      teamKey: 'WEN',
      labelNames: ['Backend'],
      milestoneName: 'M1'
    }]
  });
  assert.equal(result.ok, true);
  const input = result.writePlan.operations[0].input;
  assert.equal(input.projectId, 'project-1');
  assert.equal(input.projectMilestoneId, 'milestone-1');
  assert.deepEqual(input.labelIds, ['label-backend']);
  assert.equal(result.writePlan.targetMilestoneReadback.id, 'milestone-1');
  assertReviewPass(result.writePlan, 'issue create builder output must pass review');
}

{
  const result = buildWritePlan({
    projectBaseline,
    workspaceManifest,
    operations: [{
      kind: 'issue.create',
      title: 'Create builder issue with kind alias',
      description: 'Acceptance criteria:\n- Builder accepts kind as an input alias',
      teamKey: 'WEN',
      labelNames: ['Backend'],
      milestoneName: 'M1'
    }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.writePlan.operations[0].type, 'issue.create');
  assert.equal(result.writePlan.operations[0].input.title, 'Create builder issue with kind alias');
  assertReviewPass(result.writePlan, 'kind alias builder output must pass review');
}

{
  const result = buildWritePlan({
    projectBaseline,
    workspaceManifest: {
      ...workspaceManifest,
      teams: [
        { id: 'wrong-team', name: 'Wrong Team' },
        { id: 'team-2', key: 'WEN2', name: 'Second Wen Team' }
      ],
      labels: [
        { id: 'label-backend-2', name: 'Backend', teamKey: 'WEN2', group: 'Area' }
      ]
    },
    operations: [{
      type: 'issue.create',
      title: 'Create builder issue by team id',
      description: 'Acceptance criteria:\n- Builder resolves teamId without matching blank team keys',
      teamId: 'team-2',
      labelNames: ['Backend'],
      milestoneName: 'M1'
    }]
  });
  assert.equal(result.ok, true);
  const input = result.writePlan.operations[0].input;
  assert.equal(input.teamKey, 'WEN2');
  assert.equal(input.teamId, 'team-2');
  assert.deepEqual(input.labelIds, ['label-backend-2']);
}

{
  const result = buildWritePlan({
    projectBaseline,
    workspaceManifest,
    operations: [{
      type: 'issue.update',
      issueId: 'issue-1',
      teamKey: 'WEN',
      stateName: 'In Progress',
      addedLabelNames: ['Bug']
    }]
  });
  assert.equal(result.ok, true);
  const input = result.writePlan.operations[0].input;
  assert.equal(input.issueId, 'issue-1');
  assert.equal(input.stateId, 'state-progress');
  assert.deepEqual(input.addedLabelIds, ['label-bug']);
  assertReviewPass(result.writePlan, 'issue update builder output must pass review');
}

{
  const result = buildWritePlan({
    projectBaseline,
    workspaceManifest,
    operations: [{
      type: 'issueRelation.create',
      issueId: 'issue-1',
      relatedIssueId: 'issue-2',
      relationType: 'blocks'
    }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.writePlan.operations[0].input.type, 'blocks');
  assertReviewPass(result.writePlan, 'issue relation builder output must pass review');
}

{
  const result = buildWritePlan({
    projectBaseline,
    workspaceManifest,
    operations: [{
      type: 'issue.create',
      title: 'Missing label',
      description: '验收标准:\n- Builder blocks missing label',
      teamKey: 'WEN',
      labelNames: ['Missing'],
      milestoneName: 'M1'
    }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'evidence_gap');
  assert.match(result.evidenceGaps.join('\n'), /label could not be resolved/i);
}

{
  const result = buildWritePlan({
    projectBaseline,
    workspaceManifest,
    operations: [{
      title: 'Missing operation type',
      description: 'Acceptance criteria:\n- Error explains operation format',
      teamKey: 'WEN',
      labelNames: ['Backend'],
      milestoneName: 'M1'
    }]
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'evidence_gap');
  const gaps = result.evidenceGaps.join('\n');
  assert.match(gaps, /operations\[0\]\.type/i);
  assert.match(gaps, /kind alias/i);
  assert.match(gaps, /issue\.create/i);
  assert.match(gaps, /example/i);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-plan-builder-'));
  const manifestPath = path.join(dir, 'manifest.json');
  const inputPath = path.join(dir, 'input.json');
  const outPath = path.join(dir, 'write-plan.json');
  fs.writeFileSync(manifestPath, JSON.stringify(workspaceManifest, null, 2));
  fs.writeFileSync(inputPath, JSON.stringify({
    projectBaseline,
    workspaceManifestPath: manifestPath,
    operations: [{
      type: 'projectUpdate.create',
      body: 'CLI generated update'
    }]
  }, null, 2));
  const result = spawnSync(process.execPath, ['scripts/write-plan-builder.mjs', '--input', inputPath, '--out', outPath], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(fs.existsSync(outPath), true);
  const persisted = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(persisted.idempotencyKey, output.idempotencyKey);
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const adminTools = fs.readFileSync('.pi/extensions/linear-admin-tools.ts', 'utf8');
  assert.match(adminTools, /linear_build_write_plan/);
  assert.match(adminTools, /structured write plan builder/i);
  assert.match(adminTools, /readback diff/i);
}

console.log('write plan builder tests passed');
