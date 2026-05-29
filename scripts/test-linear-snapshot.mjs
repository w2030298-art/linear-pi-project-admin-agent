#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  stateBucket,
  isTerminalIssue,
  summarizeIssueRelations,
  summarizeCycle
} from './portfolio-snapshot-utils.mjs';

function issue(overrides = {}) {
  return {
    identifier: overrides.identifier || 'WEN-1',
    title: overrides.title || 'Issue',
    state: overrides.state || { name: 'Todo', type: 'unstarted' },
    labels: { nodes: overrides.labels || [] },
    relations: { nodes: overrides.relations || [] },
    inverseRelations: { nodes: overrides.inverseRelations || [] },
    cycle: overrides.cycle || null,
    priority: overrides.priority,
    projectMilestone: overrides.projectMilestone || null,
    assignee: overrides.assignee || null
  };
}

function parseJsonOutput(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const start = result.stdout.indexOf('{');
  assert.notEqual(start, -1, result.stdout);
  return JSON.parse(result.stdout.slice(start));
}

{
  const duplicate = issue({
    identifier: 'WEN-189',
    state: { name: 'Duplicate', type: 'duplicate' }
  });
  assert.equal(stateBucket(duplicate), 'Duplicate');
  assert.equal(isTerminalIssue(duplicate), true);
}

{
  const current = issue({
    identifier: 'WEN-235',
    relations: [
      {
        type: 'blocks',
        relatedIssue: issue({ identifier: 'WEN-240', state: { name: 'Todo', type: 'unstarted' } })
      }
    ],
    inverseRelations: [
      {
        type: 'blocks',
        issue: issue({ identifier: 'WEN-229', state: { name: 'Todo', type: 'unstarted' } })
      },
      {
        type: 'blocks',
        issue: issue({ identifier: 'WEN-230', state: { name: 'Done', type: 'completed' } })
      }
    ]
  });
  const summary = summarizeIssueRelations(current);
  assert.deepEqual(summary.blocks.map(item => item.identifier), ['WEN-240']);
  assert.deepEqual(summary.blockedBy.map(item => item.identifier), ['WEN-229']);
}

{
  const cycle = { id: 'cycle-1', number: 1, name: 'Cycle 1', startsAt: '2026-05-31', endsAt: '2026-06-14' };
  const issues = [
    issue({ identifier: 'WEN-1', state: { name: 'Done', type: 'completed' }, labels: [{ name: 'High-difficulty' }], cycle }),
    issue({ identifier: 'WEN-2', state: { name: 'Todo', type: 'unstarted' }, labels: [{ name: 'High-difficulty' }], cycle }),
    issue({ identifier: 'WEN-3', state: { name: 'Blocked', type: 'unstarted' }, labels: [{ name: 'Medium-difficulty' }], cycle }),
    issue({ identifier: 'WEN-4', state: { name: 'Duplicate', type: 'duplicate' }, labels: [{ name: 'High-difficulty' }], cycle })
  ];
  const summary = summarizeCycle(cycle, issues, new Set(['WEN-3']));
  assert.equal(summary.issueCount, 4);
  assert.equal(summary.completedCount, 1);
  assert.equal(summary.openCount, 2);
  assert.equal(summary.highOpenCount, 1);
  assert.equal(summary.blockedCount, 1);
}

{
  const workspace = parseJsonOutput(spawnSync('node', ['scripts/linear-cli.mjs', 'workspace'], {
    encoding: 'utf8',
    env: process.env
  }));
  assert.equal(workspace.ok, true);
  assert.ok(Array.isArray(workspace.projects), 'workspace.projects must be an array');
  assert.ok(Array.isArray(workspace.cycles), 'workspace.cycles must be an array');
  assert.ok(Array.isArray(workspace.workflowStates), 'workspace.workflowStates must be an array');
  assert.ok(workspace.projects.length > 0, 'workspace.projects should include active project summaries');
  assert.ok(workspace.workflowStates.every(state => state.id && state.name && state.type), 'workflow states need IDs and types');
}

console.log('linear snapshot tests passed');
