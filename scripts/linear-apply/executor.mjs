// @ts-check
import { applyGenericRefs, resolveRef } from './normalize.mjs';
import { isCreate, normalizeType, typeToKind } from './schema.mjs';
import { errorMessage } from './audit.mjs';

function targetIdForUpdate(op, refs) {
  const type = normalizeType(op.type);
  const input = applyGenericRefs({ ...(op.input || {}) }, refs);
  if (type === 'project.update') return resolveRef(refs, input.projectId || input.id || input.projectRef || op.targetId, 'project update id');
  if (type === 'issue.update') return resolveRef(refs, input.issueId || input.id || input.issueRef || op.targetId, 'issue update id');
  throw new Error(`No target id resolver for ${type}`);
}

export async function readback(linear, kind, id) {
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
    if (/not found|Could not find|Entity not found/i.test(errorMessage(err))) return null;
    throw err;
  }
}

export async function exactIssueLookup(linear, identifierOrId) {
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
    if (/not found|could not find|entity not found/i.test(errorMessage(err))) return null;
    throw err;
  }
}

export async function mutate(linear, op, input, refs) {
  const type = normalizeType(op.type);
  const kind = typeToKind(type);
  if (!kind) throw new Error(`Unsupported operation type: ${type}`);

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
