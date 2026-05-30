#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildFreezePlan,
  buildUnfreezePlan
} from './project-governance-template.mjs';

const project = {
  id: 'project-admin',
  name: 'linear-pi-project-admin-agent',
  url: 'https://linear.app/wentaoxu-personal-workplace/project/linear-pi-project-admin-agent-abc123',
  state: 'started',
  targetDate: '2026-07-05',
  issues: {
    nodes: [
      {
        id: 'issue-ready',
        identifier: 'WEN-1',
        title: 'Ready work',
        state: { id: 'state-ready', name: 'Ready', type: 'unstarted' }
      },
      {
        id: 'issue-progress',
        identifier: 'WEN-2',
        title: 'Active work',
        state: { id: 'state-started', name: 'In Progress', type: 'started' }
      },
      {
        id: 'issue-done',
        identifier: 'WEN-3',
        title: 'Done work',
        state: { id: 'state-done', name: 'Done', type: 'completed' }
      }
    ]
  }
};

const projectEvidence = {
  ok: true,
  sourceType: 'linear_live',
  collectedAt: '2026-05-30T00:00:00.000Z',
  data: { project }
};

const workspaceManifest = {
  evidenceRef: 'state/workspace-object-manifest.json',
  teams: [{ id: 'team-wen', key: 'WEN', name: 'WENTAOXU-personal-workplace' }],
  workflowStates: [
    { id: 'state-backlog', name: 'Backlog', type: 'backlog', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'state-ready', name: 'Ready', type: 'unstarted', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'state-started', name: 'In Progress', type: 'started', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'state-done', name: 'Done', type: 'completed', teamId: 'team-wen', teamKey: 'WEN' }
  ]
};

{
  const result = buildFreezePlan({
    projectUrl: `${project.url}/overview`,
    projectEvidence,
    workspaceManifest,
    moveActiveIssuesToBacklog: true,
    reason: 'Temporary capacity freeze.',
    recoveryCondition: 'Resume after bridge incident is closed.'
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.dryRun, true);
  assert.equal(result.plan.targetProjectId, project.id);
  assert.equal(result.plan.operations[0].type, 'projectUpdate.create');
  assert.match(result.plan.operations[0].input.body, /冻结范围/);
  assert.match(result.plan.operations[0].input.body, /恢复条件/);
  assert.match(result.plan.operations[0].input.body, /风险/);
  assert.match(result.plan.operations[0].input.body, /Non-changes/);
  assert.equal(JSON.stringify(result.plan).includes('statusId'), false);
  const issueUpdates = result.plan.operations.filter(operation => operation.type === 'issue.update');
  assert.deepEqual(issueUpdates.map(operation => operation.input.issueId), ['issue-ready', 'issue-progress']);
  assert.deepEqual(issueUpdates.map(operation => operation.input.stateId), ['state-backlog', 'state-backlog']);
  assert.equal(issueUpdates.some(operation => operation.input.issueId === 'issue-done'), false);
}

{
  const result = buildUnfreezePlan({
    projectUrl: project.url,
    projectEvidence,
    workspaceManifest
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unfreeze_recovery_entry_required');
  assert.equal(result.shouldReadLive, true);
  assert.match(result.message, /re-read/i);
}

{
  const result = buildUnfreezePlan({
    projectUrl: project.url,
    projectEvidence,
    workspaceManifest,
    recoveryEntry: 'resume-ready'
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.operations[0].type, 'projectUpdate.create');
  assert.match(result.plan.operations[0].input.body, /恢复入口/);
  assert.equal(JSON.stringify(result.plan).includes('targetDate'), false);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-governance-template-'));
  const evidencePath = path.join(dir, 'project.json');
  const manifestPath = path.join(dir, 'workspace.json');
  fs.writeFileSync(evidencePath, JSON.stringify(projectEvidence, null, 2));
  fs.writeFileSync(manifestPath, JSON.stringify(workspaceManifest, null, 2));
  const result = spawnSync(process.execPath, [
    'scripts/project-governance-template.mjs',
    'freeze',
    '--project-url',
    `${project.url}/overview`,
    '--project-evidence',
    evidencePath,
    '--workspace-manifest',
    manifestPath,
    '--move-active-issues-to-backlog',
    '--reason',
    'Temporary capacity freeze.',
    '--recovery-condition',
    'Resume after bridge incident is closed.'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.plan.operations[0].type, 'projectUpdate.create');
}

console.log('project governance template tests passed');
