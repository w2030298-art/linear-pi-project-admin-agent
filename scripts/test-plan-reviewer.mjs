#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reviewProjectPlan, reviewWritePlan } from './plan-reviewer.mjs';

const resolverManifest = {
  evidenceRef: 'state/workspace-object-manifest.json',
  teams: [{ id: 'team-wen', key: 'WEN', name: 'WENTAOXU-personal-workplace' }],
  labels: [
    { id: 'label-backend', name: 'Backend', group: 'area', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'label-medium', name: 'Medium-difficulty', group: 'complexity', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'label-bug', name: 'Bug', group: 'Type', teamId: 'team-wen', teamKey: 'WEN' },
    { id: 'label-improvement', name: 'Improvement', group: 'Type', teamId: 'team-wen', teamKey: 'WEN' }
  ],
  workflowStates: [
    { id: 'state-started', name: 'In Progress', type: 'started', teamId: 'team-wen', teamKey: 'WEN' }
  ],
  projectMilestones: [
    { id: 'milestone-m0', name: 'M0', projectId: 'project-admin' }
  ]
};

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
        openQuestions: ['Which milestone should adopt the reviewed plan?']
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
        source: 'docs/FACT_SOURCES.md'
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
  const writePlan = {
    idempotencyKey: 'issue-only-existing-milestone',
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: 'c642b249-cdda-4e85-b7f4-604776cb8cbd',
    targetMilestoneId: 'existing-milestone-id',
    targetMilestoneReadback: {
      id: 'existing-milestone-id',
      projectId: 'c642b249-cdda-4e85-b7f4-604776cb8cbd',
      name: 'M3 | Linear Bridge'
    },
    dependencyValidation: 'Single issue is independent and attaches to an existing verified milestone.',
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        type: 'issue.create',
        input: {
          title: '[写入治理]：修复字段限制回归',
          teamKey: 'WEN',
          projectId: 'c642b249-cdda-4e85-b7f4-604776cb8cbd',
          projectMilestoneId: 'existing-milestone-id',
          labels: ['Medium-difficulty', 'Backend']
        }
      }
    ]
  };
  const report = reviewWritePlan(writePlan);
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.findings, []);
}

{
  const writePlan = {
    idempotencyKey: 'issue-only-missing-existing-targets',
    dryRun: true,
    confirmedByUser: false,
    dependencyValidation: 'Single issue is independent.',
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        type: 'issue.create',
        input: {
          title: '[写入治理]：修复字段限制回归',
          teamKey: 'WEN',
          labels: ['Medium-difficulty', 'Backend']
        }
      }
    ]
  };
  const report = reviewWritePlan(writePlan);
  assert.equal(report.status, 'needs_revision');
  assert.ok(findingCodes(report).includes('write_plan_project_missing'));
  assert.ok(findingCodes(report).includes('write_plan_milestone_missing'));
}

{
  const writePlan = {
    idempotencyKey: 'state-and-project-update-no-milestone',
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: 'project-admin',
    dependencyValidation: 'State transition and project update do not change milestone scope.',
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        type: 'issue.update',
        input: {
          issueId: 'issue-1',
          stateId: 'state-started'
        }
      },
      {
        type: 'projectUpdate.create',
        input: {
          projectId: 'project-admin',
          body: 'Status update.'
        }
      }
    ]
  };
  const report = reviewWritePlan(writePlan);
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.findings, []);
}

{
  const writePlan = {
    idempotencyKey: 'project-update-only-governance',
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: 'project-admin',
    dependencyValidation: 'Project governance update does not need issue or relation changes.',
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        type: 'projectUpdate.create',
        input: {
          projectId: 'project-admin',
          body: 'Freeze notice.'
        }
      }
    ]
  };
  const report = reviewWritePlan(writePlan);
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.findings, []);
}

{
  const writePlan = {
    idempotencyKey: 'issue-only-milestone-project-mismatch',
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: 'c642b249-cdda-4e85-b7f4-604776cb8cbd',
    targetMilestoneId: 'existing-milestone-id',
    targetMilestoneReadback: {
      id: 'existing-milestone-id',
      projectId: 'different-project-id',
      name: 'M3 | Linear Bridge'
    },
    dependencyValidation: 'Single issue is independent.',
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        type: 'issue.create',
        input: {
          title: 'Fix field limit regression',
          teamKey: 'WEN',
          projectId: 'c642b249-cdda-4e85-b7f4-604776cb8cbd',
          projectMilestoneId: 'existing-milestone-id',
          labels: ['Medium-difficulty', 'Backend']
        }
      }
    ]
  };
  const report = reviewWritePlan(writePlan);
  assert.equal(report.status, 'needs_revision');
  assert.ok(findingCodes(report).includes('write_plan_milestone_missing'));
}

