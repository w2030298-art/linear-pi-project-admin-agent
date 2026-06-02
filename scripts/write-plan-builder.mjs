#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { arg, ensureDir, json, now, readJson, writeJson } from './utils.mjs';
import { resolveOperationInput } from './linear-object-resolver.mjs';

const SUPPORTED_TYPES = new Set([
  'projectUpdate.create',
  'issue.create',
  'issue.update',
  'issueRelation.create'
]);

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function projectFromInput(input) {
  const baseline = input?.projectBaseline || input?.baseline || {};
  const project = baseline.project || input.project || {};
  return {
    id: clean(input.targetProjectId || input.projectId || project.id),
    name: clean(input.targetProjectName || project.name),
    url: clean(project.url)
  };
}

function evidenceGap(evidenceGaps, extra = {}) {
  return {
    ok: false,
    status: 'evidence_gap',
    writesPerformed: false,
    evidenceGaps,
    openQuestions: evidenceGaps.map(gap => `Resolve: ${gap}`),
    ...extra
  };
}

function loadManifest(input) {
  if (input.workspaceManifest) {
    return {
      manifest: input.workspaceManifest,
      manifestPath: null
    };
  }
  if (input.workspaceManifestPath) {
    return {
      manifest: readJson(input.workspaceManifestPath),
      manifestPath: input.workspaceManifestPath
    };
  }
  return { manifest: null, manifestPath: null };
}

function findTeam(manifest, input) {
  const teamKey = clean(input.teamKey);
  const teamId = clean(input.teamId);
  if (!manifest || (!teamKey && !teamId)) return {};
  return asArray(manifest.teams).find(team =>
    (teamKey && clean(team.key)?.toLowerCase() === teamKey.toLowerCase()) ||
    (teamId && clean(team.id)?.toLowerCase() === teamId.toLowerCase())
  ) || {};
}

function milestoneReadback(manifest, projectId, milestoneId) {
  const milestones = asArray(manifest?.projectMilestones).concat(
    asArray(manifest?.projects).flatMap(project =>
      asArray(project.projectMilestones || project.milestones).map(milestone => ({
        ...milestone,
        projectId: milestone.projectId || project.id
      }))
    )
  );
  return milestones.find(milestone => clean(milestone.id) === clean(milestoneId) && clean(milestone.projectId) === clean(projectId)) || null;
}

function normalizeType(type) {
  const value = clean(type);
  if (value === 'issue.relation.create') return 'issueRelation.create';
  return value;
}

function operationKey(type, index) {
  if (type === 'projectUpdate.create') return `project-update-${index + 1}`;
  if (type === 'issue.create') return `issue-create-${index + 1}`;
  if (type === 'issue.update') return `issue-update-${index + 1}`;
  if (type === 'issueRelation.create') return `issue-relation-${index + 1}`;
  return `operation-${index + 1}`;
}

function baseInput(operation, project) {
  const input = { ...(operation.input || {}) };
  for (const [key, value] of Object.entries(operation)) {
    if (['type', 'input', 'key', 'reason'].includes(key)) continue;
    input[key] = value;
  }
  if (!input.projectId && project.id) input.projectId = project.id;
  return input;
}

function normalizeOperation(operation, index, project, manifestInfo) {
  const type = normalizeType(operation.type);
  if (!SUPPORTED_TYPES.has(type)) {
    return { gaps: [`Unsupported operation type: ${operation.type || '(missing)'}.`] };
  }

  const input = baseInput(operation, project);
  const team = findTeam(manifestInfo.manifest, input);
  if (team.id && !input.teamId) input.teamId = team.id;
  if (team.key && !input.teamKey) input.teamKey = team.key;

  if (type === 'projectUpdate.create') {
    if (!clean(input.body)) return { gaps: ['projectUpdate.create requires body.'] };
  }
  if (type === 'issue.create') {
    const gaps = [];
    if (!clean(input.title)) gaps.push('issue.create requires title.');
    if (!clean(input.description)) gaps.push('issue.create requires description with acceptance criteria.');
    else if (!/acceptance|验收/i.test(input.description)) gaps.push('issue.create description must include acceptance criteria.');
    if (!clean(input.teamKey) && !clean(input.teamId)) gaps.push('issue.create requires teamKey or teamId.');
    if (!asArray(input.labels).length && !asArray(input.labelNames).length && !asArray(input.labelIds).length) {
      gaps.push('issue.create requires labels, labelNames, or labelIds.');
    }
    if (!clean(input.projectMilestoneId) && !clean(input.milestoneName) && !clean(input.projectMilestoneName)) {
      gaps.push('issue.create requires projectMilestoneId or milestoneName.');
    }
    if (gaps.length) return { gaps };
  }
  if (type === 'issue.update' && !clean(input.issueId) && !clean(input.id) && !clean(input.issueRef)) {
    return { gaps: ['issue.update requires issueId, id, or issueRef.'] };
  }
  if (type === 'issueRelation.create') {
    input.type = clean(input.type || input.relationType);
    delete input.relationType;
    if (!clean(input.issueId) || !clean(input.relatedIssueId) || !clean(input.type)) {
      return { gaps: ['issueRelation.create requires issueId, relatedIssueId, and relationType/type.'] };
    }
  }

  const resolved = manifestInfo.manifest
    ? resolveOperationInput(input, {
      manifest: manifestInfo.manifest,
      manifestPath: manifestInfo.manifestPath,
      pathPrefix: `$.operations[${index}].input`,
      operationType: type
    })
    : { ok: true, input, findings: [], resolutions: [] };

  if (!resolved.ok) return { gaps: resolved.findings.map(finding => finding.message), findings: resolved.findings };

  const out = {
    key: clean(operation.key) || operationKey(type, index),
    type,
    input: resolved.input,
    reason: clean(operation.reason) || `Generated by structured write plan builder for ${type}.`
  };
  return { operation: out, resolutions: resolved.resolutions };
}

