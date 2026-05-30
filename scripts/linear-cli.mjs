#!/usr/bin/env node
import { LinearClient } from '@linear/sdk';
import { json, now, ensureDir, hash, writeJson } from './utils.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isIssueIdentifierOrUuid } from './retrieval-utils.mjs';
import { resolveLinearProjectId } from './linear-project-resolver.mjs';
import { resolveOperationInput } from './linear-object-resolver.mjs';
import { resolveIssueRelationIdentifiers } from './linear-issue-resolver.mjs';
import { listProjectStatuses, resolveProjectStatus, resolveProjectStatusById } from './linear-project-status-resolver.mjs';
import { normalizeProjectDescriptionFields } from './project-field-normalizer.mjs';
import { detectHostConfirmationCapabilities, resolveApplyMode } from './write-plan-execution.mjs';

const apiKey = process.env.LINEAR_API_KEY;
const cmd = process.argv[2] || 'smoke';

const SUPPORTED_WRITE_MODES = new Set(['dry-run', 'confirmed-only']);
const CREATE_TYPES = new Set([
  'project.create',
  'projectMilestone.create',
  'milestone.create',
  'project.milestone.create',
  'issue.create',
  'issueRelation.create',
  'issue.relation.create',
  'projectRelation.create',
  'project.relation.create',
  'projectUpdate.create',
  'project.update.create',
  'comment.create'
]);

const PROJECT_CREATE_FIELDS = [
  'id', 'name', 'icon', 'color', 'statusId', 'description', 'content', 'teamIds',
  'convertedFromIssueId', 'lastAppliedTemplateId', 'templateId', 'useDefaultTemplate',
  'leadId', 'memberIds', 'startDate', 'startDateResolution', 'targetDate',
  'targetDateResolution', 'sortOrder', 'prioritySortOrder', 'priority', 'labelIds'
];
const PROJECT_UPDATE_FIELDS = [
  'statusId', 'name', 'description', 'content', 'convertedFromIssueId', 'lastAppliedTemplateId',
  'icon', 'color', 'teamIds', 'projectUpdateRemindersPausedUntilAt',
  'updateReminderFrequencyInWeeks', 'updateReminderFrequency', 'frequencyResolution',
  'updateRemindersDay', 'updateRemindersHour', 'leadId', 'memberIds', 'startDate',
  'startDateResolution', 'targetDate', 'targetDateResolution', 'completedAt', 'canceledAt',
  'slackNewIssue', 'slackIssueComments', 'slackIssueStatuses', 'sortOrder',
  'prioritySortOrder', 'trashed', 'priority', 'labelIds'
];
const MILESTONE_CREATE_FIELDS = ['id', 'name', 'description', 'descriptionData', 'targetDate', 'projectId', 'sortOrder'];
const ISSUE_CREATE_FIELDS = [
  'id', 'title', 'description', 'descriptionData', 'assigneeId', 'delegateId', 'parentId',
  'priority', 'estimate', 'subscriberIds', 'labelIds', 'teamId', 'projectId',
  'projectMilestoneId', 'lastAppliedTemplateId', 'stateId', 'referenceCommentId',
  'sourceCommentId', 'sourcePullRequestCommentId', 'sortOrder', 'prioritySortOrder',
  'subIssueSortOrder', 'dueDate', 'createAsUser', 'displayIconUrl',
  'preserveSortOrderOnCreate', 'createdAt', 'templateId', 'completedAt', 'useDefaultTemplate',
  'releaseIds', 'inheritsSharedAccess'
];
const ISSUE_UPDATE_FIELDS = [
  'title', 'description', 'descriptionData', 'assigneeId', 'delegateId', 'parentId',
  'priority', 'estimate', 'subscriberIds', 'labelIds', 'addedLabelIds', 'removedLabelIds',
  'releaseIds', 'addedReleaseIds', 'removedReleaseIds', 'teamId', 'projectId',
  'projectMilestoneId', 'lastAppliedTemplateId', 'stateId', 'sortOrder', 'prioritySortOrder',
  'subIssueSortOrder', 'dueDate', 'inheritsSharedAccess', 'trashed', 'snoozedUntilAt', 'snoozedById'
];
const ISSUE_RELATION_CREATE_FIELDS = ['id', 'type', 'issueId', 'relatedIssueId'];
const PROJECT_RELATION_CREATE_FIELDS = [
  'id', 'type', 'projectId', 'projectMilestoneId', 'anchorType',
  'relatedProjectId', 'relatedProjectMilestoneId', 'relatedAnchorType'
];
const PROJECT_UPDATE_CREATE_FIELDS = ['id', 'body', 'bodyData', 'projectId', 'health', 'isDiffHidden'];
const COMMENT_CREATE_FIELDS = [
  'id', 'body', 'bodyData', 'issueId', 'projectUpdateId', 'initiativeUpdateId', 'postId',
  'documentContentId', 'projectId', 'initiativeId', 'parentId', 'createAsUser',
  'displayIconUrl', 'createdAt', 'doNotSubscribeToIssue', 'createOnSyncedSlackThread',
  'quotedText', 'subscriberIds'
];

