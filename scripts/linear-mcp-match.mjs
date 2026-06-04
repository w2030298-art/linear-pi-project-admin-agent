// @ts-nocheck
import path from 'node:path';
import { readJson, asArray, cleanString } from './utils.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISSUE_IDENTIFIER_RE = /^[A-Z][A-Z0-9]+-\d+$/i;

function lower(value) {
  return cleanString(value).toLowerCase();
}

function normalizedText(value) {
  return cleanString(value).normalize('NFKC').toLowerCase().replace(/\s*\|\s*/g, '|').replace(/\s+/g, ' ').trim();
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
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

function findTeam(manifest, teamKey, teamId) {
  return asArray(manifest.teams).find(team => lower(team.id) === lower(teamId) || lower(team.key) === lower(teamKey)) || {
    id: teamId || null,
    key: teamKey || null
  };
}

function labelGroup(label) {
  return label.group || label.groupName || label.parent?.name || null;
}

function labelItems(manifest) {
  return asArray(manifest.labels);
}

function workflowStateItems(manifest) {
  return asArray(manifest.workflowStates);
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

function objectGap(kind, locator, message, candidates, evidenceRef) {
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

function objectOk(kind, locator, item, evidenceRef, chain) {
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

function resolveLabel(manifest, locator, evidenceRef) {
  const team = findTeam(manifest, locator.teamKey, locator.teamId);
  const name = cleanString(locator.name);
  const group = cleanString(locator.group);
  const candidates = labelItems(manifest).filter(label =>
    lower(label.name) === lower(name) &&
    (!group || lower(labelGroup(label)) === lower(group)) &&
    teamMatches(label, team)
  );
  if (candidates.length === 1) {
    return objectOk('label', { name, group: group || null, teamKey: team.key, teamId: team.id }, candidates[0], evidenceRef, [
      { source: 'team', key: team.key, id: team.id },
      { source: 'label', name, group: group || labelGroup(candidates[0]) || null }
    ]);
  }
  return objectGap('label', { name, group: group || null, teamKey: team.key, teamId: team.id }, candidates.length
    ? `Linear label matched multiple candidates: ${name}`
    : `Linear label could not be resolved exactly: ${name}`, candidates, evidenceRef);
}

function resolveWorkflowState(manifest, locator, evidenceRef) {
  const team = findTeam(manifest, locator.teamKey, locator.teamId);
  const name = cleanString(locator.name);
  const type = cleanString(locator.type);
  const candidates = workflowStateItems(manifest).filter(state =>
    (!name || lower(state.name) === lower(name)) &&
    (!type || lower(state.type) === lower(type)) &&
    teamMatches(state, team) &&
    (team.key || team.id)
  );
  if (candidates.length === 1) {
    return objectOk('workflowState', { name: name || null, type: type || null, teamKey: team.key, teamId: team.id }, candidates[0], evidenceRef, [
      { source: 'team', key: team.key, id: team.id },
      { source: 'workflowState', name: candidates[0].name, type: candidates[0].type }
    ]);
  }
  return objectGap('workflowState', { name: name || null, type: type || null, teamKey: team.key, teamId: team.id }, candidates.length
    ? `Linear workflow state matched multiple candidates: ${name || type}`
    : `Linear workflow state could not be resolved exactly for team: ${name || type}`, candidates, evidenceRef);
}

function resolveProjectMilestone(manifest, locator, evidenceRef) {
  const name = cleanString(locator.name);
  const projectId = cleanString(locator.projectId);
  const candidates = milestoneItems(manifest).filter(milestone =>
    lower(milestone.name) === lower(name) &&
    lower(milestone.projectId || milestone.project?.id) === lower(projectId)
  );
  if (candidates.length === 1) {
    return objectOk('projectMilestone', { name, projectId }, candidates[0], evidenceRef, [
      { source: 'project', id: projectId },
      { source: 'projectMilestone', name }
    ]);
  }
  return objectGap('projectMilestone', { name, projectId }, candidates.length
    ? `Linear Project Milestone matched multiple candidates in project ${projectId}: ${name}`
    : `Linear Project Milestone could not be resolved exactly in project ${projectId}: ${name}`, candidates, evidenceRef);
}

export function resolveLinearObject(manifest, locator, options = {}) {
  const evidenceRef = manifestEvidenceRef(manifest, options.manifestPath);
  if (locator.kind === 'label') return resolveLabel(manifest, locator, evidenceRef);
  if (locator.kind === 'workflowState') return resolveWorkflowState(manifest, locator, evidenceRef);
  if (locator.kind === 'projectMilestone') return resolveProjectMilestone(manifest, locator, evidenceRef);
  return objectGap(locator.kind || 'unknown', locator, `Unsupported Linear object resolver kind: ${locator.kind}`, [], evidenceRef);
}

function finding(code, message, path, extra = {}) {
  return { code, severity: 'error', blocking: true, path, message, ...extra };
}

function namesFrom(input, fields) {
  return fields.flatMap(field => asArray(input[field]).map(name => ({ field, name }))).filter(item => cleanString(item.name));
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

function labelGroups(manifest) {
  return manifest.labelGroups || manifest.labelsByGroup || {};
}

function groupPolicy(manifest, group) {
  const groups = labelGroups(manifest);
  const policy = groups[group] || groups[lower(group)] || {};
  if (policy.exactlyOne === false || policy.mutuallyExclusive === false) {
    return { exactlyOne: false };
  }
  return { exactlyOne: true };
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

  return { ok: findings.length === 0, input: out, findings, resolutions, operationType };
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

  return { ok: findings.length === 0, plan: out, findings, resolutions };
}

function compactIssue(issue) {
  return { id: issue.id || null, identifier: issue.identifier || null, title: issue.title || null, url: issue.url || null };
}

function issueResolutionGap(locator, path, message) {
  return { ok: false, code: 'linear_issue_identifier_resolution_gap', blocking: true, path, identifier: cleanString(locator), message };
}

export async function resolveIssueIdentifier(locator, { exactLookup, path = '$.input.issueIdentifier', role = 'issue' } = {}) {
  const input = cleanString(locator);
  if (!input) return issueResolutionGap(input, path, `Linear ${role} identifier is empty.`);

  if (UUID_RE.test(input)) {
    return {
      ok: true,
      kind: 'issue',
      role,
      path,
      identifier: null,
      id: input,
      source: 'input_uuid',
      evidenceRef: `linear:issue:${input}`,
      issue: { id: input, identifier: null, title: null, url: null }
    };
  }

  if (!ISSUE_IDENTIFIER_RE.test(input)) {
    return issueResolutionGap(input, path, `Linear ${role} must be a UUID or exact issue identifier like WEN-123.`);
  }
  if (typeof exactLookup !== 'function') {
    return issueResolutionGap(input, path, 'Linear exact issue lookup is unavailable.');
  }

  const issue = await exactLookup(input);
  if (!issue?.id) {
    return issueResolutionGap(input, path, `Linear issue identifier could not be resolved exactly: ${input}`);
  }

  return {
    ok: true,
    kind: 'issue',
    role,
    path,
    identifier: issue.identifier || input,
    id: issue.id,
    source: 'linear_issue_exact_lookup',
    evidenceRef: `linear:issue:${input}`,
    issue: compactIssue(issue),
    chain: [{ source: 'issue_identifier', identifier: input }, { source: 'linear_get_issue_exact', id: issue.id }]
  };
}

export async function resolveIssueRelationIdentifiers(input, { exactLookup, pathPrefix = '$.input' } = {}) {
  const out = { ...input };
  const findings = [];
  const resolutions = [];
  for (const target of [
    { field: 'issueIdentifier', idField: 'issueId', role: 'issue' },
    { field: 'relatedIssueIdentifier', idField: 'relatedIssueId', role: 'relatedIssue' }
  ]) {
    if (!out[target.field]) continue;
    const result = await resolveIssueIdentifier(out[target.field], {
      exactLookup,
      path: `${pathPrefix}.${target.field}`,
      role: target.role
    });
    if (result.ok) {
      out[target.idField] = result.id;
      resolutions.push(result);
    } else {
      findings.push({
        code: result.code,
        severity: 'error',
        blocking: true,
        path: result.path,
        message: result.message,
        resolution: result
      });
    }
  }
  return { ok: findings.length === 0, input: out, findings, resolutions };
}

export function semanticProjectStatus(status) {
  const type = lower(status?.type);
  const name = lower(status?.name).replace(/[-_]+/g, ' ');
  const value = `${type} ${name}`.trim();
  if (/\b(paused|pause|on hold|blocked|frozen|freeze)\b/.test(value)) return 'paused';
  if (/\b(started|active|in progress|on track)\b/.test(value)) return 'started';
  if (/\b(completed|complete|done)\b/.test(value)) return 'completed';
  if (/\b(canceled|cancelled)\b/.test(value)) return 'canceled';
  return type || null;
}

export function listProjectStatuses(manifest = {}) {
  return asArray(manifest.projectStatuses).map(status => ({
    id: status.id || null,
    name: status.name || null,
    type: status.type || null,
    semanticType: semanticProjectStatus(status)
  }));
}

export function resolveProjectStatus(manifest = {}, { intent } = {}) {
  const requested = lower(intent);
  const ref = manifestEvidenceRef(manifest, null);
  const statuses = listProjectStatuses(manifest);
  const candidates = statuses.filter(status => status.semanticType === requested);
  if (candidates.length === 1) {
    return {
      ok: true,
      kind: 'projectStatus',
      intent: requested,
      id: candidates[0].id,
      object: candidates[0],
      evidenceRef: ref,
      chain: [{ source: 'workspaceProjectStatuses', evidenceRef: ref }, { source: 'semanticType', intent: requested, matched: candidates[0].semanticType }]
    };
  }
  return {
    ok: false,
    kind: 'projectStatus',
    intent: requested,
    code: candidates.length ? 'project_status_ambiguous' : 'project_status_absent',
    blocking: candidates.length > 1,
    message: candidates.length
      ? `Project status ${requested} matched multiple candidates.`
      : `Project status ${requested} is not available in workspace manifest.`,
    evidenceRef: ref,
    candidates
  };
}

export function resolveProjectStatusById(manifest = {}, statusId = '') {
  const id = cleanString(statusId);
  const ref = manifestEvidenceRef(manifest, null);
  const statuses = listProjectStatuses(manifest);
  const candidate = statuses.find(status => status.id === id);
  if (candidate) {
    return {
      ok: true,
      kind: 'projectStatus',
      intent: candidate.semanticType,
      id: candidate.id,
      object: candidate,
      evidenceRef: ref,
      chain: [{ source: 'workspaceProjectStatuses', evidenceRef: ref }, { source: 'statusId', id }]
    };
  }
  return {
    ok: false,
    kind: 'projectStatus',
    intent: null,
    code: 'project_status_unknown_id',
    blocking: true,
    message: `Project statusId is not present in workspace manifest: ${id}`,
    evidenceRef: ref,
    candidates: statuses
  };
}

function compactProject(project) {
  return {
    id: project.id || null,
    name: project.name || null,
    url: project.url || null,
    state: project.state || null,
    active: project.active ?? (!project.archivedAt && !['canceled', 'completed'].includes(project.state))
  };
}

export function linearProjectUrlParts(locator) {
  const input = cleanString(locator);
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment);
    const projectIndex = segments.findIndex(segment => segment.toLowerCase() === 'project');
    const workspaceSlug = projectIndex > 0 ? segments[0] : null;
    const slug = projectIndex >= 0 ? segments[projectIndex + 1] || null : null;
    const isLinearProjectUrl = Boolean(host === 'linear.app' && workspaceSlug && slug);
    const normalizedProjectUrl = isLinearProjectUrl
      ? `https://${host}/${workspaceSlug}/project/${slug}`.toLowerCase()
      : null;
    return { isLinearProjectUrl, workspaceSlug, slug, normalizedProjectUrl };
  } catch {
    return { isLinearProjectUrl: false, workspaceSlug: null, slug: null, normalizedProjectUrl: null };
  }
}

function normalizedSlug(value) {
  const input = cleanString(value);
  const parts = linearProjectUrlParts(input);
  const slug = parts.slug || input.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0] || '';
  return normalizedText(decodeSegment(slug));
}

function projectUrl(project) {
  return linearProjectUrlParts(project.url).normalizedProjectUrl;
}

function projectSlug(project) {
  return linearProjectUrlParts(project.url).slug;
}

export function matchWorkspaceProjects(locator, projects = []) {
  const input = cleanString(locator);
  const normalized = lower(input);
  const urlParts = linearProjectUrlParts(input);
  const slug = normalizedSlug(urlParts.slug || input);
  const name = normalizedText(input);
  const matchers = [
    { source: 'workspace_id', test: project => UUID_RE.test(normalized) && lower(project.id) === normalized },
    { source: 'workspace_url', test: project => Boolean(urlParts.normalizedProjectUrl && projectUrl(project) === urlParts.normalizedProjectUrl) },
    { source: 'workspace_slug', test: project => Boolean(slug && normalizedSlug(projectSlug(project)) === slug) },
    { source: 'workspace_exact_name', test: project => lower(project.name) === normalized },
    { source: 'workspace_normalized_name', test: project => Boolean(name && normalizedText(project.name) === name) }
  ];
  const matchesByProjectId = new Map();
  for (const matcher of matchers) {
    for (const project of projects) {
      if (!matcher.test(project)) continue;
      const key = project.id || JSON.stringify(project);
      const existing = matchesByProjectId.get(key);
      if (existing) existing.sources.push(matcher.source);
      else matchesByProjectId.set(key, { source: matcher.source, sources: [matcher.source], project });
    }
  }
  return [...matchesByProjectId.values()];
}

function projectSelectionGap(locator, matches, projects, directError = null) {
  const hasMatches = matches.length > 0;
  const candidates = (hasMatches ? matches : projects.map(project => ({ project })))
    .slice(0, 8)
    .map(match => ({
      ...compactProject(match.project),
      matchSource: match.source || null,
      matchSources: match.sources || []
    }));
  return {
    ok: false,
    type: 'project_selection_gap',
    locator: cleanString(locator),
    message: hasMatches
      ? `Linear Project locator matched multiple workspace projects: ${cleanString(locator)}`
      : `Linear Project could not be resolved from locator: ${cleanString(locator)}`,
    directError,
    candidates
  };
}

function asProject(value) {
  const project = value?.data?.project || value?.project || value;
  return project?.id ? project : null;
}

export async function resolveLinearProjectId(locator, options) {
  const input = cleanString(locator);
  let directError = null;
  if (!input) return projectSelectionGap(input, [], [], null);

  if (typeof options?.directLookup === 'function') {
    try {
      const directProject = asProject(await options.directLookup(input));
      if (directProject) {
        return { ok: true, source: 'direct', locator: input, resolvedProjectId: directProject.id, project: directProject };
      }
    } catch (err) {
      directError = err instanceof Error ? err.message : String(err);
    }
  }

  const projects = typeof options?.workspaceProjects === 'function' ? await options.workspaceProjects() : [];
  const matches = matchWorkspaceProjects(input, projects || []);
  if (matches.length === 1) {
    const match = matches[0];
    return {
      ok: true,
      source: match.source,
      matchSources: match.sources || [match.source],
      locator: input,
      resolvedProjectId: match.project.id,
      project: match.project,
      directError
    };
  }
  return projectSelectionGap(input, matches, projects || [], directError);
}
