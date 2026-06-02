#!/usr/bin/env node
import { LinearClient } from '@linear/sdk';
import { json, now, writeJson } from './utils.mjs';
import { isIssueIdentifierOrUuid } from './retrieval-utils.mjs';
import { resolveLinearProjectId } from './linear-project-resolver.mjs';
import { listProjectStatuses } from './linear-project-status-resolver.mjs';
import { appendAuditWarning, errorMessage } from './linear-apply/audit.mjs';
import { applyPlanCommand } from './linear-apply/command.mjs';
import { collectConnectionNodes, manifestCompleteness, manifestHash } from './linear-workspace-manifest.mjs';

const apiKey = process.env.LINEAR_API_KEY;
const cmd = process.argv[2] || 'smoke';

function client() {
  if (!apiKey) throw new Error('LINEAR_API_KEY missing. Copy .env.example to .env and set token.');
  return new LinearClient({ apiKey });
}

async function smoke() {
  const linear = client();
  const viewer = await linear.viewer;
  json({ ok: true, sourceType: 'linear_live', collectedAt: now(), viewer: { id: viewer.id, name: viewer.name, email: viewer.email } });
}

async function workspace() {
  const linear = client();
  const viewer = await linear.viewer;
  const teams = await workspaceTeams(linear);
  const labels = await workspaceLabels(linear);
  const users = await workspaceUsers(linear);
  const projects = await workspaceProjectSummaries(linear);
  const projectStatuses = await workspaceProjectStatuses(linear);
  let workflowStates = [];
  try {
    workflowStates = await workspaceWorkflowStates(linear, teams);
  } catch (err) {
    appendAuditWarning('workspace.workflowStates.empty', err, { command: 'workspace' });
    workflowStates = [];
  }
  const collected = new Date();
  json({
    ok: true,
    sourceType: 'linear_live',
    collectedAt: collected.toISOString(),
    viewer: { id: viewer.id, name: viewer.name },
    teams,
    labels: labels.map(l => ({ id: l.id, name: l.name, color: l.color })),
    users: users.map(u => ({ id: u.id, name: u.name, active: u.active, admin: u.admin })),
    projects,
    projectStatuses,
    workflowStates,
    completeness: manifestCompleteness({
      teams: teams.length,
      labels: labels.length,
      users: users.length,
      projects: projects.length,
      projectStatuses: projectStatuses.length,
      workflowStates: workflowStates.length
    }, false),
    truncated: false
  });
}

function projectIdsFromPlan(plan) {
  const ids = new Set();
  for (const op of plan.operations || []) {
    const input = op.input || {};
    for (const value of [input.projectId, plan.targetProjectId, plan.projectId, plan.targetProject?.id]) {
      if (typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)) ids.add(value);
    }
  }
  return [...ids];
}

async function workspaceObjectManifest(linear, projectIds = []) {
  const [teams, rawLabels, projectStatuses] = await Promise.all([
    workspaceTeams(linear),
    workspaceLabels(linear, true),
    workspaceProjectStatuses(linear)
  ]);
  const labels = rawLabels.map(label => ({
    id: label.id,
    name: label.name,
    color: label.color,
    group: label.parent?.name || null,
    teamId: label.team?.id || null,
    teamKey: label.team?.key || null,
    teamName: label.team?.name || null
  }));
  const workflowStates = await workspaceWorkflowStates(linear, teams);
  const projectMilestones = (await Promise.all(projectIds.map(projectId => projectMilestonesForProject(linear, projectId)))).flat();
  const labelGroups = {};
  for (const label of labels) {
    if (!label.group) continue;
    labelGroups[label.group] ||= {};
  }
  const manifest = {
    version: 1,
    sourceType: 'linear_live',
    collectedAt: now(),
    teams,
    labels,
    labelGroups,
    projectStatuses,
    workflowStates,
    projectMilestones
  };
  manifest.completeness = manifestCompleteness({
    teams: teams.length,
    labels: labels.length,
    projectStatuses: projectStatuses.length,
    workflowStates: workflowStates.length,
    projectMilestones: projectMilestones.length
  }, false);
  manifest.truncated = false;
  manifest.manifestHash = manifestHash(manifest);
  return manifest;
}

