#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { arg, ensureDir, json, now, writeJson } from './utils.mjs';

const LOW_RISK_KINDS = new Set(['project_update', 'issue_create']);

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function stableSuffix(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
}

function projectFromBaseline(input) {
  const baseline = input?.projectBaseline || input?.baseline || null;
  const project = baseline?.project || input?.project || {};
  return {
    id: clean(project.id || input?.targetProjectId || input?.projectId),
    name: clean(project.name || input?.targetProjectName),
    url: clean(project.url)
  };
}

function evidenceGapResult(evidenceGaps, extra = {}) {
  return {
    ok: false,
    status: 'evidence_gap',
    writesPerformed: false,
    evidenceGaps,
    openQuestions: evidenceGaps.map(gap => `Resolve: ${gap}`),
    ...extra
  };
}

function basePlan({ input, project, kind, operation }) {
  const source = input.source || {};
  const idempotencyKey = clean(input.idempotencyKey) ||
    `low-risk-${kind.replace(/_/g, '-')}-${project.id}-${stableSuffix({ kind, project, operation, source })}`;
  return {
    idempotencyKey,
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: project.id,
    targetProject: {
      id: project.id,
      name: project.name,
      url: project.url
    },
    dependencyValidation: 'Low-risk single-operation write; no dependency relation changes requested.',
    readbackRequired: true,
    auditLogRequired: true,
    source: {
      generatedBy: 'low-risk-write-plan',
      issueIdentifier: clean(source.issueIdentifier),
      factPackPath: clean(source.factPackPath),
      createdAt: now()
    },
    operations: [operation]
  };
}

function buildProjectUpdatePlan(input, project) {
  const update = input.projectUpdate || input.update || {};
  const body = clean(update.body || input.body);
  if (!body) return evidenceGapResult(['project_update requires projectUpdate.body.']);

  const operation = {
    key: 'project-update',
    type: 'projectUpdate.create',
    input: {
      projectId: project.id,
      body,
      health: clean(update.health || input.health) || undefined
    },
    reason: 'Low-risk single Project Update generated from current session facts.'
  };
  if (!operation.input.health) delete operation.input.health;
  return { ok: true, writePlan: basePlan({ input, project, kind: 'project_update', operation }) };
}

function buildIssueCreatePlan(input, project) {
  const issue = input.issue || {};
  const title = clean(issue.title || input.title);
  const description = clean(issue.description || input.description);
  const teamKey = clean(issue.teamKey || input.teamKey);
  const teamId = clean(issue.teamId || input.teamId);
  const labels = asArray(issue.labels || input.labels);
  const labelNames = asArray(issue.labelNames || input.labelNames);
  const milestoneId = clean(issue.projectMilestoneId || issue.targetMilestoneId || input.targetMilestoneId);
  const milestoneReadback = issue.projectMilestoneReadback || issue.targetMilestoneReadback || input.targetMilestoneReadback || null;
  const gaps = [];

  if (!title) gaps.push('issue_create requires issue.title.');
  if (!description) gaps.push('issue_create requires issue.description with acceptance criteria.');
  else if (!/acceptance|验收/i.test(description)) gaps.push('issue_create description must include acceptance criteria.');
  if (!teamKey && !teamId) gaps.push('issue_create requires issue.teamKey or issue.teamId.');
  if (!labels.length && !labelNames.length) gaps.push('issue_create requires issue.labels or issue.labelNames.');
  if (!milestoneId) gaps.push('issue_create requires projectMilestoneId for the existing target milestone.');
  if (!milestoneReadback || milestoneReadback.id !== milestoneId || milestoneReadback.projectId !== project.id) {
    gaps.push('issue_create requires projectMilestoneReadback matching projectMilestoneId and target projectId.');
  }
  if (gaps.length) return evidenceGapResult(gaps);

  const operation = {
    key: 'issue-create',
    type: 'issue.create',
    input: {
      title,
      description,
      teamKey: teamKey || undefined,
      teamId: teamId || undefined,
      projectId: project.id,
      projectMilestoneId: milestoneId,
      labels,
      labelNames
    },
    reason: 'Low-risk single Issue create generated from compact Project baseline.'
  };
  if (!operation.input.teamKey) delete operation.input.teamKey;
  if (!operation.input.teamId) delete operation.input.teamId;
  if (!operation.input.labels.length) delete operation.input.labels;
  if (!operation.input.labelNames.length) delete operation.input.labelNames;

  const writePlan = {
    ...basePlan({ input, project, kind: 'issue_create', operation }),
    targetMilestoneId: milestoneId,
    targetMilestoneReadback: milestoneReadback
  };
  return { ok: true, writePlan };
}

