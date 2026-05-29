#!/usr/bin/env node
import assert from 'node:assert/strict';
import { reviewProjectPlan, reviewWritePlan } from './plan-reviewer.mjs';

function findingCodes(report) {
  return report.findings.map(finding => finding.code);
}

function baseProjectPlan() {
  return {
    project: {
      name: 'linear-pi-project-admin-agent',
      summary: 'Validate the Linear project admin runtime.',
      goals: ['Keep project planning evidence-backed.'],
      nonGoals: ['Do not enable unconfirmed Linear writes.'],
      successMetrics: ['Reviewer catches missing labels and dependencies.']
    },
    milestones: [
      {
        key: 'm2',
        name: 'M2 | Planning review',
        exitCriteria: ['Project plan reviewer returns pass for complete plans.']
      }
    ],
    issues: [
      {
        key: 'plan-review',
        title: 'Review project plan before write guard',
        labels: ['Medium-difficulty', 'Backend'],
        acceptanceCriteria: ['node scripts/plan-reviewer.mjs examples/project-plan.sample.json returns pass'],
        dependencies: ['Fact Pack', 'Pi interaction'],
        factRefs: ['Fact Pack smoke output'],
        assumptions: ['Linear writes remain dry-run until confirmed.'],
        openQuestions: ['Which Cycle should adopt the reviewed plan?']
      }
    ],
    relations: [
      {
        from: 'Fact Pack',
        to: 'plan-review',
        type: 'blocks'
      }
    ],
    qualityReview: {
      reviewer: 'deterministic',
      checkedAt: '2026-05-28T00:00:00.000Z'
    },
    writePlan: {
      dryRun: true,
      operations: [
        {
          type: 'comment.create',
          input: { issueId: 'WEN-252', body: 'Review result draft.' }
        }
      ]
    },
    facts: [
      {
        claim: 'Fact Pack is required before planning.',
        source: 'AGENTS.md'
      }
    ],
    assumptions: ['PoC uses local state files.'],
    openQuestions: ['OAuth app is vNext, not MVP.']
  };
}

{
  const report = reviewProjectPlan({});
  assert.equal(report.status, 'needs_revision');
  assert.ok(findingCodes(report).includes('schema_invalid'));
}

{
  const plan = baseProjectPlan();
  delete plan.issues[0].labels;
  const report = reviewProjectPlan(plan);
  assert.equal(report.status, 'needs_revision');
  assert.ok(findingCodes(report).includes('issue_missing_labels'));
}

{
  const plan = baseProjectPlan();
  plan.relations = [];
  delete plan.issues[0].dependencies;
  const report = reviewProjectPlan(plan);
  assert.equal(report.status, 'needs_revision');
  assert.ok(findingCodes(report).includes('dependencies_missing'));
}

{
  const plan = baseProjectPlan();
  plan.facts = [];
  plan.assumptions = [];
  plan.openQuestions = [];
  delete plan.issues[0].factRefs;
  delete plan.issues[0].assumptions;
  delete plan.issues[0].openQuestions;
  const report = reviewProjectPlan(plan);
  assert.equal(report.status, 'needs_revision');
  assert.ok(findingCodes(report).includes('fact_boundaries_missing'));
}

{
  const writePlan = {
    idempotencyKey: 'test-write-plan',
    dryRun: true,
    confirmedByUser: false,
    operations: [
      { type: 'project.create', input: { name: 'example', teamKey: 'WEN' } },
      { type: 'projectMilestone.create', input: { projectRef: 'project', name: 'M0' } },
      { type: 'issue.create', input: { title: 'Missing labels', teamKey: 'WEN' } }
    ],
    readbackRequired: true,
    auditLogRequired: true
  };
  const report = reviewWritePlan(writePlan);
  assert.equal(report.status, 'needs_revision');
  assert.ok(findingCodes(report).includes('write_plan_issue_missing_labels'));
  assert.equal(report.executedMutation, false);
}

{
  const report = reviewProjectPlan(baseProjectPlan());
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.findings, []);
}

console.log('plan reviewer tests passed');
