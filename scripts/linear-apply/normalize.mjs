// @ts-check
import crypto from 'node:crypto';
import { hash } from '../utils.mjs';
import {
  resolveIssueRelationIdentifiers,
  resolveOperationInput,
  resolveProjectStatus,
  resolveProjectStatusById
} from '../linear-mcp-match.mjs';
import { normalizeProjectDescriptionFields } from '../project-field-normalizer.mjs';
import { isCreate, normalizeType, typeToKind } from './schema.mjs';

export function targetIdForUpdate(op, refs) {
  const type = normalizeType(op.type);
  const input = applyGenericRefs({ ...(op.input || {}) }, refs);
  if (type === 'project.update') return resolveRef(refs, input.projectId || input.id || input.projectRef || op.targetId, 'project update id');
  if (type === 'issue.update') return resolveRef(refs, input.issueId || input.id || input.issueRef || op.targetId, 'issue update id');
  throw new Error(`No target id resolver for ${type}`);
}

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
  'issueId', 'id', 'title', 'description', 'descriptionData', 'assigneeId', 'delegateId', 'parentId',
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

/**
 * @param {unknown} seed
 */
function stableUuid(seed) {
  const bytes = Buffer.from(crypto.createHash('sha256').update(String(seed)).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * @param {Record<string, unknown>} op
 * @param {number} index
 */
export function opRefKey(op, index) {
  return op.key || op.ref || op.operationKey || (typeof op.id === 'string' && !/^[0-9a-f-]{36}$/i.test(op.id) ? op.id : null) || `op${index + 1}`;
}

/**
 * @param {Record<string, unknown>} input
 * @param {string[]} fields
 */
function pick(input, fields) {
  const allowed = new Set(fields);
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.has(key) && value !== undefined));
}

/**
 * @param {Record<string, unknown>} input
 */
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
  return Object.fromEntries(Object.entries(input).filter(([key]) => !meta.has(key)));
}

/**
 * @param {unknown} value
 * @param {Record<string, { id: string }>} refs
 */
function resolveValue(value, refs) {
  if (typeof value === 'string' && value.startsWith('$')) {
    const key = value.slice(1);
    if (!refs[key]) throw new Error(`Unknown reference ${value}`);
    return refs[key].id;
  }
  return value;
}

/**
 * @param {Record<string, { id: string }>} refs
 * @param {unknown} value
 * @param {string} label
 */
export function resolveRef(refs, value, label) {
  const resolved = resolveValue(value, refs);
  if (typeof resolved !== 'string' || !resolved) throw new Error(`${label} is required`);
  if (refs[resolved]) return refs[resolved].id;
  return resolved;
}

/**
 * @param {Record<string, unknown>} input
 * @param {Record<string, { id: string }>} refs
 */
export function applyGenericRefs(input, refs) {
  const out = { ...input };
  for (const [key, value] of Object.entries(out)) out[key] = resolveValue(value, refs);
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

function teamIdFromManifest(manifest, teamKeyOrId) {
  if (teamKeyOrId && /^[0-9a-f-]{36}$/i.test(String(teamKeyOrId))) return String(teamKeyOrId);
  const key = teamKeyOrId || process.env.LINEAR_DEFAULT_TEAM_KEY;
  const envId = process.env.LINEAR_DEFAULT_TEAM_ID;
  if (!teamKeyOrId && envId) return envId;
  const teams = Array.isArray(manifest?.teams) ? manifest.teams : [];
  const team = teams.find(item => item.key === key || item.name === key || item.id === key);
  if (!team) throw new Error(`Linear team not found for key/id: ${key || '(empty)'}`);
  return team.id;
}

function resolveLinearObjectNames(input, metadata, pathPrefix, operationType) {
  if (!metadata?.workspaceManifest) return input;
  /** @type {any} */
  const options = {
    manifest: metadata.workspaceManifest,
    manifestPath: metadata.workspaceManifestPath,
    pathPrefix,
    operationType
  };
  const resolution = resolveOperationInput(input, options);
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
    const result = resolveProjectStatus(metadata.workspaceManifest, { intent: String(input.projectStatusIntent) });
    metadata.objectResolutions.push({ ...result, path: `${pathPrefix}.projectStatusIntent` });
    if (!result.ok) throw new Error(`Linear Project status resolution blocked write plan: ${result.message}`);
    return { ...input, statusId: result.id };
  }
  if (input.statusId) {
    const result = resolveProjectStatusById(metadata.workspaceManifest, String(input.statusId));
    metadata.objectResolutions.push({ ...result, path: `${pathPrefix}.statusId` });
    if (!result.ok) throw new Error(`Linear Project status resolution blocked write plan: ${result.message}`);
  }
  return input;
}

