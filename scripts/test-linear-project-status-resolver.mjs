#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  listProjectStatuses,
  resolveProjectStatusById,
  resolveProjectStatus
} from './linear-project-status-resolver.mjs';

const baseManifest = {
  evidenceRef: 'state/workspace-object-manifest.json',
  projectStatuses: [
    { id: 'status-started', name: 'Started', type: 'started' },
    { id: 'status-paused', name: 'Paused', type: 'paused' },
    { id: 'status-completed', name: 'Completed', type: 'completed' },
    { id: 'status-canceled', name: 'Canceled', type: 'canceled' }
  ]
};

{
  const statuses = listProjectStatuses(baseManifest);
  assert.deepEqual(statuses.map(status => status.id), [
    'status-started',
    'status-paused',
    'status-completed',
    'status-canceled'
  ]);
  assert.equal(statuses[1].semanticType, 'paused');
  assert.equal(statuses[0].semanticType, 'started');
}

{
  const result = resolveProjectStatus(baseManifest, { intent: 'paused' });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'status-paused');
  assert.equal(result.intent, 'paused');
  assert.equal(result.evidenceRef, 'state/workspace-object-manifest.json');
  assert.deepEqual(result.chain.map(step => step.source), ['workspaceProjectStatuses', 'semanticType']);
}

{
  const result = resolveProjectStatus({
    ...baseManifest,
    projectStatuses: [{ id: 'status-started', name: 'Started', type: 'started' }]
  }, { intent: 'paused' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'project_status_absent');
  assert.equal(result.blocking, false);
  assert.equal(result.candidates.length, 0);
}

{
  const result = resolveProjectStatus({
    ...baseManifest,
    projectStatuses: [
      { id: 'status-paused', name: 'Paused', type: 'paused' },
      { id: 'status-on-hold', name: 'On Hold', type: 'paused' }
    ]
  }, { intent: 'paused' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'project_status_ambiguous');
  assert.equal(result.blocking, true);
  assert.deepEqual(result.candidates.map(candidate => candidate.id), ['status-paused', 'status-on-hold']);
}

{
  const result = resolveProjectStatus(baseManifest, { intent: 'started' });
  assert.equal(result.ok, true);
  assert.equal(result.id, 'status-started');
}

{
  const result = resolveProjectStatusById(baseManifest, 'status-paused');
  assert.equal(result.ok, true);
  assert.equal(result.id, 'status-paused');
  assert.equal(result.object.semanticType, 'paused');
}

{
  const result = resolveProjectStatusById(baseManifest, 'status-unknown');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'project_status_unknown_id');
  assert.equal(result.blocking, true);
}

console.log('linear project status resolver tests passed');