function client() {
  if (!apiKey) throw new Error('LINEAR_API_KEY missing. Copy .env.example to .env and set token.');
  return new LinearClient({ apiKey });
}

function normalizeType(type) {
  return String(type || '').trim();
}

function typeToKind(type) {
  const t = normalizeType(type);
  if (t === 'project.create' || t === 'project.update') return 'project';
  if (t === 'projectMilestone.create' || t === 'milestone.create' || t === 'project.milestone.create') return 'projectMilestone';
  if (t === 'issue.create' || t === 'issue.update') return 'issue';
  if (t === 'issueRelation.create' || t === 'issue.relation.create') return 'issueRelation';
  if (t === 'projectRelation.create' || t === 'project.relation.create') return 'projectRelation';
  if (t === 'projectUpdate.create' || t === 'project.update.create') return 'projectUpdate';
  if (t === 'comment.create') return 'comment';
  return null;
}

function isCreate(type) {
  return CREATE_TYPES.has(normalizeType(type));
}

function stableUuid(seed) {
  // Deterministic UUID with RFC-4122 version-4/variant bits. Linear validates create IDs as UUIDs.
  const bytes = Buffer.from(crypto.createHash('sha256').update(String(seed)).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function opRefKey(op, index) {
  return op.key || op.ref || op.operationKey || (typeof op.id === 'string' && !/^[0-9a-f-]{36}$/i.test(op.id) ? op.id : null) || `op${index + 1}`;
}

function redacted(value) {
  if (Array.isArray(value)) return value.map(redacted);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/token|secret|password|apiKey|privateKey|authorization/i.test(k)) out[k] = '[REDACTED]';
    else out[k] = redacted(v);
  }
  return out;
}

function pick(input, fields) {
  const allowed = new Set(fields);
  return Object.fromEntries(Object.entries(input).filter(([k, v]) => allowed.has(k) && v !== undefined));
}

function stripMeta(input) {
  const meta = new Set([
    'teamKey', 'labels', 'labelNames', 'addedLabels', 'addedLabelNames', 'removedLabels', 'removedLabelNames',
    'labelGroup', 'labelGroups', 'workflowStateName', 'workflowStateType', 'stateName', 'stateType',
    'milestoneName', 'projectMilestoneName',
    'projectRef', 'projectMilestoneRef', 'milestoneRef', 'issueRef', 'relatedIssueRef',
    'issueIdentifier', 'relatedIssueIdentifier',
    'projectUpdateRef', 'relatedProjectRef', 'relatedProjectMilestoneRef', 'relatedMilestoneRef',
    'projectStatusIntent'
  ]);
  return Object.fromEntries(Object.entries(input).filter(([k]) => !meta.has(k)));
}

function resolveValue(value, refs) {
  if (typeof value === 'string' && value.startsWith('$')) {
    const key = value.slice(1);
    if (!refs[key]) throw new Error(`Unknown reference ${value}`);
    return refs[key].id;
  }
  return value;
}

function resolveRef(refs, value, label) {
  const resolved = resolveValue(value, refs);
  if (typeof resolved !== 'string' || !resolved) throw new Error(`${label} is required`);
  if (refs[resolved]) return refs[resolved].id;
  return resolved;
}

