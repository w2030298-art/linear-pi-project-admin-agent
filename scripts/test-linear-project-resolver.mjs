#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  linearProjectUrlParts,
  resolveLinearProjectId
} from './linear-project-resolver.mjs';

const paper2 = {
  id: 'b7d892ab-8aa3-467d-bb6f-809208486376',
  name: 'paper2｜RL-MEC Benchmark 交付与复核',
  url: 'https://linear.app/wentaoxu-personal-workplace/project/paper2rl-mec-benchmark-交付与复核-9966ca53bd81',
  state: 'started',
  active: true
};

const admin = {
  id: 'c642b249-cdda-4e85-b7f4-604776cb8cbd',
  name: 'linear-pi-project-admin-agent｜Linear 项目管理员 Agent 运行时',
  url: 'https://linear.app/wentaoxu-personal-workplace/project/linear-pi-project-admin-agentlinear-项目管理员-agent-运行时-46b9b0fe3fc1',
  state: 'started',
  active: true
};

const alphaRuntime = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Alpha｜Runtime',
  url: 'https://linear.app/wentaoxu-personal-workplace/project/alpha-runtime-%E6%B5%8B%E8%AF%95-abc123',
  state: 'started',
  active: true
};

function resolver(overrides = {}) {
  const directCalls = [];
  const workspaceCalls = [];
  return {
    directCalls,
    workspaceCalls,
    resolve: input => resolveLinearProjectId(input, {
      directLookup: async locator => {
        directCalls.push(locator);
        if (overrides.directProject) return overrides.directProject;
        if (overrides.directError) throw new Error(overrides.directError);
        return null;
      },
      workspaceProjects: async () => {
        workspaceCalls.push(true);
        return overrides.projects || [paper2, admin];
      }
    })
  };
}

{
  const overviewUrl = `${paper2.url}/overview?tab=updates#top`;
  const parts = linearProjectUrlParts(overviewUrl);
  assert.equal(parts.isLinearProjectUrl, true);
  assert.equal(parts.slug, 'paper2rl-mec-benchmark-交付与复核-9966ca53bd81');
  assert.equal(parts.normalizedProjectUrl, paper2.url.toLowerCase());
}

{
  const r = resolver({ directError: 'Project not found' });
  const result = await r.resolve(`${paper2.url}/overview`);
  assert.equal(result.ok, true);
  assert.equal(result.project.id, paper2.id);
  assert.equal(result.resolvedProjectId, paper2.id);
  assert.equal(result.source, 'workspace_url');
  assert.deepEqual(r.directCalls, [`${paper2.url}/overview`]);
  assert.equal(r.workspaceCalls.length, 1);
}

{
  const r = resolver({ directProject: admin });
  const result = await r.resolve(admin.id);
  assert.equal(result.ok, true);
  assert.equal(result.project.id, admin.id);
  assert.equal(result.source, 'direct');
  assert.equal(r.workspaceCalls.length, 0);
}

{
  const r = resolver();
  const result = await r.resolve(paper2.name);
  assert.equal(result.ok, true);
  assert.equal(result.project.id, paper2.id);
  assert.equal(result.source, 'workspace_exact_name');
  assert.deepEqual(result.matchSources, ['workspace_exact_name', 'workspace_normalized_name']);
}

{
  const r = resolver({ projects: [alphaRuntime, paper2] });
  const result = await r.resolve(' alpha | runtime ');
  assert.equal(result.ok, true);
  assert.equal(result.project.id, alphaRuntime.id);
  assert.equal(result.source, 'workspace_normalized_name');
}

{
  const r = resolver({ projects: [alphaRuntime, paper2] });
  const result = await r.resolve('ALPHA-RUNTIME-%E6%B5%8B%E8%AF%95-ABC123');
  assert.equal(result.ok, true);
  assert.equal(result.project.id, alphaRuntime.id);
  assert.equal(result.source, 'workspace_slug');
}

{
  const duplicateA = { ...alphaRuntime, id: 'project-normalized-a', name: 'Foo｜Bar' };
  const duplicateB = { ...paper2, id: 'project-normalized-b', name: 'Foo | Bar' };
  const r = resolver({ projects: [duplicateA, duplicateB] });
  const result = await r.resolve('Foo  |  Bar');
  assert.equal(result.ok, false);
  assert.equal(result.type, 'project_selection_gap');
  assert.match(result.message, /matched multiple/i);
  assert.deepEqual(
    result.candidates.map(project => project.id),
    ['project-normalized-a', 'project-normalized-b']
  );
}

{
  const r = resolver({ projects: [alphaRuntime, paper2] });
  const result = await r.resolve('Alpha');
  assert.equal(result.ok, false);
  assert.equal(result.type, 'project_selection_gap');
}

{
  const slugMatch = { ...alphaRuntime, id: 'project-slug-match', name: 'Project With Slug' };
  const nameMatch = { ...paper2, id: 'project-name-match', name: 'alpha-runtime-测试-abc123' };
  const r = resolver({ projects: [slugMatch, nameMatch] });
  const result = await r.resolve('alpha-runtime-测试-abc123');
  assert.equal(result.ok, false);
  assert.equal(result.type, 'project_selection_gap');
  assert.match(result.message, /matched multiple/i);
  assert.deepEqual(result.candidates[0].matchSources, ['workspace_slug']);
  assert.deepEqual(result.candidates[1].matchSources, ['workspace_exact_name', 'workspace_normalized_name']);
  assert.deepEqual(
    result.candidates.map(project => project.id),
    ['project-slug-match', 'project-name-match']
  );
}

{
  const r = resolver({ projects: [paper2, admin] });
  const result = await r.resolve('https://linear.app/wentaoxu-personal-workplace/project/not-present/overview');
  assert.equal(result.ok, false);
  assert.equal(result.type, 'project_selection_gap');
  assert.match(result.message, /Linear Project could not be resolved/i);
  assert.deepEqual(
    result.candidates.map(project => project.id),
    [paper2.id, admin.id]
  );
}

{
  const duplicateA = { ...paper2, id: 'project-a', name: 'Duplicate Project' };
  const duplicateB = { ...admin, id: 'project-b', name: 'Duplicate Project' };
  const r = resolver({ projects: [duplicateA, duplicateB] });
  const result = await r.resolve('Duplicate Project');
  assert.equal(result.ok, false);
  assert.equal(result.type, 'project_selection_gap');
  assert.match(result.message, /matched multiple/i);
  assert.deepEqual(
    result.candidates.map(project => project.id),
    ['project-a', 'project-b']
  );
}

{
  const result = spawnSync(process.execPath, [
    'scripts/fact-pack.mjs',
    '--task',
    'explicit linear without repo',
    '--linear',
    paper2.id,
    '--no-linear',
    '--no-github',
    '--no-local'
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_DEFAULT_OWNER: 'wrong-owner',
      GITHUB_DEFAULT_REPO: 'wrong-repo',
      LOCAL_REPO_ROOTS: process.cwd()
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.factPack.scope.repo, undefined);
  assert.match(output.factPack.evidenceGaps.join('\n'), /No repoKey provided/i);
}

console.log('linear project resolver tests passed');