function buildWorkflow(writePlanPath, writePlan) {
  const dryRunSummary = {
    writePlanPath,
    idempotencyKey: writePlan.idempotencyKey,
    operationCount: writePlan.operations.length,
    operationTypes: writePlan.operations.map(operation => operation.type),
    targetProjectId: writePlan.targetProjectId,
    riskLevel: 'L1/L2 low-risk whitelist'
  };
  return {
    dryRunSummary,
    workflow: {
      qualityReviewRequired: true,
      dryRunRequired: true,
      approvalRequired: true,
      readbackRequired: true,
      auditLogRequired: true,
      confirmedOnlyRequired: true,
      fallbackToFullFactPackWhenEvidenceGap: true
    },
    nextToolCalls: {
      qualityReview: {
        name: 'linear_plan_quality_review',
        params: { planPath: writePlanPath }
      },
      dryRun: {
        name: 'linear_apply_write_plan',
        params: {
          writePlanPath,
          confirmedByUser: false,
          confirmationText: '',
          dryRun: true
        }
      },
      approval: {
        name: 'pi_ask_user',
        params: {
          flow: 'plan_confirmation',
          writePlanPath,
          idempotencyKey: writePlan.idempotencyKey,
          targetProjectSummary: writePlan.targetProject?.name || writePlan.targetProjectId,
          operationsSummary: writePlan.operations.map(operation => operation.type).join(', '),
          risksSummary: 'L1/L2 low-risk single-operation write; confirmed-only, readback, and audit remain required.',
          nonChangesSummary: 'No cross-Project batch writes, no repo-map writes, no confirmed-only bypass.'
        }
      },
      apply: {
        name: 'linear_apply_write_plan',
        params: {
          writePlanPath,
          idempotencyKey: writePlan.idempotencyKey,
          confirmedByUser: true,
          confirmationChannel: 'ask_user',
          confirmationText: '<from pi_ask_user confirmationText>',
          dryRun: false
        }
      }
    }
  };
}

export function buildLowRiskWritePlan(input, options = {}) {
  const kind = clean(input?.kind);
  if (!LOW_RISK_KINDS.has(kind)) {
    return evidenceGapResult([`kind ${kind || '(missing)'} is not in low-risk whitelist: ${[...LOW_RISK_KINDS].join(', ')}.`], {
      lowRiskWhitelist: [...LOW_RISK_KINDS]
    });
  }

  const project = projectFromBaseline(input);
  if (!project.id) {
    return evidenceGapResult(['Low-risk write requires compact Project baseline with project.id or explicit targetProjectId.']);
  }

  const built = kind === 'project_update'
    ? buildProjectUpdatePlan(input, project)
    : buildIssueCreatePlan(input, project);
  if (!built.ok) return { ...built, lowRiskWhitelist: [...LOW_RISK_KINDS] };

  const writePlanPath = options.writePlanPath || input.writePlanPath || path.join(
    'state',
    'write-plans',
    `${built.writePlan.idempotencyKey}.json`
  );
  return {
    ok: true,
    status: 'write_plan_ready',
    writesPerformed: false,
    writePlanPath,
    writePlan: built.writePlan,
    lowRiskWhitelist: [...LOW_RISK_KINDS],
    ...buildWorkflow(writePlanPath, built.writePlan)
  };
}

function readInput(filePath) {
  if (!filePath) throw new Error('Usage: node scripts/low-risk-write-plan.mjs --input input.json [--out state/write-plans/key.json]');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function main() {
  const inputPath = arg('--input', '');
  const outPath = arg('--out', '');
  const input = readInput(inputPath);
  const result = buildLowRiskWritePlan(input, { writePlanPath: outPath || input.writePlanPath });
  if (result.ok && result.writePlanPath) {
    ensureDir(path.dirname(result.writePlanPath));
    writeJson(result.writePlanPath, result.writePlan);
  }
  json(result);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    json({ ok: false, error: error.message, stack: process.env.DEBUG ? error.stack : undefined });
    process.exit(1);
  });
}