function applyGenericRefs(input, refs) {
  const out = { ...input };
  for (const [k, v] of Object.entries(out)) out[k] = resolveValue(v, refs);
  if (out.projectRef) out.projectId = resolveRef(refs, out.projectRef, 'projectRef');
  if (out.projectMilestoneRef) out.projectMilestoneId = resolveRef(refs, out.projectMilestoneRef, 'projectMilestoneRef');
  if (out.milestoneRef) out.projectMilestoneId = resolveRef(refs, out.milestoneRef, 'milestoneRef');
  if (out.issueRef) out.issueId = resolveRef(refs, out.issueRef, 'issueRef');
  if (out.relatedIssueRef) out.relatedIssueId = resolveRef(refs, out.relatedIssueRef, 'relatedIssueRef');
  if (out.projectUpdateRef) out.projectUpdateId = resolveRef(refs, out.projectUpdateRef, 'projectUpdateRef');
  if (out.relatedProjectRef) out.relatedProjectId = resolveRef(refs, out.relatedProjectRef, 'relatedProjectRef');
  if (out.relatedProjectMilestoneRef) out.relatedProjectMilestoneId = resolveRef(refs, out.relatedProjectMilestoneRef, 'relatedProjectMilestoneRef');
  if (out.relatedMilestoneRef) out.relatedProjectMilestoneId = resolveRef(refs, out.relatedMilestoneRef, 'relatedMilestoneRef');
  return out;
}

async function getTeamId(linear, teamKeyOrId) {
  if (teamKeyOrId && /^[0-9a-f-]{36}$/i.test(teamKeyOrId)) return teamKeyOrId;
  const key = teamKeyOrId || process.env.LINEAR_DEFAULT_TEAM_KEY;
  const envId = process.env.LINEAR_DEFAULT_TEAM_ID;
  if (!teamKeyOrId && envId) return envId;
  const teams = await linear.teams();
  const team = teams.nodes.find(t => t.key === key || t.name === key || t.id === key);
  if (!team) throw new Error(`Linear team not found for key/id: ${key || '(empty)'}`);
  return team.id;
}

async function labelIds(linear, input) {
  const explicit = [...(input.labelIds || [])];
  const names = [
    ...(input.labels || []),
    ...(input.labelNames || [])
  ].filter(Boolean);
  if (!names.length) return explicit;
  const labels = await linear.issueLabels();
  const byName = new Map(labels.nodes.map(l => [l.name, l.id]));
  const missing = names.filter(name => !byName.has(name));
  if (missing.length) throw new Error(`Linear label(s) not found: ${missing.join(', ')}`);
  return [...new Set([...explicit, ...names.map(name => byName.get(name))])];
}

async function appendLabelIds(linear, input, fieldName, labelFields) {
  const names = labelFields.flatMap(f => input[f] || []).filter(Boolean);
  if (!names.length) return input[fieldName] || [];
  const labels = await linear.issueLabels();
  const byName = new Map(labels.nodes.map(l => [l.name, l.id]));
  const missing = names.filter(name => !byName.has(name));
  if (missing.length) throw new Error(`Linear label(s) not found: ${missing.join(', ')}`);
  return [...new Set([...(input[fieldName] || []), ...names.map(name => byName.get(name))])];
}

function resolveLinearObjectNames(input, metadata, pathPrefix, operationType) {
  if (!metadata?.workspaceManifest) return input;
  const resolution = resolveOperationInput(input, {
    manifest: metadata.workspaceManifest,
    manifestPath: metadata.workspaceManifestPath,
    pathPrefix,
    operationType
  });
  metadata.objectResolutions.push(...resolution.resolutions);
  metadata.objectFindings.push(...resolution.findings);
  if (!resolution.ok) {
    const messages = resolution.findings.map(finding => `${finding.path}: ${finding.message}`).join('; ');
    throw new Error(`Linear object resolution blocked write plan: ${messages}`);
  }
  return resolution.input;
}

function resolveProjectStatusInput(input, metadata, pathPrefix) {
  if (!metadata?.workspaceManifest) return input;
  if (input.projectStatusIntent) {
    const result = resolveProjectStatus(metadata.workspaceManifest, { intent: input.projectStatusIntent });
    metadata.objectResolutions.push({ ...result, path: `${pathPrefix}.projectStatusIntent` });
    if (!result.ok) throw new Error(`Linear Project status resolution blocked write plan: ${result.message}`);
    return { ...input, statusId: result.id };
  }
  if (input.statusId) {
    const result = resolveProjectStatusById(metadata.workspaceManifest, input.statusId);
    metadata.objectResolutions.push({ ...result, path: `${pathPrefix}.statusId` });
    if (!result.ok) throw new Error(`Linear Project status resolution blocked write plan: ${result.message}`);
  }
  return input;
}

