#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildProjectBaselineFromEvidence,
  compactFactPack,
  loadProjectBaselineFromFactPack
} from './fact-pack-utils.mjs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-pack-baseline-'));
const originalCwd = process.cwd();
process.chdir(tmpRoot);

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const collectedAt = '2026-05-29T12:00:00.000Z';
const linearEvidence = {
  ok: true,
  collectedAt,
  data: {
    project: {
      id: 'project-1',
      name: 'Linear Admin Runtime',
      url: 'https://linear.app/example/project/project-1',
      state: 'started',
      description: 'Compact description',
      content: 'Long project content should not be copied into the prompt baseline.',
      updatedAt: '2026-05-29T11:55:00.000Z',
      issues: {
        nodes: [
          { identifier: 'WEN-1', title: 'First issue', updatedAt: '2026-05-29T11:50:00.000Z', state: { name: 'Done', type: 'completed' } },
          { identifier: 'WEN-2', title: 'Second issue', updatedAt: '2026-05-29T11:51:00.000Z', state: { name: 'Todo', type: 'unstarted' } }
        ]
      },
      projectMilestones: { nodes: [{ id: 'm1', name: 'M1', targetDate: '2026-06-01' }] },
      projectUpdates: { nodes: [{ id: 'u1', createdAt: '2026-05-29T10:00:00.000Z', health: 'onTrack' }] },
      documents: { nodes: [{ id: 'd1', title: 'Spec' }] }
    }
  }
};

const baseline = buildProjectBaselineFromEvidence(linearEvidence, {
  evidenceRef: 'state/fact-packs/evidence/fact-present/linear-project.json'
});
assert.equal(baseline.project.id, 'project-1');
assert.equal(baseline.counts.issues, 2);
assert.equal(baseline.rawEvidenceRef, 'state/fact-packs/evidence/fact-present/linear-project.json');
assert.doesNotMatch(JSON.stringify(baseline), /Long project content should not be copied/);

writeJson('state/fact-packs/evidence/fact-present/linear-project.json', linearEvidence);
const presentPack = compactFactPack({
  id: 'fact-present',
  createdAt: collectedAt,
  scope: { linearProjectIdOrKey: 'project-1' },
  facts: [
    {
      claim: 'Linear project context was retrieved for project-1.',
      sourceType: 'linear_live',
      source: 'linear:project-1',
      confidence: 'high',
      rawRef: null,
      evidenceRef: 'state/fact-packs/evidence/fact-present/linear-project.json',
      summary: 'project=Linear Admin Runtime; issues=2',
      timestamp: collectedAt
    }
  ],
  assumptions: [],
  openQuestions: [],
  conflicts: [],
  evidenceGaps: [],
  planningImplications: []
});
writeJson('state/fact-packs/fact-present.json', presentPack);

const present = loadProjectBaselineFromFactPack('state/fact-packs/fact-present.json', {
  now: '2026-05-29T13:00:00.000Z',
  maxAgeMs: 24 * 60 * 60 * 1000,
  requiredFields: ['project.id', 'counts.issues', 'rawEvidenceRef']
});
assert.equal(present.status, 'present');
assert.equal(present.shouldReadLive, false);
assert.equal(present.baseline.project.name, 'Linear Admin Runtime');
assert.equal(present.evidenceRef, 'state/fact-packs/evidence/fact-present/linear-project.json');
assert.equal(present.rawEvidencePath, path.resolve('state/fact-packs/evidence/fact-present/linear-project.json'));

writeJson('state/fact-packs/fact-absent.json', {
  id: 'fact-absent',
  createdAt: collectedAt,
  scope: {},
  facts: [],
  assumptions: [],
  openQuestions: [],
  conflicts: [],
  evidenceGaps: [],
  planningImplications: []
});
const absent = loadProjectBaselineFromFactPack('state/fact-packs/fact-absent.json', {
  now: '2026-05-29T13:00:00.000Z',
  maxAgeMs: 24 * 60 * 60 * 1000
});
assert.equal(absent.status, 'absent');
assert.equal(absent.shouldReadLive, true);
assert.match(absent.reason, /No reusable Project baseline/i);

const stale = loadProjectBaselineFromFactPack('state/fact-packs/fact-present.json', {
  now: '2026-05-31T13:00:00.000Z',
  maxAgeMs: 24 * 60 * 60 * 1000
});
assert.equal(stale.status, 'stale');
assert.equal(stale.shouldReadLive, true);
assert.match(stale.reason, /stale/i);

process.chdir(originalCwd);
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('project baseline loader tests passed');
