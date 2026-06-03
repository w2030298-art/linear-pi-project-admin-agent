#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildMcpToolArguments,
  compareDryRunParity,
  connectLinearMcp,
  enrichCompiledOperationsForMcp,
  loadLinearMcpServerConfig,
  mcpSmoke,
  operationToMcpTool,
  resolveWriteBackend
} from './linear-apply/mcp-adapter.mjs';
import { compileOperations } from './linear-apply/normalize.mjs';

{
  assert.equal(resolveWriteBackend({ LINEAR_WRITE_BACKEND: 'sdk' }), 'sdk');
  assert.equal(resolveWriteBackend({ LINEAR_WRITE_BACKEND: 'mcp' }), 'mcp');
  assert.equal(resolveWriteBackend({}), 'sdk');
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
  assert.equal(args.body, 'Status body');
  assert.equal(args.health, 'onTrack');
}

{
  const sdkCompiled = [{
    index: 0,
    key: 'project-update',
    type: 'projectUpdate.create',
    input: { projectId: 'project-1', body: 'Status body', health: 'onTrack' }
  }, {
    index: 1,
    key: 'issue-create',
    type: 'issue.create',
    input: {
      title: 'New issue',
      description: 'Acceptance criteria:\n- Works',
      teamId: 'team-1',
      projectId: 'project-1',
      projectMilestoneId: 'milestone-1',
      labelIds: ['label-1']
    }
  }];
  const mcpCompiled = enrichCompiledOperationsForMcp(sdkCompiled);
  const parity = compareDryRunParity(sdkCompiled, mcpCompiled);
  assert.equal(parity.ok, true, JSON.stringify(parity.findings, null, 2));
  assert.equal(mcpCompiled[0].mcpTool, 'save_status_update');
  assert.equal(mcpCompiled[1].mcpTool, 'save_issue');
}

{
  const workspaceManifest = {
    teams: [{ id: 'team-1', key: 'WEN', name: 'Wen Team' }],
    labels: [{ id: 'label-1', name: 'Backend', teamKey: 'WEN', group: 'Area' }],
    projectMilestones: [{ id: 'milestone-1', name: 'M1', projectId: 'project-1' }]
  };
  const plan = {
    idempotencyKey: 'parity-test-plan',
    targetProjectId: 'project-1',
    operations: [{
      key: 'project-update',
      type: 'projectUpdate.create',
      input: { projectId: 'project-1', body: 'Dry-run parity body', health: 'onTrack' }
    }]
  };
  const linear = {
    client: {
      rawRequest: async () => ({ data: {} })
    }
  };
  const compiled = await compileOperations(linear, plan, {
    workspaceManifestInfo: { manifest: workspaceManifest, manifestPath: null },
    exactIssueLookup: async () => null
  });
  const mcpCompiled = enrichCompiledOperationsForMcp(compiled);
  const parity = compareDryRunParity(compiled, mcpCompiled);
  assert.equal(parity.ok, true, JSON.stringify(parity.findings, null, 2));
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
  assert.match(fs.readFileSync('scripts/linear-apply/command.mjs', 'utf8'), /resolveWriteBackend/);
  assert.match(fs.readFileSync('scripts/test-linear-cli-apply-architecture.mjs', 'utf8'), /mcp-adapter\.mjs/);
}

if (process.env.LINEAR_API_KEY) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-backend-wen319-live-'));
  const planPath = path.join(dir, 'write-plan.json');
  fs.writeFileSync(planPath, JSON.stringify({
    idempotencyKey: 'cli-parity-test',
    dryRun: true,
    confirmedByUser: false,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [{
      key: 'project-update',
      type: 'projectUpdate.create',
      input: {
        projectId: 'project-1',
        body: 'CLI dry-run parity body',
        health: 'onTrack'
      }
    }]
  }, null, 2));

  const sdkResult = spawnSync(process.execPath, ['scripts/linear-cli.mjs', 'apply', planPath, '--dry-run', '--not-confirmed'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, LINEAR_WRITE_BACKEND: 'sdk', LINEAR_WRITE_MODE: 'dry-run' }
  });
  assert.equal(sdkResult.status, 0, sdkResult.stderr || sdkResult.stdout);

  const mcpResult = spawnSync(process.execPath, ['scripts/linear-cli.mjs', 'apply', planPath, '--dry-run', '--not-confirmed'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, LINEAR_WRITE_BACKEND: 'mcp', LINEAR_WRITE_MODE: 'dry-run' }
  });
  assert.equal(mcpResult.status, 0, mcpResult.stderr || mcpResult.stdout);

  const sdkOutput = JSON.parse(sdkResult.stdout);
  const mcpOutput = JSON.parse(mcpResult.stdout);
  assert.equal(sdkOutput.writeBackend, 'sdk');
  assert.equal(mcpOutput.writeBackend, 'mcp');
  const parity = compareDryRunParity(sdkOutput.operations, mcpOutput.operations);
  assert.equal(parity.ok, true, JSON.stringify(parity.findings, null, 2));
  assert.ok(mcpOutput.operations[0].mcpTool, 'mcp dry-run should expose MCP tool mapping');
  fs.rmSync(dir, { recursive: true, force: true });

  const sdkSmoke = spawnSync(process.execPath, ['scripts/linear-cli.mjs', 'smoke'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, LINEAR_WRITE_BACKEND: 'sdk' }
  });
  assert.equal(sdkSmoke.status, 0, sdkSmoke.stderr || sdkSmoke.stdout);
  const sdkPayload = JSON.parse(sdkSmoke.stdout);
  assert.equal(sdkPayload.ok, true);
  assert.equal(sdkPayload.writeBackend, 'sdk');
}

console.log('write backend wen319 tests passed');