async function resolveIssueRelationTargets(input, metadata, pathPrefix) {
  if (!metadata?.issueExactLookup) return input;
  const resolution = await resolveIssueRelationIdentifiers(input, {
    exactLookup: metadata.issueExactLookup,
    pathPrefix
  });
  metadata.objectResolutions.push(...resolution.resolutions);
  metadata.objectFindings.push(...resolution.findings);
  if (!resolution.ok) {
    const messages = resolution.findings.map(finding => `${finding.path}: ${finding.message}`).join('; ');
    throw new Error(`Linear issue relation resolution blocked write plan: ${messages}`);
  }
  return resolution.input;
}

function normalizeHealth(health) {
  if (!health) return health;
  const map = { on_track: 'onTrack', ontrack: 'onTrack', at_risk: 'atRisk', atrisk: 'atRisk', off_track: 'offTrack', offtrack: 'offTrack' };
  return map[String(health).replace(/[-\s]/g, '_').toLowerCase()] || health;
}

async function normalizeInput(linear, op, refs, index, metadata = null) {
  const type = normalizeType(op.type);
  const kind = typeToKind(type);
  if (!kind) throw new Error(`Unsupported operation type: ${op.type}`);

  let input = applyGenericRefs({ ...(op.input || {}) }, refs);
  const refKey = opRefKey(op, index);

  if (isCreate(type) && !input.id) input.id = stableUuid(`${op.planIdempotencyKey}:${type}:${refKey}`);

  if (type === 'project.create') {
    const normalized = normalizeProjectDescriptionFields(input);
    input = normalized.input;
    if (metadata) metadata.fieldTransforms.push(...normalized.fieldTransforms);
    if (!input.teamIds?.length) input.teamIds = [await getTeamId(linear, input.teamId || input.teamKey)];
    input = resolveLinearObjectNames(input, metadata, `$.operations[${index}].input`, type);
    const ids = metadata?.workspaceManifest ? (input.labelIds || []) : await labelIds(linear, input);
    if (ids.length) input.labelIds = ids;
    return pick(stripMeta(input), PROJECT_CREATE_FIELDS);
  }

  if (type === 'project.update') {
    const normalized = normalizeProjectDescriptionFields(input);
    input = normalized.input;
    if (metadata) metadata.fieldTransforms.push(...normalized.fieldTransforms);
    input = resolveLinearObjectNames(input, metadata, `$.operations[${index}].input`, type);
    input = resolveProjectStatusInput(input, metadata, `$.operations[${index}].input`);
    const ids = metadata?.workspaceManifest ? (input.labelIds || []) : await labelIds(linear, input);
    if (ids.length) input.labelIds = ids;
    return pick(stripMeta(input), PROJECT_UPDATE_FIELDS);
  }

  if (type === 'projectMilestone.create' || type === 'milestone.create' || type === 'project.milestone.create') {
    return pick(stripMeta(input), MILESTONE_CREATE_FIELDS);
  }

  if (type === 'issue.create') {
    if (!input.teamId) input.teamId = await getTeamId(linear, input.teamKey);
    input = resolveLinearObjectNames(input, metadata, `$.operations[${index}].input`, type);
    const ids = metadata?.workspaceManifest ? (input.labelIds || []) : await labelIds(linear, input);
    if (ids.length) input.labelIds = ids;
    return pick(stripMeta(input), ISSUE_CREATE_FIELDS);
  }

  if (type === 'issue.update') {
    if (!input.teamId && input.teamKey) input.teamId = await getTeamId(linear, input.teamKey);
    input = resolveLinearObjectNames(input, metadata, `$.operations[${index}].input`, type);
    input.addedLabelIds = metadata?.workspaceManifest ? (input.addedLabelIds || []) : await appendLabelIds(linear, input, 'addedLabelIds', ['labels', 'labelNames', 'addedLabels', 'addedLabelNames']);
    input.removedLabelIds = metadata?.workspaceManifest ? (input.removedLabelIds || []) : await appendLabelIds(linear, input, 'removedLabelIds', ['removedLabels', 'removedLabelNames']);
    return pick(stripMeta(input), ISSUE_UPDATE_FIELDS);
  }

  if (type === 'issueRelation.create' || type === 'issue.relation.create') {
    input = await resolveIssueRelationTargets(input, metadata, `$.operations[${index}].input`);
    if (input.type === 'blocked_by' || input.type === 'blockedBy') {
      input.type = 'blocks';
      [input.issueId, input.relatedIssueId] = [input.relatedIssueId, input.issueId];
    }
    return pick(stripMeta(input), ISSUE_RELATION_CREATE_FIELDS);
  }

  if (type === 'projectRelation.create' || type === 'project.relation.create') {
    return pick(stripMeta(input), PROJECT_RELATION_CREATE_FIELDS);
  }

  if (type === 'projectUpdate.create' || type === 'project.update.create') {
    input.health = normalizeHealth(input.health);
    return pick(stripMeta(input), PROJECT_UPDATE_CREATE_FIELDS);
  }

  if (type === 'comment.create') {
    return pick(stripMeta(input), COMMENT_CREATE_FIELDS);
  }

  throw new Error(`Unsupported operation type: ${op.type}`);
}

