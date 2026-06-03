#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffOperationAgainstReadback, verifyApplyReadback } from './linear-apply/readback-diff.mjs';

{
  const mismatches = diffOperationAgainstReadback(
    {
      key: 'issue-create-1',
      type: 'issue.create',
      input: {
        title: 'Planned title',
        description: 'Acceptance criteria:\n- A',
        teamKey: 'WEN',
        labelNames: ['Backend']
      }
    },
    {
      id: 'issue-1',
      title: 'Different title',
      description: 'Acceptance criteria:\n- A',
      labels: { nodes: [{ name: 'Backend' }] }
    }
  );
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].field, 'title');
}

{
  const mismatches = diffOperationAgainstReadback(
    {
      key: 'project-update-1',
      type: 'projectUpdate.create',
      input: { body: 'Shipped', health: 'onTrack' }
    },
    { id: 'update-1', body: 'Shipped', health: 'onTrack' }
  );
  assert.equal(mismatches.length, 0);
}

{
  const auditPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'readback-diff-audit-')), 'audit.jsonl');
  const previous = process.env.AUDIT_LOG_PATH;
  process.env.AUDIT_LOG_PATH = auditPath;
  try {
    const result = await verifyApplyReadback(
      {
        idempotencyKey: 'readback-diff-test',
        operations: [{ key: 'issue-create-1', type: 'issue.create', input: { title: 'A' } }]
      },
      [{
        index: 0,
        success: true,
        entity: { id: 'issue-1' },
        readback: { id: 'issue-1', title: 'B' }
      }],
      { writePlanPath: 'state/write-plans/readback-diff-test.json', linear: null }
    );
    assert.equal(result.ok, false);
    assert.ok(result.mismatches.length >= 1);
    const audit = fs.readFileSync(auditPath, 'utf8');
    assert.match(audit, /linear_apply_readback_diff_alert/);
  } finally {
    if (previous === undefined) delete process.env.AUDIT_LOG_PATH;
    else process.env.AUDIT_LOG_PATH = previous;
  }
}

console.log('test-readback-diff: all checks passed');
