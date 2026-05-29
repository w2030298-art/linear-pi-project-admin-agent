import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyLinearEvent, dispatchLinearEvent } from '../services/linear-bridge/src/dispatch.ts';
import { reviewWritePlan } from './plan-reviewer.mjs';

{
  const payload = {
    type: 'Issue',
    action: 'update',
    data: {
      labels: {
        nodes: [{ name: 'Agent:CyclePlan' }]
      }
    }
  };
  const classified = classifyLinearEvent(payload);
  assert.equal(classified, null);
  const dispatched = await dispatchLinearEvent(payload);
  assert.equal(dispatched.queued, false);
  assert.match(dispatched.reason, /Cycle planning disabled/i);
}

{
  const report = reviewWritePlan({
    idempotencyKey: 'cycle-disabled-test',
    targetProjectId: 'project-1',
    targetMilestoneId: 'milestone-1',
    targetMilestoneReadback: { id: 'milestone-1', projectId: 'project-1' },
    dependencyValidation: 'No new dependencies are needed for this write.',
    dryRun: true,
    operations: [
      {
        type: 'issue.update',
        input: {
          issueId: 'issue-1',
          cycleId: 'cycle-1',
          stateId: 'state-1'
        }
      }
    ]
  });
  assert.equal(report.status, 'needs_revision');
  assert.equal(report.findings.some(finding => finding.code === 'write_plan_cycle_disabled'), true);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linear-cycle-disabled-'));
  const planPath = path.join(dir, 'write-plan.json');
  fs.writeFileSync(planPath, JSON.stringify({
    idempotencyKey: 'cycle-disabled-cli-test',
    dryRun: true,
    operations: [
      {
        type: 'issue.update',
        input: {
          issueId: 'issue-1',
          cycleId: 'cycle-1'
        }
      }
    ]
  }, null, 2));

  const result = spawnSync(process.execPath, ['scripts/linear-cli.mjs', 'apply', planPath, '--dry-run'], {
    cwd: process.cwd(),
    env: { ...process.env, LINEAR_API_KEY: 'dummy' },
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /cycleId/i);
}

{
  const factSources = fs.readFileSync('config/fact-sources.yaml', 'utf8');
  assert.doesNotMatch(factSources, /^\s*-\s*cycle_plan\s*$/m);

  const orchestration = fs.readFileSync('config/orchestration-policy.yaml', 'utf8');
  assert.match(orchestration, /^\s*enabled:\s*false\s*$/m);
}

console.log('cycle disabled tests passed');