function targetIdForUpdate(op, refs) {
  const type = normalizeType(op.type);
  const input = applyGenericRefs({ ...(op.input || {}) }, refs);
  if (type === 'project.update') return resolveRef(refs, input.projectId || input.id || input.projectRef || op.targetId, 'project update id');
  if (type === 'issue.update') return resolveRef(refs, input.issueId || input.id || input.issueRef || op.targetId, 'issue update id');
  throw new Error(`No target id resolver for ${type}`);
}

async function readback(linear, kind, id) {
  const queries = {
    project: [`query($id:String!){ project(id:$id){ id name url createdAt updatedAt description targetDate health teams{nodes{id key name}} labels{nodes{id name}} } }`, 'project'],
    projectMilestone: [`query($id:String!){ projectMilestone(id:$id){ id name description targetDate createdAt updatedAt project{ id name url } } }`, 'projectMilestone'],
    issue: [`query($id:String!){ issue(id:$id){ id identifier title url description priority createdAt updatedAt state{ id name type } labels{nodes{id name}} project{ id name url } projectMilestone{ id name } } }`, 'issue'],
    issueRelation: [`query($id:String!){ issueRelation(id:$id){ id type createdAt updatedAt issue{ id identifier title url } relatedIssue{ id identifier title url } } }`, 'issueRelation'],
    projectRelation: [`query($id:String!){ projectRelation(id:$id){ id type anchorType relatedAnchorType createdAt updatedAt project{ id name url } relatedProject{ id name url } projectMilestone{ id name } relatedProjectMilestone{ id name } } }`, 'projectRelation'],
    projectUpdate: [`query($id:String!){ projectUpdate(id:$id){ id body health url createdAt updatedAt project{ id name url } } }`, 'projectUpdate'],
    comment: [`query($id:String!){ comment(id:$id){ id body url createdAt updatedAt issue{ id identifier title url } project{ id name url } projectUpdate{ id url } } }`, 'comment']
  };
  const [query, key] = queries[kind] || [];
  if (!query) throw new Error(`Unsupported readback kind: ${kind}`);
  try {
    const res = await linear.client.rawRequest(query, { id });
    return res.data?.[key] || null;
  } catch (err) {
    if (/not found|Could not find|Entity not found/i.test(err.message || '')) return null;
    throw err;
  }
}

async function exactIssueLookup(linear, identifierOrId) {
  try {
    const res = await linear.client.rawRequest(`
      query IssueExactForResolver($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          url
        }
      }`, { id: identifierOrId });
    return res.data?.issue || null;
  } catch (err) {
    if (/not found|could not find|entity not found/i.test(err.message || '')) return null;
    throw err;
  }
}