async function workspaceTeams(linear) {
  return (await collectConnectionNodes(linear.client, {
    rootField: 'teams',
    nodeSelection: 'id key name',
    pageSize: 250,
    queryName: 'WorkspaceTeamsPaginated'
  })).map(team => ({ id: team.id, key: team.key, name: team.name }));
}

async function workspaceLabels(linear, includeRelations = false) {
  return collectConnectionNodes(linear.client, {
    rootField: 'issueLabels',
    nodeSelection: includeRelations
      ? 'id name color team { id key name } parent { id name }'
      : 'id name color',
    pageSize: 250,
    queryName: 'WorkspaceLabelsPaginated'
  });
}

async function workspaceUsers(linear) {
  return collectConnectionNodes(linear.client, {
    rootField: 'users',
    nodeSelection: 'id name active admin',
    pageSize: 250,
    queryName: 'WorkspaceUsersPaginated'
  });
}

async function workflowStatesForTeam(linear, team) {
  const states = await collectConnectionNodes(linear.client, {
    rootField: 'states',
    nodeSelection: 'id name type position',
    variables: { teamId: team.id },
    pageSize: 250,
    queryName: 'TeamWorkflowStatesPaginated',
    variableDefinitions: ', $teamId: String!',
    queryPrefix: 'team(id: $teamId) {',
    querySuffix: '}'
  });
  return states.map(state => ({
      id: state.id,
      name: state.name,
      type: state.type,
      position: state.position,
      teamId: team.id,
      teamKey: team.key,
      teamName: team.name
  }));
}

async function workspaceWorkflowStates(linear, teams) {
  return (await Promise.all(teams.map(team => workflowStatesForTeam(linear, team)))).flat();
}

async function projectMilestonesForProject(linear, projectId) {
  const first = await linear.client.rawRequest(`
    query ProjectForMilestones($id: String!) {
      project(id: $id) { id name }
    }`, { id: projectId });
  const project = first.data?.project;
  if (!project) return [];
  const milestones = await collectConnectionNodes(linear.client, {
    rootField: 'projectMilestones',
    nodeSelection: 'id name targetDate sortOrder',
    variables: { projectId },
    pageSize: 250,
    queryName: 'ProjectMilestonesPaginated',
    variableDefinitions: ', $projectId: String!',
    queryPrefix: 'project(id: $projectId) {',
    querySuffix: '}'
  });
  return milestones.map(milestone => ({
      id: milestone.id,
      name: milestone.name,
      targetDate: milestone.targetDate,
      sortOrder: milestone.sortOrder,
      projectId: project.id,
      projectName: project.name
  }));
}

async function workspaceProjectStatuses(linear) {
  const rawStatuses = await collectConnectionNodes(linear.client, {
    rootField: 'projectStatuses',
    nodeSelection: 'id name type color description position indefinite archivedAt',
    pageSize: 250,
    queryName: 'WorkspaceProjectStatusesPaginated'
  });
  const statuses = rawStatuses.map(status => ({
    id: status.id,
    name: status.name,
    type: status.type,
    color: status.color,
    description: status.description,
    position: status.position,
    indefinite: status.indefinite,
    archivedAt: status.archivedAt
  }));
  return listProjectStatuses({ projectStatuses: statuses });
}

async function cachedWorkspaceObjectManifest(linear, plan = {}) {
  const manifestPath = process.env.LINEAR_WORKSPACE_OBJECT_MANIFEST_PATH || 'state/workspace-object-manifest.json';
  const manifest = await workspaceObjectManifest(linear, projectIdsFromPlan(plan));
  manifest.evidenceRef = manifestPath;
  writeJson(manifestPath, manifest);
  return { manifest, manifestPath };
}

async function workspaceProjectSummaries(linear) {
  const projects = await collectConnectionNodes(linear.client, {
    rootField: 'projects',
    nodeSelection: 'id name url state createdAt updatedAt startDate targetDate archivedAt',
    pageSize: 250,
    queryName: 'WorkspaceProjectsPaginated'
  });
  return projects.map(project => ({
    id: project.id,
    name: project.name,
    url: project.url,
    state: project.state,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    startDate: project.startDate,
    targetDate: project.targetDate,
    archivedAt: project.archivedAt,
    active: !project.archivedAt && !['canceled', 'completed'].includes(project.state)
  }));
}

