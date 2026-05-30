#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg, hash, json, readJson, writeJson } from './utils.mjs';
import { resolveProjectStatus } from './linear-project-status-resolver.mjs';

function clean(value) {
  return String(value || '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function projectFromEvidence(evidence) {
  return evidence?.data?.project || evidence?.project || null;
}

function projectUrlBase(value) {
  const input = clean(value);
  try {
    const url = new URL(input);
    const segments = url.pathname.split('/').filter(Boolean);
    const projectIndex = segments.findIndex(segment => segment.toLowerCase() === 'project');
    if (url.hostname.toLowerCase() === 'linear.app' && projectIndex >= 0 && segments[projectIndex + 1]) {
      return `https://${url.hostname}/${segments[0]}/project/${segments[projectIndex + 1]}`;
    }
  } catch {}
  return input;
}

function normalizeStateName(value) {
  return clean(value).toLowerCase();
}

function workflowStates(manifest) {
  return asArray(manifest?.workflowStates);
}

function findBacklogState(workspaceManifest, issue = null) {
  const states = workflowStates(workspaceManifest);
  const issueTeamKey = issue?.team?.key || issue?.teamKey || null;
  return states.find(state =>
    state.type === 'backlog' &&
    (!issueTeamKey || !state.teamKey || state.teamKey === issueTeamKey)
  ) || states.find(state => state.type === 'backlog') || null;
}

function candidateIssues(project) {
  return asArray(project?.issues?.nodes || project?.issues).filter(issue => {
    const state = issue.state || {};
    if (['completed', 'canceled', 'duplicate'].includes(state.type)) return false;
    return state.type === 'started' || ['ready', 'in progress'].includes(normalizeStateName(state.name));
  });
}

function freezeBody({ project, reason, recoveryCondition, movedIssues, statusResolution }) {
  const moved = movedIssues.length
    ? movedIssues.map(issue => `- ${issue.identifier || issue.id}: ${issue.title || '(untitled)'}`).join('\n')
    : '- No Ready/In Progress issue state changes requested.';
  const statusLine = statusResolution.ok
    ? `- Paused Project status candidate: ${statusResolution.object.name} (${statusResolution.id}) from ${statusResolution.evidenceRef}.`
    : `- Paused Project status not changed: ${statusResolution.message}`;
  return [
    `# Project freeze - ${project.name || project.id}`,
    '',
    '## 冻结范围',
    `- Project: ${project.name || project.id}`,
    `- Reason: ${reason || 'Temporary governance freeze.'}`,
    '- Scope: pause new execution decisions until recovery conditions are met.',
    '',
    '## 恢复条件',
    `- ${recoveryCondition || 'Owner selects a recovery entry after fresh Linear readback.'}`,
    '',
    '## 风险',
    '- Active work may become stale while the freeze is in effect.',
    '- Resume requires fresh facts before issue state changes.',
    '',
    '## Project status resolution',
    statusLine,
    '',
    '## Non-changes',
    '- Does not change repo mapping.',
    '- Does not change completed issues.',
    '- Does not create milestones.',
    '- Does not change target date.',
    '- Does not write Project status unless the resolver finds a unique candidate and the operator explicitly opts in.',
    '',
    '## Issue state handling',
    moved
  ].join('\n');
}

function unfreezeBody({ project, recoveryEntry, statusResolution }) {
  const statusLine = statusResolution.ok
    ? `- Started/active Project status candidate: ${statusResolution.object.name} (${statusResolution.id}) from ${statusResolution.evidenceRef}; operator confirmation is still required before writing statusId.`
    : `- Started/active Project status not changed: ${statusResolution.message}`;
  return [
    `# Project unfreeze - ${project.name || project.id}`,
    '',
    '## Fresh fact readback',
    '- Linear Project context must be re-read before applying recovery changes.',
    '',
    '## 恢复入口',
    `- ${recoveryEntry}`,
    '',
    '## Project status resolution',
    statusLine,
    '',
    '## Non-changes',
    '- Does not change repo mapping.',
    '- Does not create milestones.',
    '- Does not change target date.',
    '- Does not change completed issues.'
  ].join('\n');
}

function basePlan(kind, project, url) {
  return {
    idempotencyKey: `project-${kind}-${hash(`${project.id}:${url}:${kind}`).slice(0, 12)}`,
    dryRun: true,
    confirmedByUser: false,
    targetProjectId: project.id,
    dependencyValidation: `${kind} template is a project governance action; relation changes are not required.`,
    readbackRequired: true,
    auditLogRequired: true,
    operations: []
  };
}

export function buildFreezePlan({
  projectUrl,
  projectEvidence,
  workspaceManifest = {},
  moveActiveIssuesToBacklog = false,
  includeProjectStatusUpdate = false,
  reason = '',
  recoveryCondition = ''
} = {}) {
  const project = projectFromEvidence(projectEvidence);
  if (!project?.id) throw new Error('Project evidence with project.id is required for freeze template.');
  const url = projectUrlBase(projectUrl || project.url);
  const movedIssues = moveActiveIssuesToBacklog ? candidateIssues(project) : [];
  const statusResolution = resolveProjectStatus(workspaceManifest, { intent: 'paused' });
  const plan = basePlan('freeze', project, url);
  plan.projectUrl = url;
  plan.pausedProjectStatusResolution = statusResolution;
  plan.operations.push({
    key: 'freeze-update',
    type: 'projectUpdate.create',
    input: {
      projectId: project.id,
      health: 'atRisk',
      body: freezeBody({ project, reason, recoveryCondition, movedIssues, statusResolution })
    }
  });

  if (includeProjectStatusUpdate && statusResolution.ok) {
    plan.operations.push({
      key: 'freeze-project-status',
      type: 'project.update',
      input: {
        projectId: project.id,
        projectStatusIntent: 'paused'
      },
      reason: `Freeze resolved paused Project status from ${statusResolution.evidenceRef}.`
    });
  }

  for (const issue of movedIssues) {
    const backlog = findBacklogState(workspaceManifest, issue);
    if (!backlog?.id) continue;
    plan.operations.push({
      key: `backlog-${issue.identifier || issue.id}`,
      type: 'issue.update',
      input: {
        issueId: issue.id,
        stateId: backlog.id
      },
      reason: `Freeze moves ${issue.identifier || issue.id} from ${issue.state?.name || 'active'} to Backlog.`
    });
  }

  return {
    ok: true,
    kind: 'project_freeze',
    sourceProjectUrl: url,
    plan,
    nonChanges: ['repo', 'completedIssues', 'milestones', 'target date']
  };
}

export function buildUnfreezePlan({
  projectUrl,
  projectEvidence,
  workspaceManifest = {},
  includeProjectStatusUpdate = false,
  confirmStatusUpdate = false,
  recoveryEntry = ''
} = {}) {
  const project = projectFromEvidence(projectEvidence);
  if (!project?.id) throw new Error('Project evidence with project.id is required for unfreeze template.');
  const url = projectUrlBase(projectUrl || project.url);
  const statusResolution = resolveProjectStatus(workspaceManifest, { intent: 'started' });
  if (!clean(recoveryEntry)) {
    return {
      ok: false,
      code: 'unfreeze_recovery_entry_required',
      kind: 'project_unfreeze',
      sourceProjectUrl: url,
      shouldReadLive: true,
      startedProjectStatusResolution: statusResolution,
      message: 'Unfreeze must re-read fresh Linear Project facts and choose a recovery entry before generating a write plan.',
      recoveryEntryOptions: ['resume-ready', 'resume-in-progress', 'manual-selection']
    };
  }
  if (includeProjectStatusUpdate && !confirmStatusUpdate) {
    return {
      ok: false,
      code: 'unfreeze_status_confirmation_required',
      kind: 'project_unfreeze',
      sourceProjectUrl: url,
      shouldReadLive: true,
      startedProjectStatusResolution: statusResolution,
      message: 'Unfreeze Project status writes require explicit operator confirmation.'
    };
  }
  const plan = basePlan('unfreeze', project, url);
  plan.projectUrl = url;
  plan.startedProjectStatusResolution = statusResolution;
  plan.operations.push({
    key: 'unfreeze-update',
    type: 'projectUpdate.create',
    input: {
      projectId: project.id,
      health: 'onTrack',
      body: unfreezeBody({ project, recoveryEntry, statusResolution })
    }
  });
  if (includeProjectStatusUpdate && confirmStatusUpdate && statusResolution.ok) {
    plan.operations.push({
      key: 'unfreeze-project-status',
      type: 'project.update',
      input: {
        projectId: project.id,
        projectStatusIntent: 'started'
      },
      reason: `Unfreeze resolved started/active Project status from ${statusResolution.evidenceRef}.`
    });
  }
  return {
    ok: true,
    kind: 'project_unfreeze',
    sourceProjectUrl: url,
    shouldReadLive: true,
    plan
  };
}

function loadProjectEvidence(projectUrl, evidencePath) {
  if (evidencePath) return readJson(evidencePath);
  const result = spawnSync(process.execPath, ['scripts/linear-cli.mjs', 'project', projectUrl], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: process.env
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'linear project read failed');
  return JSON.parse(result.stdout);
}

function loadWorkspaceManifest(manifestPath) {
  if (manifestPath) return readJson(manifestPath, {});
  const result = spawnSync(process.execPath, ['scripts/linear-cli.mjs', 'workspace'], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env: process.env
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'linear workspace read failed');
  const manifest = JSON.parse(result.stdout);
  const outputPath = process.env.LINEAR_WORKSPACE_OBJECT_MANIFEST_PATH || 'state/workspace-object-manifest.json';
  manifest.evidenceRef = outputPath;
  writeJson(outputPath, manifest);
  return manifest;
}

function main() {
  const mode = process.argv[2];
  const projectUrl = arg('--project-url', '');
  const projectEvidencePath = arg('--project-evidence', '');
  const workspaceManifestPath = arg('--workspace-manifest', '');
  if (!['freeze', 'unfreeze'].includes(mode)) {
    throw new Error('Usage: node scripts/project-governance-template.mjs <freeze|unfreeze> --project-url <Linear Project URL> [--project-evidence path] [--workspace-manifest path]');
  }
  if (!projectUrl) throw new Error('--project-url is required.');
  const projectEvidence = loadProjectEvidence(projectUrl, projectEvidencePath);
  const workspaceManifest = loadWorkspaceManifest(workspaceManifestPath);
  const output = mode === 'freeze'
    ? buildFreezePlan({
      projectUrl,
      projectEvidence,
      workspaceManifest,
      moveActiveIssuesToBacklog: process.argv.includes('--move-active-issues-to-backlog'),
      includeProjectStatusUpdate: process.argv.includes('--include-project-status-update'),
      reason: arg('--reason', ''),
      recoveryCondition: arg('--recovery-condition', '')
    })
    : buildUnfreezePlan({
      projectUrl,
      projectEvidence,
      workspaceManifest,
      includeProjectStatusUpdate: process.argv.includes('--include-project-status-update'),
      confirmStatusUpdate: process.argv.includes('--confirm-status-update'),
      recoveryEntry: arg('--recovery-entry', '')
    });
  json(output);
  if (process.argv.includes('--strict') && !output.ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    json({ ok: false, error: err.message, stack: process.env.DEBUG ? err.stack : undefined });
    process.exit(1);
  }
}