async function mutate(linear, op, input, refs) {
  const type = normalizeType(op.type);
  const kind = typeToKind(type);

  if (isCreate(type) && input.id) {
    const existing = await readback(linear, kind, input.id);
    if (existing) return { success: true, skipped: true, reason: 'idempotent-existing-object', entity: existing };
  }

  const mutations = {
    'project.create': [`mutation($input: ProjectCreateInput!){ projectCreate(input:$input){ success project{ id name url createdAt updatedAt } } }`, 'projectCreate', 'project'],
    'project.update': [`mutation($id:String!, $input: ProjectUpdateInput!){ projectUpdate(id:$id, input:$input){ success project{ id name url createdAt updatedAt } } }`, 'projectUpdate', 'project'],
    'projectMilestone.create': [`mutation($input: ProjectMilestoneCreateInput!){ projectMilestoneCreate(input:$input){ success projectMilestone{ id name targetDate createdAt updatedAt project{ id name url } } } }`, 'projectMilestoneCreate', 'projectMilestone'],
    'milestone.create': [`mutation($input: ProjectMilestoneCreateInput!){ projectMilestoneCreate(input:$input){ success projectMilestone{ id name targetDate createdAt updatedAt project{ id name url } } } }`, 'projectMilestoneCreate', 'projectMilestone'],
    'project.milestone.create': [`mutation($input: ProjectMilestoneCreateInput!){ projectMilestoneCreate(input:$input){ success projectMilestone{ id name targetDate createdAt updatedAt project{ id name url } } } }`, 'projectMilestoneCreate', 'projectMilestone'],
    'issue.create': [`mutation($input: IssueCreateInput!){ issueCreate(input:$input){ success issue{ id identifier title url createdAt updatedAt } } }`, 'issueCreate', 'issue'],
    'issue.update': [`mutation($id:String!, $input: IssueUpdateInput!){ issueUpdate(id:$id, input:$input){ success issue{ id identifier title url createdAt updatedAt } } }`, 'issueUpdate', 'issue'],
    'issueRelation.create': [`mutation($input: IssueRelationCreateInput!){ issueRelationCreate(input:$input){ success issueRelation{ id type createdAt updatedAt issue{ id identifier title url } relatedIssue{ id identifier title url } } } }`, 'issueRelationCreate', 'issueRelation'],
    'issue.relation.create': [`mutation($input: IssueRelationCreateInput!){ issueRelationCreate(input:$input){ success issueRelation{ id type createdAt updatedAt issue{ id identifier title url } relatedIssue{ id identifier title url } } } }`, 'issueRelationCreate', 'issueRelation'],
    'projectRelation.create': [`mutation($input: ProjectRelationCreateInput!){ projectRelationCreate(input:$input){ success projectRelation{ id type createdAt updatedAt project{ id name url } relatedProject{ id name url } } } }`, 'projectRelationCreate', 'projectRelation'],
    'project.relation.create': [`mutation($input: ProjectRelationCreateInput!){ projectRelationCreate(input:$input){ success projectRelation{ id type createdAt updatedAt project{ id name url } relatedProject{ id name url } } } }`, 'projectRelationCreate', 'projectRelation'],
    'projectUpdate.create': [`mutation($input: ProjectUpdateCreateInput!){ projectUpdateCreate(input:$input){ success projectUpdate{ id body health url createdAt updatedAt project{ id name url } } } }`, 'projectUpdateCreate', 'projectUpdate'],
    'project.update.create': [`mutation($input: ProjectUpdateCreateInput!){ projectUpdateCreate(input:$input){ success projectUpdate{ id body health url createdAt updatedAt project{ id name url } } } }`, 'projectUpdateCreate', 'projectUpdate'],
    'comment.create': [`mutation($input: CommentCreateInput!){ commentCreate(input:$input){ success comment{ id body url createdAt updatedAt issue{ id identifier title url } project{ id name url } projectUpdate{ id url } } } }`, 'commentCreate', 'comment']
  };

  const [query, payloadKey, entityKey] = mutations[type] || [];
  if (!query) throw new Error(`Unsupported operation type: ${type}`);
  const variables = type.endsWith('.update') && (type === 'project.update' || type === 'issue.update')
    ? { id: targetIdForUpdate(op, refs), input }
    : { input };
  const res = await linear.client.rawRequest(query, variables);
  const payload = res.data?.[payloadKey];
  if (!payload?.success) throw new Error(`${type} returned success=false`);
  return { success: true, skipped: false, entity: payload[entityKey] };
}

