import path from 'node:path';
import { readJson } from './utils.mjs';

function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function manifestEvidenceRef(manifest, manifestPath) {
  return manifestPath || manifest?.evidenceRef || manifest?.rawEvidenceRef || 'workspace-manifest';
}

function teamMatches(item, team) {
  if (!team.key && !team.id) return true;
  if (!item.teamId && !item.teamKey) return true;
  return lower(item.teamKey) === lower(team.key) || lower(item.teamId) === lower(team.id);
}

function compactCandidate(item) {
  return {
    id: item.id || null,
    name: item.name || null,
    group: item.group || item.groupName || item.parent?.name || null,
    teamKey: item.teamKey || item.team?.key || null,
    teamId: item.teamId || item.team?.id || null,
    projectId: item.projectId || item.project?.id || null,
    type: item.type || null
  };
}

function gap(kind, locator, message, candidates, evidenceRef) {
  return {
    ok: false,
    type: 'linear_object_resolution_gap',
    kind,
    locator,
    evidenceRef,
    blocking: true,
    message,
    candidates: candidates.slice(0, 8).map(compactCandidate)
  };
}

function ok(kind, locator, item, evidenceRef, chain) {
  return {
    ok: true,
    kind,
    locator,
    id: item.id,
    object: compactCandidate(item),
    evidenceRef,
    chain
  };
}

function findTeam(manifest, teamKey, teamId) {
  const teams = asArray(manifest.teams);
  return teams.find(team => lower(team.id) === lower(teamId) || lower(team.key) === lower(teamKey)) || {
    id: teamId || null,
    key: teamKey || null
  };
}

function labelGroup(label) {
  return label.group || label.groupName || label.parent?.name || null;
}

function labelItems(manifest) {
  if (Array.isArray(manifest.labels)) return manifest.labels;
  return [];
}

function workflowStateItems(manifest) {
  if (Array.isArray(manifest.workflowStates)) return manifest.workflowStates;
  return [];
}

function milestoneItems(manifest) {
  if (Array.isArray(manifest.projectMilestones)) return manifest.projectMilestones;
  return asArray(manifest.projects).flatMap(project =>
    asArray(project.projectMilestones || project.milestones).map(milestone => ({
      ...milestone,
      projectId: milestone.projectId || project.id
    }))
  );
}

function resolveLabel(manifest, locator, evidenceRef) {
  const team = findTeam(manifest, locator.teamKey, locator.teamId);
  const name = clean(locator.name);
  const group = clean(locator.group);
  const candidates = labelItems(manifest).filter(label =>
    lower(label.name) === lower(name) &&
    (!group || lower(labelGroup(label)) === lower(group)) &&
    teamMatches(label, team)
  );
  if (candidates.length === 1) {
    return ok('label', { name, group: group || null, teamKey: team.key, teamId: team.id }, candidates[0], evidenceRef, [
      { source: 'team', key: team.key, id: team.id },
      { source: 'label', name, group: group || labelGroup(candidates[0]) || null }
    ]);
  }
  return gap(
    'label',
    { name, group: group || null, teamKey: team.key, teamId: team.id },
    candidates.length
      ? `Linear label matched multiple candidates: ${name}`
      : `Linear label could not be resolved exactly: ${name}`,
    candidates,
    evidenceRef
  );
}

function resolveWorkflowState(manifest, locator, evidenceRef) {
  const team = findTeam(manifest, locator.teamKey, locator.teamId);
  const name = clean(locator.name);
  const type = clean(locator.type);
  const candidates = workflowStateItems(manifest).filter(state =>
    (!name || lower(state.name) === lower(name)) &&
    (!type || lower(state.type) === lower(type)) &&
    teamMatches(state, team) &&
    (team.key || team.id)
  );
  if (candidates.length === 1) {
    return ok('workflowState', { name: name || null, type: type || null, teamKey: team.key, teamId: team.id }, candidates[0], evidenceRef, [
      { source: 'team', key: team.key, id: team.id },
      { source: 'workflowState', name: candidates[0].name, type: candidates[0].type }
    ]);
  }
  return gap(
    'workflowState',
    { name: name || null, type: type || null, teamKey: team.key, teamId: team.id },
    candidates.length
      ? `Linear workflow state matched multiple candidates: ${name || type}`
      : `Linear workflow state could not be resolved exactly for team: ${name || type}`,
    candidates,
    evidenceRef
  );
}

function resolveProjectMilestone(manifest, locator, evidenceRef) {
  const name = clean(locator.name);
  const projectId = clean(locator.projectId);
  const candidates = milestoneItems(manifest).filter(milestone =>
    lower(milestone.name) === lower(name) &&
    lower(milestone.projectId || milestone.project?.id) === lower(projectId)
  );
  if (candidates.length === 1) {
    return ok('projectMilestone', { name, projectId }, candidates[0], evidenceRef, [
      { source: 'project', id: projectId },
      { source: 'projectMilestone', name }
    ]);
  }
  return gap(
    'projectMilestone',
    { name, projectId },
    candidates.length
      ? `Linear Project Milestone matched multiple candidates in project ${projectId}: ${name}`
      : `Linear Project Milestone could not be resolved exactly in project ${projectId}: ${name}`,
    candidates,
    evidenceRef
  );
}

export function resolveLinearObject(manifest, locator, options = {}) {
  const evidenceRef = manifestEvidenceRef(manifest, options.manifestPath);
  if (locator.kind === 'label') return resolveLabel(manifest, locator, evidenceRef);
  if (locator.kind === 'workflowState') return resolveWorkflowState(manifest, locator, evidenceRef);
  if (locator.kind === 'projectMilestone') return resolveProjectMilestone(manifest, locator, evidenceRef);
  return gap(locator.kind || 'unknown', locator, `Unsupported Linear object resolver kind: ${locator.kind}`, [], evidenceRef);
}

