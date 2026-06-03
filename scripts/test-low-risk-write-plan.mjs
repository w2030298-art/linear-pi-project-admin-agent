#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildLowRiskWritePlan } from './low-risk-write-plan.mjs';
import { reviewWritePlan } from './plan-reviewer.mjs';

const projectBaseline = {
  kind: 'linear_project_baseline',
  collectedAt: '2026-06-01T00:00:00.000Z',
  project: {
    id: 'project-1',
    name: 'Demo Project',
    url: 'https://linear.app/demo/project/demo'
  }
};

{
  const result = buildLowRiskWritePlan({
    kind: 'project_update',
    projectBaseline,
    projectUpdate: {
      body: 'Status update body',
      health: 'onTrack'
    },
    source: { issueIdentifier: 'WEN-287' }
  });
  assert.equal(result.ok, true);
  assert.equal(result.workflow.qualityReviewRequired, true);
  assert.equal(result.workflow.dryRunRequired, true);
  assert.equal(result.workflow.approvalRequired, true);
  assert.equal(result.workflow.readbackRequired, true);
  assert.equal(result.workflow.auditLogRequired, true);
  assert.equal(result.writePlan.operations.length, 1);
  assert.equal(result.writePlan.operations[0].type, 'projectUpdate.create');
  assert.equal(result.writePlan.operations[0].input.projectId, 'project-1');
  assert.match(result.writePlan.idempotencyKey, /^low-risk-project-update-project-1-/);
  assert.equal(result.dryRunSummary.operationCount, 1);
  assert.equal(result.nextToolCalls.qualityReview.name, 'linear_plan_quality_review');
  assert.equal(result.nextToolCalls.qualityReview.params.planPath, result.writePlanPath);
  assert.equal(result.nextToolCalls.dryRun.params.dryRun, true);
  assert.equal(result.nextToolCalls.approval.params.flow, 'plan_confirmation');
  assert.equal(result.nextToolCalls.apply.params.dryRun, false);
  const review = reviewWritePlan(result.writePlan);
  assert.equal(review.ok, true, JSON.stringify(review.findings, null, 2));
}

{
  const result = buildLowRiskWritePlan({
    kind: 'issue_create',
    projectBaseline,
    issue: {
      title: 'Create one issue',
      description: 'Acceptance criteria:\n- It works',
      teamKey: 'WEN',
      labels: ['Backend'],
      projectMilestoneId: 'milestone-1',
      projectMilestoneReadback: {
        id: 'milestone-1',
        projectId: 'project-1',
        name: 'M1'
      }
    },
    source: { issueIdentifier: 'WEN-287' }
  });
  assert.equal(result.ok, true);
  assert.equal(result.writePlan.operations[0].type, 'issue.create');
  assert.equal(result.writePlan.targetMilestoneId, 'milestone-1');
  assert.equal(result.writePlan.targetMilestoneReadback.id, 'milestone-1');
  assert.equal(result.writePlan.operations[0].input.projectId, 'project-1');
  assert.equal(result.writePlan.operations[0].input.projectMilestoneId, 'milestone-1');
  assert.match(result.writePlan.idempotencyKey, /^low-risk-issue-create-project-1-/);
  const review = reviewWritePlan(result.writePlan);
  assert.equal(review.ok, true, JSON.stringify(review.findings, null, 2));
}

{
  const result = buildLowRiskWritePlan({
    kind: 'issue_create',
    projectBaseline,
    issue: {
      title: 'Create one Chinese issue',
      description: '验收标准:\n- 能创建标准计划',
      teamKey: 'WEN',
      labelNames: ['Backend'],
      projectMilestoneId: 'milestone-1',
      projectMilestoneReadback: {
        id: 'milestone-1',
        projectId: 'project-1',
        name: 'M1'
      }
    },
    source: { issueIdentifier: 'WEN-287' }
  });
  assert.equal(result.ok, true);
  assert.equal(result.writePlan.operations[0].type, 'issue.create');
  assert.deepEqual(result.writePlan.operations[0].input.labelNames, ['Backend']);
}

{
  const missing = buildLowRiskWritePlan({
    kind: 'issue_create',
    projectBaseline,
    issue: {
      title: 'Missing milestone',
      description: 'Acceptance criteria:\n- It works',
      teamKey: 'WEN',
      labels: ['Backend']
    }
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 'evidence_gap');
  assert.match(missing.evidenceGaps.join('\n'), /projectMilestoneReadback/i);
}

{
  const unsupported = buildLowRiskWritePlan({
    kind: 'issue_relation',
    projectBaseline
  });
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.evidenceGaps.join('\n'), /not in low-risk whitelist/i);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'low-risk-write-plan-'));
  const inputPath = path.join(dir, 'input.json');
  const outPath = path.join(dir, 'write-plan.json');
  fs.writeFileSync(inputPath, JSON.stringify({
    kind: 'project_update',
    projectBaseline,
    projectUpdate: {
      body: 'CLI status update',
      health: 'atRisk'
    }
  }, null, 2));

  const result = spawnSync(process.execPath, ['scripts/low-risk-write-plan.mjs', '--input', inputPath, '--out', outPath], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.writePlanPath, outPath);
  assert.equal(fs.existsSync(outPath), true);
  const persisted = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(persisted.operations[0].type, 'projectUpdate.create');
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const adminTools = fs.readFileSync('.pi/extensions/linear-admin-tools.ts', 'utf8');
  assert.match(adminTools, /linear_prepare_low_risk_write/);
  assert.match(adminTools, /quality review, dry-run, pi_ask_user approval, and real apply/);
  assert.match(adminTools, /Never performs mutations/);
}

console.log('low-risk write plan tests passed');
