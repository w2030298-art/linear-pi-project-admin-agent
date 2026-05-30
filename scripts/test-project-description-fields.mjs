#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const longDescription = 'Project description length guard. '.repeat(12);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linear-project-fields-'));
const planPath = path.join(tempDir, 'write-plan.json');

fs.writeFileSync(planPath, JSON.stringify({
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
}, null, 2));

const result = spawnSync(process.execPath, ['scripts/linear-cli.mjs', 'apply', planPath, '--dry-run'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    LINEAR_API_KEY: process.env.LINEAR_API_KEY || 'test-key',
    LINEAR_WRITE_MODE: 'dry-run'
  },
  encoding: 'utf8'
});

assert.equal(result.status, 0, result.stderr || result.stdout);
const output = JSON.parse(result.stdout);
assert.equal(output.ok, true);
assert.equal(output.dryRun, true);
assert.equal(output.confirmationChannel.channel, 'unavailable');
assert.equal(output.confirmationChannel.label, 'interactive confirmation unavailable; real write not applied');

const createOp = output.operations.find(op => op.key === 'project-create');
assert.ok(createOp);
assert.ok(Array.from(createOp.input.description).length <= 255);
assert.equal(createOp.input.content, longDescription);
assert.equal(createOp.fieldTransforms[0].action, 'downgrade_to_content');

const updateOp = output.operations.find(op => op.key === 'project-update');
assert.ok(updateOp);
assert.ok(Array.from(updateOp.input.description).length <= 255);
assert.match(updateOp.input.content, /Existing project content\./);
assert.ok(updateOp.input.content.includes(longDescription));
assert.equal(updateOp.fieldTransforms[0].action, 'downgrade_to_content');

console.log('project description field tests passed');