async function project(projectIdOrKey) {
  const linear = client();
  const query = `
    query ProjectContext($id: String!) {
      project(id: $id) {
        id name description url state createdAt updatedAt startDate targetDate
        projectMilestones { nodes { id name description targetDate sortOrder } }
        documents { nodes { id title url updatedAt } }
        projectUpdates { nodes { id body url createdAt updatedAt health } }
        issues { nodes { id identifier title description priority url createdAt updatedAt
          state { id name type }
          labels { nodes { id name } }
          assignee { id name }
          projectMilestone { id name }
        } }
      }
    }`;
  const resolution = await resolveLinearProjectId(projectIdOrKey, {
    directLookup: async locator => {
      const res = await linear.client.rawRequest(query, { id: locator });
      return res.data?.project || null;
    },
    workspaceProjects: () => workspaceProjectSummaries(linear)
  });

  if (!resolution.ok) {
    json({
      ok: false,
      error: resolution.message,
      sourceType: 'linear_live',
      collectedAt: now(),
      resolution
    });
    process.exitCode = 1;
    return;
  }

  const projectData = resolution.source === 'direct'
    ? resolution.project
    : (await linear.client.rawRequest(query, { id: resolution.resolvedProjectId })).data?.project;
  json({
    ok: true,
    sourceType: 'linear_live',
    collectedAt: now(),
    resolvedProject: {
      input: projectIdOrKey,
      resolvedProjectId: resolution.resolvedProjectId,
      source: resolution.source,
      directError: resolution.directError || null
    },
    data: { project: projectData }
  });
}

async function issues() {
  const queryText = process.argv.includes('--query') ? process.argv[process.argv.indexOf('--query') + 1] : '';
  const linear = client();
  const query = `query Issues($term: String) { issues(filter: { or: [{ title: { containsIgnoreCase: $term } }, { description: { containsIgnoreCase: $term } }] }, first: 20) { nodes { id identifier title url updatedAt state { name type } labels { nodes { name } } } } }`;
  const res = await linear.client.rawRequest(query, { term: queryText });
  json({ ok: true, sourceType: 'linear_live', collectedAt: now(), query: queryText, semantics: 'full-text-contains', data: res.data });
}

async function projectStatuses() {
  const linear = client();
  const statuses = await workspaceProjectStatuses(linear);
  json({ ok: true, sourceType: 'linear_live', collectedAt: now(), projectStatuses: statuses });
}

async function issue(identifierOrId) {
  if (!identifierOrId) throw new Error('issue requires an identifier or UUID.');
  if (!isIssueIdentifierOrUuid(identifierOrId)) throw new Error('issue expects an exact Linear identifier like WEN-239 or a UUID. Use `issues --query` for full-text search.');
  const linear = client();
  const query = `
    query IssueExact($id: String!) {
      issue(id: $id) {
        id identifier title url description priority createdAt updatedAt
        state { id name type }
        labels { nodes { id name } }
        assignee { id name }
        project { id name url }
        projectMilestone { id name }
      }
    }`;
  const res = await linear.client.rawRequest(query, { id: identifierOrId });
  json({ ok: Boolean(res.data?.issue), sourceType: 'linear_live', collectedAt: now(), identifierOrId, semantics: 'exact-identifier-or-uuid', data: res.data });
}

try {
  if (cmd === 'smoke') await smoke();
  else if (cmd === 'workspace') await workspace();
  else if (cmd === 'project') await project(process.argv[3]);
  else if (cmd === 'project-statuses') await projectStatuses();
  else if (cmd === 'issue') await issue(process.argv[3]);
  else if (cmd === 'issues') await issues();
  else if (cmd === 'apply') await applyPlanCommand(process.argv[3], { client, cachedWorkspaceObjectManifest, env: process.env, argv: process.argv, cwd: process.cwd() });
  else json({ ok: false, error: `unknown command ${cmd}` });
} catch (err) {
  json({ ok: false, error: errorMessage(err), stack: process.env.DEBUG && err instanceof Error ? err.stack : undefined });
  process.exit(1);
}
