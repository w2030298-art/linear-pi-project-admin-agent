#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, asArray, clean, ensureDir, hash, json, now, readJson, writeJson } from './utils.mjs';
import { resolveOperationInput } from './linear-mcp-match.mjs';

const SUPPORTED_TYPES = new Set([
  'projectUpdate.create',
  'issue.create',
  'issue.update',
  'issueRelation.create'
]);

export const LOW_RISK_KINDS = new Set(['project_update', 'issue_create']);

function stableSuffix(value) {
  return hash(value).slice(0, 12);
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

function operationType(operation) {
  return normalizeType(operation.type || operation.kind);
}

function unsupportedOperationGap(operation, index) {
  const provided = operation.type || operation.kind || '(missing)';
  return [
    `Unsupported operation type at operations[${index}].type: ${provided}. ` +
    `Use operations[].type, or the kind alias, with one of: ${[...SUPPORTED_TYPES].join(', ')}. ` +
    'Example: {"type":"issue.create","title":"...","description":"Acceptance criteria:\\n- ...","teamKey":"WEN","labelNames":["Backend"],"milestoneName":"M1"}.'
  ];
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

function expandLowRiskKind(input) {
  const kind = clean(input?.kind);
  if (!LOW_RISK_KINDS.has(kind)) {
    return evidenceGap([`kind ${kind || '(missing)'} is not in low-risk whitelist: ${[...LOW_RISK_KINDS].join(', ')}.`], {
      lowRiskWhitelist: [...LOW_RISK_KINDS]
    });
  }

  const project = projectFromInput(input);
  if (!project.id) {
    return evidenceGap(['Low-risk write requires compact Project baseline with project.id or explicit targetProjectId.']);
  }

  if (kind === 'project_update') {
    const update = input.projectUpdate || input.update || {};
    const body = clean(update.body || input.body);
    if (!body) return evidenceGap(['project_update requires projectUpdate.body.']);
    return {
      ok: true,
      kind,
      project,
      operations: [{
        key: 'project-update',
        type: 'projectUpdate.create',
        body,
        health: clean(update.health || input.health) || undefined,
        reason: 'Low-risk single Project Update generated from current session facts.'
      }]
    };
  }

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
  if (gaps.length) return evidenceGap(gaps, { lowRiskWhitelist: [...LOW_RISK_KINDS] });

  const operation = {
    key: 'issue-create',
    type: 'issue.create',
    title,
    description,
    teamKey: teamKey || undefined,
    teamId: teamId || undefined,
    projectMilestoneId: milestoneId,
    labels,
    labelNames,
    reason: 'Low-risk single Issue create generated from compact Project baseline.'
  };
  if (!operation.teamKey) delete operation.teamKey;
  if (!operation.teamId) delete operation.teamId;
  if (!operation.labels.length) delete operation.labels;
  if (!operation.labelNames.length) delete operation.labelNames;

  return {
    ok: true,
    kind,
    project,
    targetMilestoneId: milestoneId,
    targetMilestoneReadback: milestoneReadback,
    operations: [operation]
  };
}

function normalizeOperation(operation, index, project, manifestInfo, options = {}) {
  const type = operationType(operation);
  if (!SUPPORTED_TYPES.has(type)) {
    return { gaps: unsupportedOperationGap(operation, index) };
  }

  const input = baseInput(operation, project);
  const team = findTeam(manifestInfo.manifest, input);
  if (team.id && !input.teamId) input.teamId = team.id;
  if (team.key && !input.teamKey) input.teamKey = team.key;

  if (type === 'projectUpdate.create') {
    if (!clean(input.body)) return { gaps: ['projectUpdate.create requires body.'] };
    if (!clean(input.health)) delete input.health;
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
    if (!options.lowRisk && !clean(input.projectMilestoneId) && !clean(input.milestoneName) && !clean(input.projectMilestoneName)) {
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
    ? resolveOperationInput(input, /** @type {any} */ ({
      manifest: manifestInfo.manifest,
      manifestPath: manifestInfo.manifestPath,
      pathPrefix: `$.operations[${index}].input`,
      operationType: type
    }))
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

function buildFinalValidationSummary(writePlanPath, writePlan) {
  return {
    writePlanPath,
    idempotencyKey: writePlan.idempotencyKey,
    operationCount: writePlan.operations.length,
    operationTypes: writePlan.operations.map(operation => operation.type),
    targetProjectId: writePlan.targetProjectId
  };
}

function buildLowRiskWorkflowExtras(writePlanPath, writePlan) {
  return {
    finalValidationSummary: {
      ...buildFinalValidationSummary(writePlanPath, writePlan),
      riskLevel: 'L1/L2 low-risk whitelist'
    },
    workflow: {
      finalValidationRequired: true,
      approvalRequired: true,
      readbackRequired: true,
      auditLogRequired: true,
      confirmedOnlyRequired: true,
      fallbackToFullFactPackWhenEvidenceGap: true
    },
    nextToolCalls: {
      finalValidation: {
        name: 'linear_validate_write_plan',
        params: {
          writePlanPath
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

function buildWorkflow(writePlanPath, writePlan, summary) {
  return {
    finalValidationSummary: buildFinalValidationSummary(writePlanPath, writePlan),
    workflow: {
      finalValidationRequired: true,
      approvalRequired: true,
      readbackRequired: true,
      auditLogRequired: true,
      confirmedOnlyRequired: true,
      fallbackToFullFactPackWhenEvidenceGap: true
    },
    nextToolCalls: {
      finalValidation: {
        name: 'linear_validate_write_plan',
        params: {
          writePlanPath
        }
      },
      approval: {
        name: 'pi_ask_user',
        params: {
          flow: 'plan_confirmation',
          writePlanPath,
          idempotencyKey: writePlan.idempotencyKey,
          targetProjectSummary: summary.targetProjectSummary,
          operationsSummary: summary.operationsSummary,
          risksSummary: 'Final validation must pass before approval; readback diff and audit remain required after apply.',
          nonChangesSummary: 'The builder and final validation do not perform Linear mutations.'
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

export function buildWritePlan(input, options = {}) {
  const kind = clean(input?.kind);
  const lowRisk = LOW_RISK_KINDS.has(kind);
  let lowRiskExpansion = null;
  let workingInput = input || {};

  if (kind && !lowRisk && !asArray(workingInput.operations).length) {
    return evidenceGap([`kind ${kind} is not in low-risk whitelist: ${[...LOW_RISK_KINDS].join(', ')}.`], {
      lowRiskWhitelist: [...LOW_RISK_KINDS]
    });
  }

  if (lowRisk) {
    lowRiskExpansion = expandLowRiskKind(workingInput);
    if (!lowRiskExpansion.ok) return lowRiskExpansion;
    workingInput = {
      ...workingInput,
      operations: lowRiskExpansion.operations,
      targetProjectId: lowRiskExpansion.project.id,
      projectBaseline: workingInput.projectBaseline || { project: lowRiskExpansion.project }
    };
  }

  const project = lowRiskExpansion?.project || projectFromInput(workingInput);
  if (!project.id) return evidenceGap(['Write plan builder requires targetProjectId or projectBaseline.project.id.']);

  const manifestInfo = loadManifest(workingInput);
  if ((workingInput.workspaceManifestPath || workingInput.workspaceManifest) && !manifestInfo.manifest) {
    return evidenceGap(['Workspace manifest could not be loaded for label/state/milestone/team preflight.']);
  }

  const requested = asArray(workingInput.operations);
  if (!requested.length) return evidenceGap(['Write plan builder requires at least one operation.']);

  const operations = [];
  const evidenceGaps = [];
  const findings = [];
  const resolutions = [];
  requested.forEach((operation, index) => {
    const result = normalizeOperation(operation, index, project, manifestInfo, { lowRisk });
    if (result.gaps) evidenceGaps.push(...result.gaps);
    if (result.findings) findings.push(...result.findings);
    if (result.operation) operations.push(result.operation);
    if (result.resolutions) resolutions.push(...result.resolutions);
  });
  if (evidenceGaps.length) {
    return evidenceGap(evidenceGaps, {
      findings,
      ...(lowRisk ? { lowRiskWhitelist: [...LOW_RISK_KINDS] } : {})
    });
  }

  const source = workingInput.source || {};
  const planSeed = lowRisk
    ? {
      kind: lowRiskExpansion.kind,
      project,
      operation: operations[0],
      source: {
        issueIdentifier: clean(source.issueIdentifier),
        factPackPath: clean(source.factPackPath)
      }
    }
    : {
      projectId: project.id,
      operations,
      source: {
        issueIdentifier: clean(source.issueIdentifier),
        factPackPath: clean(source.factPackPath)
      }
    };
  const idempotencyKey = clean(workingInput.idempotencyKey) || (lowRisk
    ? `low-risk-${lowRiskExpansion.kind.replace(/_/g, '-')}-${project.id}-${stableSuffix(planSeed)}`
    : `write-plan-${project.id}-${stableSuffix(planSeed)}`);
  const writePlan = /** @type {any} */ ({
    idempotencyKey,
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: project.id,
    targetProject: project,
    dependencyValidation: lowRisk
      ? 'Low-risk single-operation write; no dependency relation changes requested.'
      : operations.some(operation => operation.type === 'issueRelation.create')
        ? 'Issue relation operation explicitly records dependency intent.'
        : 'Structured builder request contains no dependency relation changes.',
    readbackRequired: true,
    auditLogRequired: true,
    evidenceRefs: asArray(workingInput.evidenceRefs).concat([
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
  });
  if (lowRiskExpansion?.targetMilestoneReadback) {
    writePlan.targetMilestoneId = lowRiskExpansion.targetMilestoneId;
    writePlan.targetMilestoneReadback = lowRiskExpansion.targetMilestoneReadback;
  } else if (manifestInfo.manifest) {
    collectMilestoneReadback(writePlan, manifestInfo.manifest);
  }

  const writePlanPath = options.writePlanPath || workingInput.writePlanPath || path.join('state', 'write-plans', `${idempotencyKey}.json`);
  const operationsSummary = operations.map((operation, index) => {
    const title = clean(operation.input?.title) || clean(operation.key) || `${operation.type}-${index + 1}`;
    return `- ${operation.type}: ${title}`;
  }).join('\n');
  const summary = {
    writePlanPath,
    idempotencyKey,
    operationCount: operations.length,
    operationTypes: operations.map(operation => operation.type),
    targetProjectId: project.id,
    targetProjectSummary: project.name || project.id,
    operationsSummary
  };

  const baseResult = {
    ok: true,
    status: 'write_plan_ready',
    writesPerformed: false,
    writePlanPath,
    idempotencyKey,
    summary,
    resolutions,
    writePlan,
    ...(lowRisk
      ? {
        lowRiskWhitelist: [...LOW_RISK_KINDS],
        ...buildLowRiskWorkflowExtras(writePlanPath, writePlan)
      }
      : buildWorkflow(writePlanPath, writePlan, summary))
  };
  return baseResult;
}

export function buildLowRiskWritePlan(input, options = {}) {
  return buildWritePlan(input, options);
}

function readInput(filePath) {
  if (!filePath) throw new Error('Usage: node scripts/write-plan-builder.mjs --input input.json [--out state/write-plans/key.json]');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function main() {
  const inputPath = arg('--input', '');
  const outPath = arg('--out', '');
  const input = readInput(inputPath);
  const result = /** @type {any} */ (buildWritePlan(input, { writePlanPath: outPath || input.writePlanPath }));
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