function collectMilestoneReadback(plan, manifest) {
  for (const operation of plan.operations) {
    const milestoneId = clean(operation.input?.projectMilestoneId);
    if (!milestoneId) continue;
    const readback = milestoneReadback(manifest, plan.targetProjectId, milestoneId);
    if (readback) {
      plan.targetMilestoneId = milestoneId;
      plan.targetMilestoneReadback = {
        id: readback.id,
        name: readback.name || null,
        projectId: readback.projectId
      };
      return;
    }
  }
}

function buildWorkflow(writePlanPath, writePlan, summary) {
  return {
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
          planDigest: writePlan.planDigest,
          targetProjectSummary: summary.targetProjectSummary,
          operationsSummary: summary.operationsSummary,
          risksSummary: 'Structured builder generated the plan only; quality review, dry-run, approval artifact, readback, and audit remain required.',
          nonChangesSummary: 'No Linear mutation is executed by the builder.'
        }
      },
      apply: {
        name: 'linear_apply_write_plan',
        params: {
          writePlanPath,
          idempotencyKey: writePlan.idempotencyKey,
          planDigest: writePlan.planDigest,
          confirmedByUser: true,
          confirmationChannel: 'ask_user',
          confirmationText: '<from pi_ask_user approvalArtifact.confirmationText>',
          confirmationId: '<from pi_ask_user approvalArtifact.confirmationId>',
          dryRun: false
        }
      }
    }
  };
}

export function buildWritePlan(input, options = {}) {
  const project = projectFromInput(input || {});
  if (!project.id) return evidenceGap(['Write plan builder requires targetProjectId or projectBaseline.project.id.']);

  const manifestInfo = loadManifest(input || {});
  if ((input.workspaceManifestPath || input.workspaceManifest) && !manifestInfo.manifest) {
    return evidenceGap(['Workspace manifest could not be loaded for label/state/milestone/team preflight.']);
  }

  const requested = asArray(input.operations);
  if (!requested.length) return evidenceGap(['Write plan builder requires at least one operation.']);

  const operations = [];
  const evidenceGaps = [];
  const findings = [];
  const resolutions = [];
  requested.forEach((operation, index) => {
    const result = normalizeOperation(operation, index, project, manifestInfo);
    if (result.gaps) evidenceGaps.push(...result.gaps);
    if (result.findings) findings.push(...result.findings);
    if (result.operation) operations.push(result.operation);
    if (result.resolutions) resolutions.push(...result.resolutions);
  });
  if (evidenceGaps.length) return evidenceGap(evidenceGaps, { findings });

  const source = input.source || {};
  const planSeed = {
    projectId: project.id,
    operations,
    source: {
      issueIdentifier: clean(source.issueIdentifier),
      factPackPath: clean(source.factPackPath)
    }
  };
  const idempotencyKey = clean(input.idempotencyKey) || `write-plan-${project.id}-${sha256(planSeed).slice(0, 12)}`;
  const writePlan = {
    idempotencyKey,
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: project.id,
    targetProject: project,
    dependencyValidation: operations.some(operation => operation.type === 'issueRelation.create')
      ? 'Issue relation operation explicitly records dependency intent.'
      : 'Structured builder request contains no dependency relation changes.',
    readbackRequired: true,
    auditLogRequired: true,
    evidenceRefs: asArray(input.evidenceRefs).concat([
      source.factPackPath,
      manifestInfo.manifest?.evidenceRef,
      manifestInfo.manifestPath
    ].filter(Boolean)),
    source: {
      generatedBy: 'write-plan-builder',
      issueIdentifier: clean(source.issueIdentifier),
      factPackPath: clean(source.factPackPath),
      createdAt: now()
    },
    operations
  };
  if (manifestInfo.manifest) collectMilestoneReadback(writePlan, manifestInfo.manifest);

  const digestPlan = { ...writePlan };
  delete digestPlan.planDigest;
  const planDigest = `sha256:${sha256(digestPlan)}`;
  writePlan.planDigest = planDigest;

  const writePlanPath = options.writePlanPath || input.writePlanPath || path.join('state', 'write-plans', `${idempotencyKey}.json`);
  const summary = {
    writePlanPath,
    idempotencyKey,
    planDigest,
    operationCount: operations.length,
    operationTypes: operations.map(operation => operation.type),
    targetProjectId: project.id,
    targetProjectSummary: project.name || project.id,
    operationsSummary: operations.map(operation => operation.type).join(', ')
  };

  return {
    ok: true,
    status: 'write_plan_ready',
    writesPerformed: false,
    writePlanPath,
    idempotencyKey,
    planDigest,
    summary,
    resolutions,
    writePlan,
    ...buildWorkflow(writePlanPath, writePlan, summary)
  };
}

function readInput(filePath) {
  if (!filePath) throw new Error('Usage: node scripts/write-plan-builder.mjs --input input.json [--out state/write-plans/key.json]');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function main() {
  const inputPath = arg('--input', '');
  const outPath = arg('--out', '');
  const input = readInput(inputPath);
  const result = buildWritePlan(input, { writePlanPath: outPath || input.writePlanPath });
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