function labelGroups(manifest) {
  return manifest.labelGroups || manifest.labelsByGroup || {};
}

function groupPolicy(manifest, group) {
  const groups = labelGroups(manifest);
  const policy = groups[group] || groups[lower(group)] || {};
  if (policy.exactlyOne === false || policy.mutuallyExclusive === false) {
    return { exactlyOne: false };
  }
  return {
    exactlyOne: true
  };
}

function finding(code, message, path, extra = {}) {
  return { code, severity: 'error', blocking: true, path, message, ...extra };
}

function namesFrom(input, fields) {
  return fields.flatMap(field => asArray(input[field]).map(name => ({ field, name }))).filter(item => clean(item.name));
}

function addResolvedIds(input, fieldName, ids) {
  input[fieldName] = [...new Set([...(input[fieldName] || []), ...ids])];
}

function resolveLabelFieldSet(manifest, input, fields, outputField, pathPrefix, findings, resolutions, options) {
  const resolved = [];
  for (const { field, name } of namesFrom(input, fields)) {
    const result = resolveLinearObject(manifest, {
      kind: 'label',
      teamKey: input.teamKey,
      teamId: input.teamId,
      name,
      group: input.labelGroup || input.labelGroups?.[name]
    }, options);
    if (!result.ok) {
      findings.push(finding('linear_object_resolution_gap', result.message, `${pathPrefix}.${field}`, { resolution: result }));
      continue;
    }
    resolved.push(result);
    resolutions.push({ ...result, path: `${pathPrefix}.${field}` });
  }

  const exactlyOneByGroup = new Map();
  for (const result of resolved) {
    const group = result.object.group;
    if (!group || !groupPolicy(manifest, group).exactlyOne) continue;
    if (!exactlyOneByGroup.has(group)) exactlyOneByGroup.set(group, []);
    exactlyOneByGroup.get(group).push(result);
  }
  for (const [group, items] of exactlyOneByGroup) {
    if (items.length <= 1) continue;
    findings.push(finding(
      'linear_label_group_conflict',
      `Linear label group allows exactly one label but multiple were requested: ${group}`,
      pathPrefix,
      { group, labels: items.map(item => item.object) }
    ));
  }

  if (resolved.length) addResolvedIds(input, outputField, resolved.map(item => item.id));
}

export function resolveOperationInput(input, {
  manifest,
  manifestPath = null,
  pathPrefix = '$.input',
  operationType = ''
} = {}) {
  const out = { ...input };
  const findings = [];
  const resolutions = [];
  const options = { manifestPath };

  resolveLabelFieldSet(manifest, out, ['labels', 'labelNames'], 'labelIds', pathPrefix, findings, resolutions, options);
  resolveLabelFieldSet(manifest, out, ['addedLabels', 'addedLabelNames'], 'addedLabelIds', pathPrefix, findings, resolutions, options);
  resolveLabelFieldSet(manifest, out, ['removedLabels', 'removedLabelNames'], 'removedLabelIds', pathPrefix, findings, resolutions, options);

  const stateName = out.workflowStateName || out.stateName;
  const stateType = out.workflowStateType || out.stateType;
  if (stateName || stateType) {
    const result = resolveLinearObject(manifest, {
      kind: 'workflowState',
      teamKey: out.teamKey,
      teamId: out.teamId,
      name: stateName,
      type: stateType
    }, options);
    if (result.ok) {
      out.stateId = result.id;
      resolutions.push({ ...result, path: `${pathPrefix}.workflowStateName` });
    } else {
      findings.push(finding('linear_object_resolution_gap', result.message, `${pathPrefix}.workflowStateName`, { resolution: result }));
    }
  }

  const milestoneName = out.milestoneName || out.projectMilestoneName;
  if (milestoneName) {
    const result = resolveLinearObject(manifest, {
      kind: 'projectMilestone',
      projectId: out.projectId,
      name: milestoneName
    }, options);
    if (result.ok) {
      out.projectMilestoneId = result.id;
      resolutions.push({ ...result, path: `${pathPrefix}.milestoneName` });
    } else {
      findings.push(finding('linear_object_resolution_gap', result.message, `${pathPrefix}.milestoneName`, { resolution: result }));
    }
  }

  return {
    ok: findings.length === 0,
    input: out,
    findings,
    resolutions,
    operationType
  };
}

export function resolveWritePlanObjects(plan, { manifest = null, manifestPath = null } = {}) {
  const loadedManifest = manifest || readJson(manifestPath);
  if (!loadedManifest) throw new Error(`Workspace manifest not found: ${manifestPath || '(none)'}`);
  const effectiveManifestPath = manifestPath ? path.resolve(manifestPath) : null;
  const out = {
    ...plan,
    operations: asArray(plan.operations).map(operation => ({ ...operation, input: { ...(operation.input || {}) } }))
  };
  const findings = [];
  const resolutions = [];

  out.operations.forEach((operation, index) => {
    const result = resolveOperationInput(operation.input || {}, {
      manifest: loadedManifest,
      manifestPath: effectiveManifestPath,
      pathPrefix: `$.operations[${index}].input`,
      operationType: operation.type
    });
    operation.input = result.input;
    findings.push(...result.findings);
    resolutions.push(...result.resolutions);
  });

  return {
    ok: findings.length === 0,
    plan: out,
    findings,
    resolutions
  };
}