function appendAudit(entry) {
  const auditPath = process.env.AUDIT_LOG_PATH || 'state/audit.jsonl';
  ensureDir(path.dirname(auditPath));
  fs.appendFileSync(auditPath, JSON.stringify(redacted({ ts: now(), ...entry })) + '\n');
}

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function validateWritePlan(plan, dryRun) {
  if (!plan || typeof plan !== 'object') throw new Error('Write plan must be a JSON object.');
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) throw new Error('writePlan.operations must be a non-empty array.');
  for (const [index, op] of plan.operations.entries()) {
    if (!op?.type) throw new Error(`operations[${index}].type is required.`);
    if (!typeToKind(op.type)) throw new Error(`operations[${index}] unsupported type: ${op.type}`);
    if (/^issue\.(create|update)$/.test(normalizeType(op.type)) && op.input?.cycleId) {
      throw new Error(`operations[${index}].input.cycleId is not supported by this agent write schema.`);
    }
  }
  if (!dryRun) {
    if (!plan.idempotencyKey) throw new Error('idempotencyKey is required for non-dry-run apply.');
    if (plan.confirmedByUser !== true) throw new Error('confirmedByUser=true is required for non-dry-run apply.');
    if (!plan.confirmationText) throw new Error('confirmationText is required for non-dry-run apply.');
    if (plan.confirmationChannel === 'conversation_fallback') {
      const text = String(plan.confirmationText || '');
      for (const required of ['Fallback reason:', 'User approval:', 'Write plan:', 'Idempotency key:']) {
        if (!text.includes(required)) throw new Error(`conversation fallback confirmationText must include "${required}"`);
      }
    }
    if (plan.readbackRequired === false) throw new Error('readbackRequired=false is not allowed for non-dry-run apply.');
    if (plan.auditLogRequired === false) throw new Error('auditLogRequired=false is not allowed for non-dry-run apply.');
  }
}

