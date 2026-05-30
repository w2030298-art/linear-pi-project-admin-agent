#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolveLinearObject,
  resolveWritePlanObjects
} from './linear-object-resolver.mjs';

const evidenceRef = 'state/workspace-manifest-cache.json';
const manifest = {
  evidenceRef,
  teams: [
    { id: 'team-wen', key: 'WEN', name: 'WENTAOXU-personal-workplace' },
    { id: 'team-ops', key: 'OPS', name: 'Ops' }
  ],
  labels: [
    { id: 'label-backend', name: 'Backend', group: 'area', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'label-frontend', name: 'Frontend', group: 'area', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'label-medium', name: 'Medium-difficulty', group: 'complexity', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'label-ops-backend', name: 'Backend', group: 'area', teamId: 'team-ops', teamKey: 'OPS' },
    { id: 'label-global-docs', name: 'Docs', group: 'type' }
  ],
  labelGroups: {
    area: { exactlyOne: true },
    complexity: { exactlyOne: true },
    type: { exactlyOne: false }
  },
  workflowStates: [
    { id: 'state-wen-started', name: 'In Progress', type: 'started', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'state-wen-done', name: 'Done', type: 'completed', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'state-ops-started', name: 'In Progress', type: 'started', teamId: 'team-ops', teamKey: 'OPS' }
  ],
  projectMilestones: [
    { id: 'ms-admin-m0', name: 'M0', projectId: 'project-admin' },
    { id: 'ms-other-m0', name: 'M0', projectId: 'project-other' }
  ]
};

{
  const result = resolveLinearObject(manifest, {
    kind: 'label',
    teamKey: 'WEN',
    name: 'Backend',
    group: 'area'
  });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'label-backend');
  assert.equal(result.evidenceRef, evidenceRef);
  assert.deepEqual(result.chain.map(step => step.source), ['team', 'label']);
}

{
  const result = resolveLinearObject(manifest, {
    kind: 'workflowState',
    teamKey: 'WEN',
    name: 'In Progress',
    type: 'started'
  });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'state-wen-started');
  assert.equal(result.evidenceRef, evidenceRef);
}

{
  const result = resolveLinearObject(manifest, {
    kind: 'projectMilestone',
    projectId: 'project-admin',
    name: 'M0'
  });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'ms-admin-m0');
  assert.equal(result.evidenceRef, evidenceRef);
}

{
  const result = resolveLinearObject(manifest, {
    kind: 'label',
    name: 'Backend'
  });
  assert.equal(result.ok, false);
  assert.equal(result.type, 'linear_object_resolution_gap');
  assert.equal(result.blocking, true);
  assert.match(result.message, /multiple/i);
  assert.deepEqual(result.candidates.map(candidate => candidate.id), ['label-backend', 'label-ops-backend']);
}

{
  const result = resolveWritePlanObjects({
    idempotencyKey: 'resolver-test',
    operations: [
      {
        type: 'issue.create',
        input: {
          teamKey: 'WEN',
          title: 'Conflicting labels',
          labelNames: ['Backend', 'Frontend']
        }
      }
    ]
  }, { manifest });
  assert.equal(result.ok, false);
  assert.equal(result.findings[0].code, 'linear_label_group_conflict');
  assert.equal(result.findings[0].blocking, true);
}

{
  const plan = {
    idempotencyKey: 'resolver-test',
    operations: [
      {
        type: 'issue.create',
        input: {
          teamKey: 'WEN',
          projectId: 'project-admin',
          milestoneName: 'M0',
          workflowStateName: 'In Progress',
          workflowStateType: 'started',
          labelNames: ['Backend', 'Medium-difficulty'],
          title: 'Resolved by name'
        }
      }
    ]
  };
  const result = resolveWritePlanObjects(plan, { manifest });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.operations[0].input.labelIds, ['label-backend', 'label-medium']);
  assert.equal(result.plan.operations[0].input.stateId, 'state-wen-started');
  assert.equal(result.plan.operations[0].input.projectMilestoneId, 'ms-admin-m0');
  assert.equal(result.resolutions.length, 4);
  assert.ok(result.resolutions.every(resolution => resolution.evidenceRef === evidenceRef));
}

{
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'linear-object-resolver-'));
  const manifestPath = path.join(tmp, 'workspace-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const result = resolveWritePlanObjects({
    operations: [
      { type: 'issue.update', input: { teamKey: 'WEN', addedLabelNames: ['Docs'] } }
    ]
  }, { manifestPath });
  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.operations[0].input.addedLabelIds, ['label-global-docs']);
  assert.equal(result.resolutions[0].evidenceRef, manifestPath);
}

console.log('linear object resolver tests passed');
