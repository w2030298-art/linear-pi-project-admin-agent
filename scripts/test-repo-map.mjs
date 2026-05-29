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
  - key: linear-pi-project-admin-agent
    owner: w2030298-art
    repo: linear-pi-project-admin-agent
    defaultBranch: master
    localPath: .
    linearProjectPrefix: "linear-pi-project-admin-agent"
  - key: linear-bridge
    owner: w2030298-art
    repo: linear-bridge
    defaultBranch: main
    localPath: ${JSON.stringify(localPath)}
    linearProjectPrefix: "linear-bridge"
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
  assert.equal(resolved.local.root, path.resolve(localPath));
}

{
  const result = spawnSync(process.execPath, ['scripts/fact-pack.mjs', '--task', 'repo map test', '--repo', 'linear-bridge', '--no-github', '--no-local'], {
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
}

console.log('repo map tests passed');
