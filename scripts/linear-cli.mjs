#!/usr/bin/env node
import { LinearClient } from '@linear/sdk';
import { json, now, writeJson } from './utils.mjs';
import { isIssueIdentifierOrUuid } from './retrieval-utils.mjs';
import { resolveLinearProjectId } from './linear-project-resolver.mjs';
import { listProjectStatuses } from './linear-project-status-resolver.mjs';
import { appendAuditWarning, errorMessage } from './linear-apply/audit.mjs';
import { applyPlanCommand } from './linear-apply/command.mjs';

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
  const teams = await linear.teams();
  const labels = await linear.issueLabels();
  const users = await linear.users();
  const projects = await workspaceProjectSummaries(linear);
  const projectStatuses = await workspaceProjectStatuses(linear);
  let workflowStates = [];
  try {
    const statesData = await linear.client.rawRequest(`
      query WorkspaceWorkflowStates {
        teams(first: 50) {
          nodes {
            id
            key
            name
            states {
              nodes { id name type position }
            }
          }
        }
      }`);
    workflowStates = statesData.data.teams.nodes.flatMap(team =>
      team.states.nodes.map(state => ({ ...state, teamId: team.id, teamKey: team.key, teamName: team.name }))
    );
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
    teams: teams.nodes.map(t => ({ id: t.id, key: t.key, name: t.name })),
    labels: labels.nodes.map(l => ({ id: l.id, name: l.name, color: l.color })),
    users: users.nodes.slice(0, 100).map(u => ({ id: u.id, name: u.name, active: u.active, admin: u.admin })),
    projects,
    projectStatuses,
    workflowStates
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
  const [base, statesData, projectStatuses] = await Promise.all([
    linear.client.rawRequest(`
      query WorkspaceObjectManifest {
        teams(first: 50) {
          nodes { id key name }
        }
        issueLabels(first: 250) {
          nodes {
            id
            name
            color
            team { id key name }
            parent { id name }
          }
        }
      }`),
    linear.client.rawRequest(`
      query WorkspaceWorkflowStates {
        teams(first: 50) {
          nodes {
            id
            key
            name
            states { nodes { id name type position } }
          }
        }
      }`),
    workspaceProjectStatuses(linear)
  ]);
  const teams = base.data.teams.nodes.map(team => ({ id: team.id, key: team.key, name: team.name }));
  const labels = base.data.issueLabels.nodes.map(label => ({
    id: label.id,
    name: label.name,
    color: label.color,
    group: label.parent?.name || null,
    teamId: label.team?.id || null,
    teamKey: label.team?.key || null,
    teamName: label.team?.name || null
  }));
  const workflowStates = statesData.data.teams.nodes.flatMap(team =>
    team.states.nodes.map(state => ({
      id: state.id,
      name: state.name,
      type: state.type,
      position: state.position,
      teamId: team.id,
      teamKey: team.key,
      teamName: team.name
    }))
  );
  const projectMilestoneResults = await Promise.all(projectIds.map(projectId =>
    linear.client.rawRequest(`
      query ProjectMilestonesForResolver($id: String!) {
        project(id: $id) {
          id
          name
          projectMilestones(first: 100) {
            nodes { id name targetDate sortOrder }
          }
        }
      }`, { id: projectId })
  ));
  const projectMilestones = projectMilestoneResults.flatMap(result => {
    const project = result.data.project;
    if (!project) return [];
    return project.projectMilestones.nodes.map(milestone => ({
      id: milestone.id,
      name: milestone.name,
      targetDate: milestone.targetDate,
      sortOrder: milestone.sortOrder,
      projectId: project.id,
      projectName: project.name
    }));
  });
  const labelGroups = {};
  for (const label of labels) {
    if (!label.group) continue;
    labelGroups[label.group] ||= {};
  }
  return {
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
}

async function workspaceProjectStatuses(linear) {
  const res = await linear.client.rawRequest(`
    query WorkspaceProjectStatuses {
      projectStatuses(first: 100) {
        nodes {
          id
          name
          type
          color
          description
          position
          indefinite
          archivedAt
        }
      }
    }`);
  const statuses = res.data.projectStatuses.nodes.map(status => ({
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
  const projectsData = await linear.client.rawRequest(`
    query WorkspaceProjects {
      projects(first: 100) {
        nodes {
          id
          name
          url
          state
          createdAt
          updatedAt
          startDate
          targetDate
          archivedAt
        }
      }
    }`);
  return projectsData.data.projects.nodes.map(project => ({
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
