#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compileOperations } from './linear-apply/normalize.mjs';

const longDescription = 'Project description length guard. '.repeat(12);

const plan = {
  dryRun: true,
  operations: [
    {
      key: 'project-create',
      type: 'project.create',
      input: {
        name: 'Project description normalization test',
        teamIds: ['team-id'],
        description: longDescription
      }
    },
    {
      key: 'project-update',
      type: 'project.update',
      input: {
        id: 'project-id',
        description: longDescription,
        content: 'Existing project content.'
      }
    }
  ]
};

const operations = await compileOperations({ client: { async rawRequest() { return { data: {} }; } } }, plan, {
  workspaceManifestInfo: {
    manifest: {
      teams: [],
      labels: [],
      workflowStates: [],
      projectMilestones: [],
      projectStatuses: [],
      completeness: { complete: true, truncated: false },
      truncated: false
    },
    manifestPath: null
  },
  exactIssueLookup: async () => null
});

const createOp = operations.find(op => op.key === 'project-create');
assert.ok(createOp);
assert.ok(Array.from(createOp.input.description).length <= 255);
assert.equal(createOp.input.content, longDescription);
assert.equal(createOp.fieldTransforms[0].action, 'downgrade_to_content');

const updateOp = operations.find(op => op.key === 'project-update');
assert.ok(updateOp);
assert.ok(Array.from(updateOp.input.description).length <= 255);
assert.match(updateOp.input.content, /Existing project content\./);
assert.ok(updateOp.input.content.includes(longDescription));
assert.equal(updateOp.fieldTransforms[0].action, 'downgrade_to_content');

console.log('project description field tests passed');
