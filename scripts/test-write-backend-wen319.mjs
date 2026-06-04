#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildMcpToolArguments,
  connectLinearMcp,
  enrichCompiledOperationsForMcp,
  loadLinearMcpServerConfig,
  mcpSmoke,
  operationToMcpTool,
  resolveWriteBackend
} from './linear-apply/mcp-adapter.mjs';
import { compileOperations } from './linear-apply/normalize.mjs';

{
  assert.equal(resolveWriteBackend({ LINEAR_WRITE_BACKEND: 'mcp' }), 'mcp');
  assert.equal(resolveWriteBackend({}), 'mcp');
  assert.throws(() => resolveWriteBackend({ LINEAR_WRITE_BACKEND: 'sdk' }), /Unsupported LINEAR_WRITE_BACKEND/);
  assert.throws(() => resolveWriteBackend({ LINEAR_WRITE_BACKEND: 'graphql' }), /Unsupported LINEAR_WRITE_BACKEND/);
}

{
  const config = loadLinearMcpServerConfig();
  assert.equal(config.transport, 'streamable-http');
  assert.match(config.url, /mcp\.linear\.app/);
  const raw = fs.readFileSync('config/mcp.servers.json', 'utf8');
  assert.match(raw, /"linear"/);
}

{
  assert.equal(operationToMcpTool('projectUpdate.create'), 'save_status_update');
  assert.equal(operationToMcpTool('issue.create'), 'save_issue');
  assert.equal(operationToMcpTool('issue.update'), 'save_issue');
  const args = buildMcpToolArguments('projectUpdate.create', {
    projectId: 'project-1',
    body: 'Status body',
    health: 'onTrack'
  });
  assert.equal(args.project, 'project-1');
  assert.equal(args.type, 'project');
  assert.equal(args.body, 'Status body');
  assert.equal(args.health, 'onTrack');
}

{
  const workspaceManifest = {
    teams: [{ id: 'team-1', key: 'WEN', name: 'Wen Team' }],
    labels: [{ id: 'label-1', name: 'Backend', teamKey: 'WEN', group: 'Area' }],
    projectMilestones: [{ id: 'milestone-1', name: 'M1', projectId: 'project-1' }]
  };
  const plan = {
    idempotencyKey: 'mcp-compile-test',
    targetProjectId: 'project-1',
    operations: [{
      key: 'project-update',
      type: 'projectUpdate.create',
      input: { projectId: 'project-1', body: 'Dry-run body', health: 'onTrack' }
    }]
  };
  const linear = { client: { rawRequest: async () => ({ data: {} }) } };
  const compiled = await compileOperations(linear, plan, {
    workspaceManifestInfo: { manifest: workspaceManifest, manifestPath: null },
    exactIssueLookup: async () => null
  });
  const mcpCompiled = enrichCompiledOperationsForMcp(compiled);
  assert.equal(mcpCompiled[0].mcpTool, 'save_status_update');
  assert.ok(mcpCompiled[0].mcpArguments?.project);
}

{
  const session = await connectLinearMcp({}, { mock: true });
  const smoke = await mcpSmoke(session);
  assert.equal(smoke.ok, true);
  assert.equal(smoke.backend, 'mcp');
  assert.equal(smoke.viewer.name, 'Mock Viewer');
  await session.close();
}

{
  assert.doesNotMatch(fs.readFileSync('scripts/linear-apply/command.mjs', 'utf8'), /executor\.mjs/);
  assert.doesNotMatch(fs.readFileSync('scripts/linear-apply/command.mjs', 'utf8'), /mutate\(/);
  assert.match(fs.readFileSync('scripts/test-linear-cli-apply-architecture.mjs', 'utf8'), /mcp-adapter\.mjs/);
  assert.equal(fs.existsSync('scripts/linear-apply/executor.mjs'), false);
  assert.equal(fs.existsSync('scripts/linear-object-resolver.mjs'), false);
  assert.equal(fs.existsSync('scripts/linear-project-resolver.mjs'), false);
  assert.equal(fs.existsSync('scripts/linear-issue-resolver.mjs'), false);
  assert.equal(fs.existsSync('scripts/linear-project-status-resolver.mjs'), false);
}

if (process.env.LINEAR_API_KEY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-backend-wen320-live-'));
  const planPath = path.join(dir, 'write-plan.json');
  fs.writeFileSync(planPath, JSON.stringify({
    idempotencyKey: 'cli-mcp-dry-run-test',
    dryRun: true,
    confirmedByUser: false,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [{
      key: 'project-update',
      type: 'projectUpdate.create',
      input: {
        projectId: 'project-1',
        body: 'CLI dry-run MCP body',
        health: 'onTrack'
      }
    }]
  }, null, 2));

  const mcpResult = spawnSync(process.execPath, ['scripts/linear-cli.mjs', 'apply', planPath, '--dry-run', '--not-confirmed'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, LINEAR_WRITE_BACKEND: 'mcp', LINEAR_WRITE_MODE: 'dry-run' }
  });
  assert.equal(mcpResult.status, 0, mcpResult.stderr || mcpResult.stdout);
  const mcpOutput = JSON.parse(mcpResult.stdout);
  assert.equal(mcpOutput.writeBackend, 'mcp');
  assert.ok(mcpOutput.operations[0].mcpTool, 'mcp dry-run should expose MCP tool mapping');
  fs.rmSync(dir, { recursive: true, force: true });

  const smoke = spawnSync(process.execPath, ['scripts/linear-cli.mjs', 'smoke'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, LINEAR_WRITE_BACKEND: 'mcp' }
  });
  assert.equal(smoke.status, 0, smoke.stderr || smoke.stdout);
  const smokePayload = JSON.parse(smoke.stdout);
  assert.equal(smokePayload.ok, true);
  assert.equal(smokePayload.writeBackend, 'mcp');
}

console.log('write backend wen320 tests passed');
