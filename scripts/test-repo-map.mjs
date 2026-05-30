#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveRepoMapEntry } from './repo-map.mjs';

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-map-'));
const repoMapPath = path.join(fixtureDir, 'repo-map.yaml');
const localPath = path.join(fixtureDir, 'linear-bridge');
fs.mkdirSync(localPath);
fs.writeFileSync(repoMapPath, `
version: 1
repos:
  - repoKey: linear-pi-project-admin-agent
    github:
      owner: w2030298-art
      repo: linear-pi-project-admin-agent
      defaultBranch: master
    localPath: .
    linear:
      projectId: c642b249-cdda-4e85-b7f4-604776cb8cbd
      projectName: linear-pi-project-admin-agent｜Linear 项目管理员 Agent 运行时
      projectPrefix: linear-pi-project-admin-agent
    docs:
      - README.md
      - docs/
    evidenceWeight: high
  - repoKey: linear-bridge
    github:
      owner: w2030298-art
      repo: linear-bridge
      defaultBranch: main
    localPath: ${JSON.stringify(localPath)}
    linear:
      projectName: linear-bridge
      projectPrefix: linear-bridge
    docs:
      - README.md
    evidenceWeight: high
  - repoKey: incomplete
    github:
      owner: w2030298-art
`);

{
  const resolved = resolveRepoMapEntry('linear-bridge', {
    cwd: process.cwd(),
    repoMapPath,
    env: {
      GITHUB_DEFAULT_OWNER: 'wrong-owner',
      GITHUB_DEFAULT_REPO: 'linear-pi-project-admin-agent',
      LOCAL_REPO_ROOTS: 'wrong-local-path'
    }
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.github.owner, 'w2030298-art');
  assert.equal(resolved.github.repo, 'linear-bridge');
  assert.equal(resolved.github.defaultBranch, 'main');
  assert.equal(resolved.linear.projectName, 'linear-bridge');
  assert.equal(resolved.linear.projectPrefix, 'linear-bridge');
  assert.equal(resolved.local.root, path.resolve(localPath));
  assert.deepEqual(resolved.evidenceGaps, []);
  assert.match(resolved.conflicts.join('\n'), /GITHUB_DEFAULT_OWNER/);
  assert.match(resolved.conflicts.join('\n'), /LOCAL_REPO_ROOTS/);
}

{
  const result = spawnSync(process.execPath, ['scripts/fact-pack.mjs', '--task', 'repo map test', '--repo', 'linear-bridge', '--no-github', '--no-local', '--no-linear'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REPO_MAP_PATH: repoMapPath,
      GITHUB_DEFAULT_OWNER: 'wrong-owner',
      GITHUB_DEFAULT_REPO: 'linear-pi-project-admin-agent',
      LOCAL_REPO_ROOTS: 'wrong-local-path'
    },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.factPack.scope.repo.owner, 'w2030298-art');
  assert.equal(output.factPack.scope.repo.repo, 'linear-bridge');
  assert.equal(output.factPack.scope.repo.localPath, path.resolve(localPath));
  assert.equal(output.factPack.scope.repo.linearProjectName, 'linear-bridge');
  assert.equal(output.factPack.scope.linearProjectIdOrKey, 'linear-bridge');
  assert.deepEqual(output.factPack.openQuestions, []);
  assert.match(output.factPack.conflicts.join('\n'), /GITHUB_DEFAULT_OWNER/);
  assert.doesNotMatch(output.factPack.evidenceGaps.join('\n'), /GITHUB_DEFAULT_OWNER/);
}

{
  const result = spawnSync(process.execPath, ['scripts/fact-pack.mjs', '--task', 'single project task', '--no-github', '--no-local', '--no-linear'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REPO_MAP_PATH: repoMapPath,
      GITHUB_DEFAULT_OWNER: 'fallback-owner',
      GITHUB_DEFAULT_REPO: 'fallback-repo',
      LOCAL_REPO_ROOTS: localPath
    },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.equal(output.factPack.piAskUser.flow, 'project_select');
  assert.deepEqual(
    output.factPack.piAskUser.options.filter(option => !option.custom).map(option => option.projectId),
    ['linear-pi-project-admin-agent', 'linear-bridge']
  );
  assert.equal(output.factPack.piAskUser.options.at(-1).custom, true);
  assert.match(output.factPack.openQuestions.join('\n'), /local project ID/i);
  assert.doesNotMatch(output.factPack.openQuestions.join('\n'), /workspace/i);
  assert.equal(output.factPack.scope.repo, undefined);
  assert.doesNotMatch(JSON.stringify(output.factPack), /fallback-owner|fallback-repo/);
  assert.doesNotMatch(output.factPack.evidenceGaps.join('\n'), /No Linear project key\/id/);
}

{
  const missing = resolveRepoMapEntry('incomplete', {
    cwd: process.cwd(),
    repoMapPath,
    env: {
      GITHUB_DEFAULT_OWNER: 'fallback-owner',
      GITHUB_DEFAULT_REPO: 'fallback-repo',
      LOCAL_REPO_ROOTS: localPath
    }
  });
  assert.equal(missing.ok, true);
  assert.equal(missing.github.owner, 'w2030298-art');
  assert.equal(missing.github.repo, null);
  assert.match(missing.evidenceGaps.join('\n'), /github\.repo/);
  assert.match(missing.evidenceGaps.join('\n'), /localPath/);
  assert.match(missing.evidenceGaps.join('\n'), /Linear project/);
  assert.notEqual(missing.github.repo, 'fallback-repo');
}

{
  const current = resolveRepoMapEntry('linear-pi-project-admin-agent', {
    cwd: process.cwd(),
    repoMapPath: path.join(process.cwd(), 'config/repo-map.yaml'),
    env: {}
  });
  assert.equal(current.ok, true);
  assert.equal(current.github.owner, 'w2030298-art');
  assert.equal(current.github.repo, 'linear-pi-project-admin-agent');
  assert.equal(current.github.defaultBranch, 'master');
  assert.equal(current.linear.projectId, 'c642b249-cdda-4e85-b7f4-604776cb8cbd');
  assert.equal(current.linear.projectName, 'linear-pi-project-admin-agent｜Linear 项目管理员 Agent 运行时');
  assert.equal(current.linear.projectPrefix, 'linear-pi-project-admin-agent');
  assert.ok(current.local.root);
  assert.equal(current.evidenceGaps.length, 0);
}

console.log('repo map tests passed');
