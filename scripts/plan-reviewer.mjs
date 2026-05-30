#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Check, Errors } from 'typebox/value';
import { arg, ensureDir, json, now } from './utils.mjs';
import { PROJECT_DESCRIPTION_MAX_LENGTH, projectDescriptionLimit } from './project-field-normalizer.mjs';

const DEFAULT_SCHEMA_PATH = 'schemas/project-plan.schema.json';

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasTextArray(value) {
  return asArray(value).some(item => !isBlank(item));
}

function makeFinding(code, message, options = {}) {
  return {
    code,
    severity: options.severity || 'error',
    blocking: options.blocking !== false,
    path: options.path || '$',
    message
  };
}

function finish(kind, target, findings) {
  return {
    ok: findings.every(finding => !finding.blocking),
    kind,
    target,
    status: findings.some(finding => finding.blocking) ? 'needs_revision' : 'pass',
    executedMutation: false,
    reviewedAt: now(),
    findings
  };
}

function loadSchema(schemaPath) {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function schemaFindings(plan, schemaPath) {
  const schema = loadSchema(schemaPath);
  if (Check(schema, plan)) return [];
  return [...Errors(schema, plan)].map(error => makeFinding(
    'schema_invalid',
    error.message,
    { path: error.path || '$' }
  ));
}

function reviewProjectIssues(plan) {
  const findings = [];
  const issues = asArray(plan.issues);

  issues.forEach((issue, index) => {
    const issuePath = `$.issues[${index}]`;
    if (!hasTextArray(issue.labels) && !hasTextArray(issue.labelNames)) {
      findings.push(makeFinding(
        'issue_missing_labels',
        'Issue must include labels before entering Write Guard.',
        { path: `${issuePath}.labels` }
      ));
    }
    if (!hasTextArray(issue.acceptanceCriteria) && !/验收标准|acceptance/i.test(String(issue.description || ''))) {
      findings.push(makeFinding(
        'issue_missing_acceptance',
        'Issue must include concrete acceptance criteria.',
        { path: `${issuePath}.acceptanceCriteria` }
      ));
    }
  });

  return findings;
}

function reviewProjectDependencies(plan) {
  const hasRelations = asArray(plan.relations).length > 0;
  const hasIssueDependencies = asArray(plan.issues).some(issue =>
    hasTextArray(issue.dependencies) ||
    hasTextArray(issue.blockedBy) ||
    hasTextArray(issue.blocks)
  );
  if (hasRelations || hasIssueDependencies) return [];
  return [makeFinding(
    'dependencies_missing',
    'Plan must include Linear relations, issue dependencies, or an explicit dependency decision.',
    { path: '$.relations' }
  )];
}

function reviewFactBoundaries(plan) {
  const hasFacts = hasTextArray(plan.facts) ||
    asArray(plan.facts).some(fact => !isBlank(fact.claim) || !isBlank(fact.source)) ||
    asArray(plan.issues).some(issue => hasTextArray(issue.factRefs));
  const hasAssumptions = hasTextArray(plan.assumptions) ||
    asArray(plan.issues).some(issue => hasTextArray(issue.assumptions));
  const hasOpenQuestions = hasTextArray(plan.openQuestions) ||
    asArray(plan.issues).some(issue => hasTextArray(issue.openQuestions));

  if (hasFacts && hasAssumptions && hasOpenQuestions) return [];
  return [makeFinding(
    'fact_boundaries_missing',
    'Plan must distinguish facts, assumptions, and open questions before write planning.',
    { path: '$' }
  )];
}

function reviewProjectWritePlan(plan) {
  const writePlan = plan.writePlan || {};
  if (!Array.isArray(writePlan.operations)) {
    return [makeFinding(
      'write_plan_missing_operations',
      'Project plan writePlan must include an operations array for review.',
      { path: '$.writePlan.operations' }
    )];
  }
  return [];
}

export function reviewProjectPlan(plan, options = {}) {
  const schemaPath = options.schemaPath || DEFAULT_SCHEMA_PATH;
  const findings = [
    ...schemaFindings(plan, schemaPath),
    ...reviewProjectIssues(plan),
    ...reviewProjectDependencies(plan),
    ...reviewFactBoundaries(plan),
    ...reviewProjectWritePlan(plan)
  ];
  return finish('project_plan', options.target || null, findings);
}

function operationType(op) {
  return String(op?.type || '').trim();
}

function isIssueCreate(op) {
  return operationType(op) === 'issue.create';
}

function hasOp(operations, pattern) {
  return operations.some(op => pattern.test(operationType(op)));
}

function firstText(...values) {
  return values.find(value => !isBlank(value));
}

function targetProjectId(plan) {
  return firstText(plan.targetProjectId, plan.projectId, plan.targetProject?.id);
}

function issueMilestoneRefs(operations) {
  return operations
    .filter(operation => /^issue\.(create|update)$/.test(operationType(operation)))
    .map(operation => operation.input || {})
    .map(input => firstText(input.projectMilestoneId, input.projectMilestoneRef, input.milestoneRef))
    .filter(Boolean);
}

function targetMilestoneId(plan, operations) {
  return firstText(
    plan.targetMilestoneId,
    plan.targetProjectMilestoneId,
    plan.projectMilestoneId,
    plan.projectMilestoneRef,
    plan.targetMilestone?.id,
    ...issueMilestoneRefs(operations)
  );
}

function milestoneReadback(plan) {
  return plan.targetMilestoneReadback ||
    plan.targetProjectMilestoneReadback ||
    plan.existingMilestoneReadback ||
    plan.milestoneReadback ||
    null;
}

function hasVerifiedExistingMilestone(plan, operations) {
  const id = targetMilestoneId(plan, operations);
  const readback = milestoneReadback(plan);
  if (isBlank(id) || !readback || typeof readback !== 'object') return false;
  if (readback.id !== id) return false;
  const projectId = targetProjectId(plan);
  return isBlank(projectId) || readback.projectId === projectId;
}

function reviewProjectFieldLimits(operations) {
  const findings = [];
  operations.forEach((operation, index) => {
    if (!/^project\.(create|update)$/.test(operationType(operation))) return;
    const limit = projectDescriptionLimit(operation.input || {});
    if (!limit) return;
    findings.push(makeFinding(
      'write_plan_project_description_too_long',
      `Project.description is ${limit.originalLength} characters; Linear limit is ${PROJECT_DESCRIPTION_MAX_LENGTH}. Dry-run/apply will write a short summary to description and preserve the full text in content.`,
      {
        path: `$.operations[${index}].input.description`,
        severity: 'warning',
        blocking: false
      }
    ));
  });
  return findings;
}

function reviewUnsupportedIssueFields(operations) {
  const findings = [];
  operations.forEach((operation, index) => {
    if (!/^issue\.(create|update)$/.test(operationType(operation))) return;
    const input = operation.input || {};
    if (isBlank(input.cycleId)) return;
    findings.push(makeFinding(
      'write_plan_unsupported_issue_field',
      'issue.cycleId is not supported by this agent write schema.',
      { path: `$.operations[${index}].input.cycleId` }
    ));
  });
  return findings;
}

export function reviewWritePlan(plan, options = {}) {
  const findings = [];
  const operations = asArray(plan.operations);

  if (isBlank(plan.idempotencyKey)) {
    findings.push(makeFinding(
      'write_plan_idempotency_missing',
      'Write plan must include idempotencyKey.',
      { path: '$.idempotencyKey' }
    ));
  }
  if (!Array.isArray(plan.operations) || operations.length === 0) {
    findings.push(makeFinding(
      'write_plan_missing_operations',
      'Write plan must include a non-empty operations array.',
      { path: '$.operations' }
    ));
  }
  const hasTargetProject = hasOp(operations, /^project\.(create|update)$/) || !isBlank(targetProjectId(plan));
  const hasMilestoneTarget = hasOp(operations, /^(projectMilestone|milestone|project\.milestone)\.create$/) ||
    hasVerifiedExistingMilestone(plan, operations);

  if (!hasTargetProject) {
    findings.push(makeFinding(
      'write_plan_project_missing',
      'Write plan must identify the target Project via project.create/update or targetProjectId.',
      { path: '$.operations' }
    ));
  }
  if (!hasMilestoneTarget) {
    findings.push(makeFinding(
      'write_plan_milestone_missing',
      'Write plan must create a Project Milestone or include targetMilestoneId with Linear readback evidence.',
      { path: '$.operations' }
    ));
  }
  if (!hasOp(operations, /^issue\.(create|update)$/)) {
    findings.push(makeFinding(
      'write_plan_issue_missing',
      'Write plan must identify at least one Issue operation.',
      { path: '$.operations' }
    ));
  }

  operations.forEach((operation, index) => {
    if (!isIssueCreate(operation)) return;
    const input = operation.input || {};
    if (!hasTextArray(input.labels) && !hasTextArray(input.labelNames) && !hasTextArray(input.addedLabels)) {
      findings.push(makeFinding(
        'write_plan_issue_missing_labels',
        'Issue mutation must include labels or labelNames.',
        { path: `$.operations[${index}].input.labels` }
      ));
    }
  });

  const hasRelationOp = hasOp(operations, /^(issueRelation|issue\.relation|projectRelation|project\.relation)\.create$/);
  if (!hasRelationOp && isBlank(plan.dependencyValidation)) {
    findings.push(makeFinding(
      'write_plan_dependencies_missing',
      'Write plan must include relation operations or dependencyValidation explaining why none are needed.',
      { path: '$.dependencyValidation' }
    ));
  }

  if (plan.dryRun === false && plan.confirmedByUser !== true) {
    findings.push(makeFinding(
      'write_plan_confirmation_missing',
      'Non-dry-run write plan must include confirmedByUser=true.',
      { path: '$.confirmedByUser' }
    ));
  }
  if (plan.readbackRequired === false || plan.auditLogRequired === false) {
    findings.push(makeFinding(
      'write_plan_audit_readback_disabled',
      'Readback and audit logging must not be disabled.',
      { path: '$' }
    ));
  }
  findings.push(...reviewProjectFieldLimits(operations));
  findings.push(...reviewUnsupportedIssueFields(operations));

  return finish('write_plan', options.target || null, findings);
}

function readInput(filePath) {
  if (!filePath) throw new Error('Usage: node scripts/plan-reviewer.mjs <plan.json> [--out path] [--strict]');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function detectKind(plan, explicitKind) {
  if (explicitKind) return explicitKind;
  if (Array.isArray(plan.operations)) return 'write_plan';
  return 'project_plan';
}

async function main() {
  const filePath = process.argv[2];
  const outPath = arg('--out', '');
  const schemaPath = arg('--schema', DEFAULT_SCHEMA_PATH);
  const explicitKind = arg('--kind', '');
  const plan = readInput(filePath);
  const kind = detectKind(plan, explicitKind);
  const report = kind === 'write_plan'
    ? reviewWritePlan(plan, { target: filePath })
    : reviewProjectPlan(plan, { target: filePath, schemaPath });

  if (outPath) {
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  }
  json(report);
  if (process.argv.includes('--strict') && report.status !== 'pass') process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    json({ ok: false, error: err.message, stack: process.env.DEBUG ? err.stack : undefined });
    process.exit(1);
  });
}
