// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORTED_WRITE_BACKENDS = new Set(['mcp']);
export const DEFAULT_LINEAR_MCP_URL = 'https://mcp.linear.app/mcp';

const OPERATION_TO_MCP_TOOL = {
  'projectUpdate.create': 'save_status_update',
  'project.update.create': 'save_status_update',
  'issue.create': 'save_issue',
  'issue.update': 'save_issue',
  'issueRelation.create': 'save_issue',
  'issue.relation.create': 'save_issue'
};

const READBACK_TO_MCP_TOOL = {
  project: 'get_project',
  projectMilestone: 'get_milestone',
  issue: 'get_issue',
  issueRelation: 'get_issue',
  projectRelation: 'get_project',
  projectUpdate: 'get_status_updates',
  comment: 'list_comments'
};

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

export function resolveWriteBackend(env = process.env) {
  const value = String(env.LINEAR_WRITE_BACKEND || 'mcp').trim().toLowerCase();
  if (!SUPPORTED_WRITE_BACKENDS.has(value)) {
    throw new Error(`Unsupported LINEAR_WRITE_BACKEND=${value}. Supported: ${[...SUPPORTED_WRITE_BACKENDS].join(', ')}`);
  }
  return value;
}

export function loadLinearMcpServerConfig() {
  const configPath = path.join(repoRoot(), 'config', 'mcp.servers.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const linear = raw?.mcp?.servers?.linear;
  if (!linear) throw new Error('config/mcp.servers.json is missing mcp.servers.linear');
  return linear;
}

export function linearMcpUrl(config = loadLinearMcpServerConfig()) {
  return clean(config.url) || DEFAULT_LINEAR_MCP_URL;
}

export function operationToMcpTool(type) {
  return OPERATION_TO_MCP_TOOL[String(type || '').trim()] || null;
}

export function readbackToMcpTool(kind) {
  return READBACK_TO_MCP_TOOL[String(kind || '').trim()] || null;
}

export function buildMcpToolArguments(type, input = {}) {
  const normalizedType = String(type || '').trim();
  if (normalizedType === 'projectUpdate.create' || normalizedType === 'project.update.create') {
    const args = {
      type: 'project',
      project: clean(input.projectId),
      body: clean(input.body)
    };
    if (clean(input.health)) args.health = clean(input.health);
    if (clean(input.id)) args.id = clean(input.id);
    return args;
  }
  if (normalizedType === 'issue.create' || normalizedType === 'issue.update') {
    const args = {
      title: clean(input.title),
      description: clean(input.description),
      team: clean(input.teamId) || clean(input.teamKey),
      project: clean(input.projectId),
      state: clean(input.stateId) || clean(input.stateName),
      priority: input.priority,
      assignee: clean(input.assigneeId),
      labels: input.labelIds || input.labelNames || input.labels,
      milestone: clean(input.projectMilestoneId) || clean(input.milestoneName)
    };
    const issueId = clean(input.issueId) || clean(input.id);
    if (issueId) args.id = issueId;
    return Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  }
  if (normalizedType === 'issueRelation.create' || normalizedType === 'issue.relation.create') {
    return {
      id: clean(input.issueId),
      relatedTo: [clean(input.relatedIssueId)],
      relationType: clean(input.type)
    };
  }
  throw new Error(`Unsupported MCP mapping for operation type: ${type}`);
}

export function enrichCompiledOperationsForMcp(compiled) {
  return compiled.map(operation => ({
    ...operation,
    mcpTool: operationToMcpTool(operation.type),
    mcpArguments: buildMcpToolArguments(operation.type, operation.input)
  }));
}

function stableJson(value) {
  return JSON.stringify(value);
}

export function compareDryRunParity(sdkCompiled, mcpCompiled) {
  const findings = [];
  if (sdkCompiled.length !== mcpCompiled.length) {
    findings.push(`operation count mismatch: sdk=${sdkCompiled.length}, mcp=${mcpCompiled.length}`);
  }
  const limit = Math.min(sdkCompiled.length, mcpCompiled.length);
  for (let index = 0; index < limit; index += 1) {
    const sdkOp = sdkCompiled[index];
    const mcpOp = mcpCompiled[index];
    if (sdkOp.type !== mcpOp.type) findings.push(`operations[${index}] type mismatch: sdk=${sdkOp.type}, mcp=${mcpOp.type}`);
    if (stableJson(sdkOp.input || {}) !== stableJson(mcpOp.input || {})) {
      findings.push(`operations[${index}] input mismatch between sdk and mcp compile paths`);
    }
    if (!mcpOp.mcpTool) findings.push(`operations[${index}] missing MCP tool mapping for ${sdkOp.type}`);
    if (!mcpOp.mcpArguments || !Object.keys(mcpOp.mcpArguments).length) {
      findings.push(`operations[${index}] missing MCP arguments for ${sdkOp.type}`);
    }
  }
  return { ok: findings.length === 0, findings };
}

function parseToolText(result) {
  const text = result?.content?.find(item => item.type === 'text')?.text;
  if (!text) return result;
  if (/^MCP error|^Entity not found/i.test(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return /^[\[{]/.test(text.trim()) ? null : text;
  }
}

function readbackEntity(value) {
  if (!value || typeof value === 'string') return null;
  if (value.id && (value.body !== undefined || value.title !== undefined || value.identifier)) return value;
  if (Array.isArray(value.statusUpdates)) return value.statusUpdates[0] || null;
  return value.id ? value : null;
}

export async function connectLinearMcp(env = process.env, options = {}) {
  if (options.mock === true) {
    return createMockMcpSession();
  }

  const apiKey = clean(env.LINEAR_API_KEY);
  if (!apiKey) throw new Error('LINEAR_API_KEY missing. Copy .env.example to .env and set token for MCP backend.');

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const config = loadLinearMcpServerConfig();
  const url = linearMcpUrl(config);
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`
      }
    }
  });
  const client = new Client({ name: 'linear-pi-project-admin-agent', version: '0.1.0' });
  await client.connect(transport);
  return {
    backend: 'mcp',
    url,
    client,
    async callTool(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      return parseToolText(result);
    },
    async close() {
      await transport.close?.();
      await client.close?.();
    }
  };
}

export async function mcpSmoke(session) {
  const user = await session.callTool('get_user', { query: 'me' });
  return {
    ok: true,
    sourceType: 'linear_mcp',
    backend: 'mcp',
    url: session.url,
    viewer: {
      id: user?.id || user?.user?.id || null,
      name: user?.name || user?.user?.name || null,
      email: user?.email || user?.user?.email || null
    }
  };
}

export async function exactIssueLookupMcp(session, identifierOrId) {
  const issue = await session.callTool('get_issue', { id: identifierOrId });
  if (!issue) return null;
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url
  };
}

function mutationEntity(payload) {
  if (!payload || typeof payload === 'string') return null;
  if (payload.issue?.id) return payload.issue;
  if (payload.statusUpdate?.id) return payload.statusUpdate;
  if (payload.projectUpdate?.id) return payload.projectUpdate;
  if (payload.id && (payload.body !== undefined || payload.title !== undefined || payload.identifier)) {
    return payload;
  }
  return null;
}

export async function readbackMcp(session, kind, id) {
  const tool = readbackToMcpTool(kind);
  if (!tool) throw new Error(`Unsupported MCP readback kind: ${kind}`);
  if (tool === 'get_status_updates') {
    const payload = await session.callTool(tool, { type: 'project', id, limit: 1 });
    return readbackEntity(payload);
  }
  if (tool === 'list_comments') {
    return session.callTool(tool, { issueId: id, limit: 1 });
  }
  if (tool === 'get_milestone') {
    return session.callTool(tool, { query: id });
  }
  return session.callTool(tool, { id });
}

export async function mutateMcp(session, op, input, refs) {
  const type = String(op.type || '').trim();
  const tool = operationToMcpTool(type);
  if (!tool) throw new Error(`Unsupported MCP mutation type: ${type}`);
  const args = buildMcpToolArguments(type, input);
  const payload = await session.callTool(tool, args);
  const entity = mutationEntity(payload);
  if (!entity?.id && type.endsWith('.update')) {
    throw new Error(`${type} MCP mutation did not return an entity id`);
  }
  if (entity?.id) {
    const readbackKind = type.includes('issue') ? 'issue' : 'projectUpdate';
    const existing = readbackEntity(await readbackMcp(session, readbackKind, entity.id));
    if (existing?.id) return { success: true, skipped: false, entity: existing };
  }
  return { success: true, skipped: false, entity: entity || { id: /** @type {any} */ (args).id || null } };
}

function createMockMcpSession() {
  return {
    backend: 'mcp',
    url: DEFAULT_LINEAR_MCP_URL,
    mock: true,
    async callTool(name, args = {}) {
      if (name === 'get_user') {
        return { id: 'viewer-1', name: 'Mock Viewer', email: 'mock@example.com' };
      }
      if (name === 'get_issue') {
        return { id: args.id, identifier: 'WEN-1', title: 'Mock Issue', url: 'https://linear.app/mock/issue/WEN-1' };
      }
      if (name === 'save_issue') {
        return { issue: { id: args.id || 'issue-1', identifier: 'WEN-1', title: args.title, url: 'https://linear.app/mock/issue/WEN-1' } };
      }
      if (name === 'save_status_update') {
        return { statusUpdate: { id: 'update-1', body: args.body, health: args.health || 'onTrack', project: { id: args.project } } };
      }
      return { ok: true, tool: name, args };
    },
    async close() {}
  };
}
