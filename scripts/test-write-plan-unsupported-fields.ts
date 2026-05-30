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
        nodes: [{ name: 'Agent:Unknown' }]
      }
    }
  };
  const classified = classifyLinearEvent(payload);
  assert.equal(classified, null);
  const dispatched = await dispatchLinearEvent(payload);
  assert.equal(dispatched.queued, false);
  assert.match(dispatched.reason, /Unsupported Agent trigger/i);
}

{
  const report = reviewWritePlan({
    idempotencyKey: 'unsupported-issue-field-test',
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
          cycleId: 'unsupported-field-value',
          stateId: 'state-1'
        }
      }
    ]
  });
  assert.equal(report.status, 'needs_revision');
  assert.equal(report.findings.some(finding => finding.code === 'write_plan_unsupported_issue_field'), true);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linear-unsupported-field-'));
  const planPath = path.join(dir, 'write-plan.json');
  fs.writeFileSync(planPath, JSON.stringify({
    idempotencyKey: 'unsupported-field-cli-test',
    dryRun: true,
    operations: [
      {
        type: 'issue.update',
        input: {
          issueId: 'issue-1',
          cycleId: 'unsupported-field-value'
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
  assert.match(`${result.stdout}\n${result.stderr}`, /not supported by this agent write schema/i);
}

{
  const factSources = fs.readFileSync('config/fact-sources.yaml', 'utf8');
  assert.doesNotMatch(factSources, /^\s*-\s*cycle_plan\s*$/m);

  const orchestration = fs.readFileSync('config/orchestration-policy.yaml', 'utf8');
  assert.doesNotMatch(orchestration, /^\s*cycle:\s*$/m);
}

console.log('unsupported field tests passed');