async function resolveIssueRelationTargets(input, metadata, pathPrefix) {
  if (!metadata?.issueExactLookup) return input;
  /** @type {any} */
  const options = {
    exactLookup: metadata.issueExactLookup,
    pathPrefix
  };
  const resolution = await resolveIssueRelationIdentifiers(input, options);
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

export async function normalizeInput(op, refs, index, metadata = null) {
  const type = normalizeType(op.type);
  const kind = typeToKind(type);
  if (!kind) throw new Error(`Unsupported operation type: ${op.type}`);

  let input = applyGenericRefs({ ...(op.input || {}) }, refs);
  const refKey = opRefKey(op, index);
  if (isCreate(type) && !input.id && type !== 'projectUpdate.create' && type !== 'project.update.create') {
    input.id = stableUuid(`${op.planIdempotencyKey}:${type}:${refKey}`);
  }

  if (type === 'project.create') {
    const normalized = normalizeProjectDescriptionFields(input);
    input = normalized.input;
    if (metadata) metadata.fieldTransforms.push(...normalized.fieldTransforms);
    if (!Array.isArray(input.teamIds) || input.teamIds.length === 0) {
      input.teamIds = [teamIdFromManifest(metadata?.workspaceManifest, input.teamId || input.teamKey)];
    }
    input = resolveLinearObjectNames(input, metadata, `$.operations[${index}].input`, type);
    return pick(stripMeta(input), PROJECT_CREATE_FIELDS);
  }

  if (type === 'project.update') {
    const normalized = normalizeProjectDescriptionFields(input);
    input = normalized.input;
    if (metadata) metadata.fieldTransforms.push(...normalized.fieldTransforms);
    input = resolveLinearObjectNames(input, metadata, `$.operations[${index}].input`, type);
    input = resolveProjectStatusInput(input, metadata, `$.operations[${index}].input`);
    return pick(stripMeta(input), PROJECT_UPDATE_FIELDS);
  }

  if (type === 'projectMilestone.create' || type === 'milestone.create' || type === 'project.milestone.create') return pick(stripMeta(input), MILESTONE_CREATE_FIELDS);
  if (type === 'issue.create') {
    if (!input.teamId) input.teamId = teamIdFromManifest(metadata?.workspaceManifest, input.teamKey);
    input = resolveLinearObjectNames(input, metadata, `$.operations[${index}].input`, type);
    return pick(stripMeta(input), ISSUE_CREATE_FIELDS);
  }
  if (type === 'issue.update') {
    if (!input.teamId && input.teamKey) input.teamId = teamIdFromManifest(metadata?.workspaceManifest, input.teamKey);
    input = resolveLinearObjectNames(input, metadata, `$.operations[${index}].input`, type);
    input.addedLabelIds = input.addedLabelIds || [];
    input.removedLabelIds = input.removedLabelIds || [];
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
  if (type === 'projectRelation.create' || type === 'project.relation.create') return pick(stripMeta(input), PROJECT_RELATION_CREATE_FIELDS);
  if (type === 'projectUpdate.create' || type === 'project.update.create') {
    input.health = normalizeHealth(input.health);
    return pick(stripMeta(input), PROJECT_UPDATE_CREATE_FIELDS);
  }
  if (type === 'comment.create') return pick(stripMeta(input), COMMENT_CREATE_FIELDS);
  throw new Error(`Unsupported operation type: ${op.type}`);
}

export async function compileOperations(linear, plan, options) {
  /** @type {Record<string, { id: string, kind?: string, pending?: boolean }>} */
  const refs = {};
  const compiled = [];
  const planIdempotencyKey = plan.idempotencyKey || `dry-run-${hash(JSON.stringify(plan)).slice(0, 12)}`;
  const workspaceManifest = options.workspaceManifestInfo || await options.cachedWorkspaceObjectManifest(linear, plan);

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
      issueExactLookup: identifierOrId => options.exactIssueLookup(identifierOrId)
    };
    const input = await normalizeInput(op, refs, index, metadata);
    if (isCreate(type) && typeof input.id === 'string') refs[String(refKey)] = { id: input.id, kind: kind || undefined, pending: true };
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
  /** @type {any} */ (compiled).workspaceManifestInfo = workspaceManifest;
  return compiled;
}