{
  const longDescription = 'Long project description. '.repeat(20);
  const writePlan = {
    idempotencyKey: 'project-description-too-long',
    dryRun: true,
    confirmedByUser: false,
    dependencyValidation: 'Project update is independent.',
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        type: 'project.update',
        input: {
          id: 'project-id',
          description: longDescription
        }
      },
      {
        type: 'projectMilestone.create',
        input: {
          projectId: 'project-id',
          name: 'M3'
        }
      },
      {
        type: 'issue.create',
        input: {
          title: 'Project description length guard',
          teamKey: 'WEN',
          labels: ['Medium-difficulty', 'Backend']
        }
      }
    ]
  };
  const report = reviewWritePlan(writePlan);
  const finding = report.findings.find(item => item.code === 'write_plan_project_description_too_long');
  assert.equal(report.status, 'pass');
  assert.ok(finding);
  assert.equal(finding.blocking, false);
  assert.match(finding.message, /Project\.description/);
}

{
  const report = reviewProjectPlan(baseProjectPlan());
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.findings, []);
}

{
  const writePlan = {
    idempotencyKey: 'resolver-review',
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: 'project-admin',
    targetMilestoneId: 'milestone-m0',
    targetMilestoneReadback: {
      id: 'milestone-m0',
      projectId: 'project-admin',
      name: 'M0'
    },
    dependencyValidation: 'Single issue is independent.',
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        type: 'issue.create',
        input: {
          title: 'Resolve object names',
          teamKey: 'WEN',
          projectId: 'project-admin',
          milestoneName: 'M0',
          workflowStateName: 'In Progress',
          workflowStateType: 'started',
          labelNames: ['Backend', 'Medium-difficulty']
        }
      }
    ]
  };
  const report = reviewWritePlan(writePlan, { workspaceManifest: resolverManifest });
  assert.equal(report.status, 'pass');
  assert.equal(report.resolutions.length, 4);
  assert.ok(report.resolutions.every(resolution => resolution.evidenceRef === resolverManifest.evidenceRef));
}

{
  const writePlan = {
    idempotencyKey: 'label-group-conflict',
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: 'project-admin',
    targetMilestoneId: 'milestone-m0',
    targetMilestoneReadback: {
      id: 'milestone-m0',
      projectId: 'project-admin',
      name: 'M0'
    },
    dependencyValidation: 'Single issue is independent.',
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        type: 'issue.create',
        input: {
          title: 'Conflicting labels',
          teamKey: 'WEN',
          projectId: 'project-admin',
          projectMilestoneId: 'milestone-m0',
          labelNames: ['Bug', 'Improvement']
        }
      }
    ]
  };
  const report = reviewWritePlan(writePlan, { workspaceManifest: resolverManifest });
  assert.equal(report.status, 'needs_revision');
  assert.ok(findingCodes(report).includes('linear_label_group_conflict'));
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reviewer-label-conflict-'));
  const manifestPath = path.join(dir, 'workspace-manifest.json');
  const planPath = path.join(dir, 'write-plan.json');
  fs.writeFileSync(manifestPath, JSON.stringify(resolverManifest, null, 2));
  fs.writeFileSync(planPath, JSON.stringify({
    idempotencyKey: 'label-group-conflict-cli',
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: 'project-admin',
    targetMilestoneId: 'milestone-m0',
    targetMilestoneReadback: {
      id: 'milestone-m0',
      projectId: 'project-admin',
      name: 'M0'
    },
    dependencyValidation: 'Single issue is independent.',
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        type: 'issue.create',
        input: {
          title: 'Conflicting labels',
          teamKey: 'WEN',
          projectId: 'project-admin',
          projectMilestoneId: 'milestone-m0',
          labelNames: ['Bug', 'Improvement']
        }
      }
    ]
  }, null, 2));
  const result = spawnSync(process.execPath, [
    'scripts/plan-reviewer.mjs',
    planPath,
    '--workspace-manifest',
    manifestPath,
    '--strict'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /linear_label_group_conflict/);
}

console.log('plan reviewer tests passed');