async function compileOperations(linear, plan) {
  const refs = {};
  const compiled = [];
  const planIdempotencyKey = plan.idempotencyKey || `dry-run-${hash(JSON.stringify(plan)).slice(0, 12)}`;
  const workspaceManifest = await cachedWorkspaceObjectManifest(linear, plan);

  for (const [index, rawOp] of plan.operations.entries()) {
    const op = { ...rawOp, planIdempotencyKey };
    const type = normalizeType(op.type);
    const kind = typeToKind(type);
    const refKey = opRefKey(op, index);
    const metadata = {
      fieldTransforms: [],
      objectResolutions: [],
      objectFindings: [],
      workspaceManifest: workspaceManifest.manifest,
      workspaceManifestPath: workspaceManifest.manifestPath,
      issueExactLookup: identifierOrId => exactIssueLookup(linear, identifierOrId)
    };
    const input = await normalizeInput(linear, op, refs, index, metadata);

    if (isCreate(type) && input.id) refs[refKey] = { id: input.id, kind, pending: true };

    compiled.push({
      index,
      key: refKey,
      type,
      level: op.level || null,
      kind,
      input,
      reason: op.reason || null,
      fieldTransforms: metadata.fieldTransforms,
      resolutions: metadata.objectResolutions,
      evidenceRef: workspaceManifest.manifestPath
    });
  }
  return compiled;
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

async function apply(planPath) {
  if (!planPath) throw new Error('apply requires a write plan path.');
  const mode = process.env.LINEAR_WRITE_MODE || 'dry-run';
  if (!SUPPORTED_WRITE_MODES.has(mode)) throw new Error(`Unsupported LINEAR_WRITE_MODE=${mode}. Supported: ${[...SUPPORTED_WRITE_MODES].join(', ')}`);

  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const cliDryRun = process.argv.includes('--dry-run');
  const cliConfirmed = process.argv.includes('--confirmed');
  const confirmationText = argValue('--confirmation-text', '');
  const confirmationChannelOverride = argValue('--confirmation-channel', '');
  const allow = process.env.ALLOW_LINEAR_WRITES === 'true';
  const hostCapabilities = detectHostConfirmationCapabilities(process.env, process.cwd());
  if (confirmationChannelOverride === 'ask_user') hostCapabilities.askUserAvailable = true;
  if (confirmationChannelOverride === 'conversation_fallback') {
    hostCapabilities.askUserAvailable = false;
    hostCapabilities.conversationFallbackAllowed = true;
  }
  if (confirmationChannelOverride === 'unavailable') hostCapabilities.conversationFallbackAllowed = false;
  const applyMode = resolveApplyMode({ mode, cliDryRun, cliConfirmed, allow, plan, confirmationText, writePlanPath: planPath, hostCapabilities });
  const dryRun = applyMode.dryRun;
  const effectivePlan = applyMode.effectivePlan;

  validateWritePlan(effectivePlan, dryRun);
  const linear = client();
  const compiled = await compileOperations(linear, effectivePlan);

  if (dryRun) {
    json({
      ok: true,
      dryRun: true,
      mode,
      reason: applyMode.reason,
      confirmationChannel: applyMode.reason.confirmationChannel,
      operations: compiled
    });
    return;
  }

  const refs = {};
  const results = [];
  const workspaceManifest = await cachedWorkspaceObjectManifest(linear, effectivePlan);
  const confirmation = {
    channel: effectivePlan.confirmationChannel || applyMode.reason.confirmationChannel.channel,
    fallbackReason: effectivePlan.confirmationFallbackReason || null,
    confirmationText: effectivePlan.confirmationText || null,
    writePlanPath: planPath,
    idempotencyKey: effectivePlan.idempotencyKey
  };
  appendAudit({ type: 'linear_apply_start', idempotencyKey: effectivePlan.idempotencyKey, operationCount: effectivePlan.operations.length, dryRun: false, confirmation });

  try {
    for (const [index, rawOp] of effectivePlan.operations.entries()) {
      const op = { ...rawOp, planIdempotencyKey: effectivePlan.idempotencyKey };
      const type = normalizeType(op.type);
      const kind = typeToKind(type);
      const key = opRefKey(op, index);
      const metadata = {
        fieldTransforms: [],
        objectResolutions: [],
        objectFindings: [],
        workspaceManifest: workspaceManifest.manifest,
        workspaceManifestPath: workspaceManifest.manifestPath,
        issueExactLookup: identifierOrId => exactIssueLookup(linear, identifierOrId)
      };
      const input = await normalizeInput(linear, op, refs, index, metadata);
      if (isCreate(type) && input.id) refs[key] = { id: input.id, kind, pending: true };

      const mutationResult = await mutate(linear, op, input, refs);
      const entity = mutationResult.entity;
      if (entity?.id) refs[key] = { id: entity.id, kind, data: entity };
      const readbackEntity = entity?.id ? await readback(linear, kind, entity.id) : null;
      if (!readbackEntity && effectivePlan.readbackRequired !== false) throw new Error(`Readback failed for ${type} (${entity?.id || 'no-id'})`);

      const result = { index, key, type, kind, success: true, skipped: mutationResult.skipped, entity, readback: readbackEntity, fieldTransforms: metadata.fieldTransforms, resolutions: metadata.objectResolutions };
      results.push(result);
      appendAudit({ type: 'linear_apply_operation', idempotencyKey: effectivePlan.idempotencyKey, operation: { index, key, mutationType: type }, result });
    }
    appendAudit({ type: 'linear_apply_end', idempotencyKey: effectivePlan.idempotencyKey, success: true, resultCount: results.length, confirmation });
    json({ ok: true, dryRun: false, mode, idempotencyKey: effectivePlan.idempotencyKey, reason: applyMode.reason, confirmation, results });
  } catch (err) {
    appendAudit({ type: 'linear_apply_end', idempotencyKey: effectivePlan.idempotencyKey, success: false, error: err.message, partialResults: results, confirmation });
    throw err;
  }
}

try {
  if (cmd === 'smoke') await smoke();
  else if (cmd === 'workspace') await workspace();
  else if (cmd === 'project') await project(process.argv[3]);
  else if (cmd === 'project-statuses') await projectStatuses();
  else if (cmd === 'issue') await issue(process.argv[3]);
  else if (cmd === 'issues') await issues();
  else if (cmd === 'apply') await apply(process.argv[3]);
  else json({ ok: false, error: `unknown command ${cmd}` });
} catch (err) {
  json({ ok: false, error: err.message, stack: process.env.DEBUG ? err.stack : undefined });
  process.exit(1);
}
