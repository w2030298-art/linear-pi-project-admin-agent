#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';
import { applyRepoMapDraft, checkRepoMapDrift } from './repo-map-drift.mjs';

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function entryByKey(repoMapPath, repoKey) {
  const parsed = YAML.parse(read(repoMapPath));
  return parsed.repos.find(entry => entry.repoKey === repoKey);
}

function writeRepoMap(file, entry) {
  fs.writeFileSync(file, YAML.stringify({ version: 1, repos: [entry] }));
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-map-drift-'));
const oldLocalPath = path.join(tempRoot, 'old-local');
const newLocalPath = path.join(tempRoot, 'new-local');
const stateDir = path.join(tempRoot, 'state');
fs.mkdirSync(oldLocalPath, { recursive: true });
fs.mkdirSync(newLocalPath, { recursive: true });

const repoMapPath = path.join(tempRoot, 'repo-map.yaml');
const repoKey = 'linear-pi-project-admin-agent';
writeRepoMap(repoMapPath, {
  repoKey,
  github: {
    owner: 'old-owner',
    repo: 'old-repo',
    defaultBranch: 'main'
  },
  linear: {
    projectId: 'old-project-id',
    projectName: 'Old Project',
    projectPrefix: 'old-prefix'
  },
  localPath: oldLocalPath,
  docs: ['README.md'],
  evidenceWeight: 'high'
});
const originalRepoMap = read(repoMapPath);

const drift = checkRepoMapDrift({
  cwd: tempRoot,
  repoKey,
  repoMapPath,
  stateDir,
  sourceFacts: {
    github: {
      owner: 'w2030298-art',
      repo: 'linear-pi-project-admin-agent',
      defaultBranch: 'master'
    },
    linear: {
      projectId: 'c642b249-cdda-4e85-b7f4-604776cb8cbd',
      projectName: 'linear-pi-project-admin-agent runtime',
      projectPrefix: 'linear-pi-project-admin-agent'
    },
    localPath: newLocalPath
  }
});

assert.equal(drift.ok, false);
assert.equal(drift.status, 'drift_detected');
assert.equal(drift.writesPerformed, false);
assert.equal(read(repoMapPath), originalRepoMap);
assert.ok(fs.existsSync(drift.draftPath));
assert.deepEqual(drift.drifts.map(item => item.field), [
  'github.owner',
  'github.repo',
  'github.defaultBranch',
  'linear.projectId',
  'linear.projectName',
  'linear.projectPrefix',
  'localPath'
]);
assert.match(drift.diff, /old-owner/);
assert.match(drift.diff, /w2030298-art/);
assert.equal(drift.draft.entry.github.owner, 'w2030298-art');
assert.equal(drift.draft.entry.localPath, path.resolve(newLocalPath));

const unconfirmed = applyRepoMapDraft({
  cwd: tempRoot,
  draftPath: drift.draftPath,
  repoMapPath,
  confirmed: false
});
assert.equal(unconfirmed.ok, false);
assert.equal(unconfirmed.status, 'confirmation_required');
assert.equal(unconfirmed.writesPerformed, false);
assert.equal(read(repoMapPath), originalRepoMap);
assert.match(unconfirmed.diff, /old-owner/);

const auditLogPath = path.join(stateDir, 'repo-map-audit.jsonl');
const applied = applyRepoMapDraft({
  cwd: tempRoot,
  draftPath: drift.draftPath,
  repoMapPath,
  auditLogPath,
  confirmed: true,
  confirmationText: 'User confirmed the repo-map draft for WEN-264 test.'
});
assert.equal(applied.ok, true);
assert.equal(applied.status, 'applied');
assert.equal(applied.writesPerformed, true);
assert.equal(applied.validation.ok, true);
assert.match(applied.diff, /old-owner/);
assert.match(applied.rollbackAdvice.join('\n'), /git diff --/);
assert.match(read(auditLogPath), /User confirmed the repo-map draft/);

const updated = entryByKey(repoMapPath, repoKey);
assert.equal(updated.github.owner, 'w2030298-art');
assert.equal(updated.github.repo, 'linear-pi-project-admin-agent');
assert.equal(updated.github.defaultBranch, 'master');
assert.equal(updated.linear.projectId, 'c642b249-cdda-4e85-b7f4-604776cb8cbd');
assert.equal(updated.linear.projectName, 'linear-pi-project-admin-agent runtime');
assert.equal(updated.linear.projectPrefix, 'linear-pi-project-admin-agent');
assert.equal(updated.localPath, path.resolve(newLocalPath));

const factPack = spawnSync(process.execPath, [
  'scripts/fact-pack.mjs',
  '--task',
  'repo-map drift apply test',
  '--repo',
  repoKey,
  '--no-github',
  '--no-local',
  '--no-linear'
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    REPO_MAP_PATH: repoMapPath
  },
  encoding: 'utf8'
});
assert.equal(factPack.status, 0, factPack.stderr || factPack.stdout);
const factPackOutput = JSON.parse(factPack.stdout);
assert.equal(factPackOutput.factPack.scope.repo.owner, 'w2030298-art');
assert.equal(factPackOutput.factPack.scope.repo.defaultBranch, 'master');
assert.equal(factPackOutput.factPack.scope.repo.linearProjectId, 'c642b249-cdda-4e85-b7f4-604776cb8cbd');
assert.equal(factPackOutput.factPack.scope.repo.localPath, path.resolve(newLocalPath));

const missingRepoMapPath = path.join(tempRoot, 'missing-repo-map.yaml');
writeRepoMap(missingRepoMapPath, {
  repoKey: 'missing-fields',
  github: {
    owner: 'w2030298-art'
  },
  linear: {
    projectId: 'project-id-1',
    projectName: 'Project One'
  },
  docs: ['README.md'],
  evidenceWeight: 'high'
});
const missing = checkRepoMapDrift({
  cwd: tempRoot,
  repoKey: 'missing-fields',
  repoMapPath: missingRepoMapPath,
  stateDir,
  sourceFacts: {
    linear: {
      projectId: 'project-id-1',
      projectName: 'Project One'
    }
  }
});
assert.equal(missing.ok, false);
assert.equal(missing.status, 'needs_interactive_input');
assert.equal(missing.writesPerformed, false);
assert.equal(missing.piAskUser.flow, 'repo_map');
assert.equal(missing.piAskUser.seed.linearProjectId, 'project-id-1');
assert.equal(missing.piAskUser.seed.linearProject, 'Project One');
assert.match(missing.openQuestions.join('\n'), /Project One/);
assert.match(missing.openQuestions.join('\n'), /GitHub URL/);
assert.equal(missing.draft.entry.github.repo, undefined);
assert.equal(missing.draft.entry.github.defaultBranch, undefined);
assert.equal(missing.draft.entry.localPath, undefined);

const cliRepoMapPath = path.join(tempRoot, 'cli-repo-map.yaml');
const cliStateDir = path.join(tempRoot, 'cli-state');
writeRepoMap(cliRepoMapPath, {
  repoKey: 'linear-bridge',
  github: {
    owner: 'old-owner',
    repo: 'linear-bridge',
    defaultBranch: 'main'
  },
  linear: {
    projectId: 'old-project',
    projectName: 'Old Linear Bridge'
  },
  localPath: oldLocalPath,
  docs: ['README.md'],
  evidenceWeight: 'high'
});
const originalCliRepoMap = read(cliRepoMapPath);
const cli = spawnSync(process.execPath, [
  'scripts/repo-map-drift.mjs',
  'check',
  '--repo',
  'linear-bridge',
  '--repo-map',
  cliRepoMapPath,
  '--state-dir',
  cliStateDir,
  '--github-owner',
  'w2030298-art',
  '--github-repo',
  'linear-bridge',
  '--default-branch',
  'main',
  '--linear-project-id',
  'project-id-2',
  '--linear-project-name',
  'linear-bridge Linear dispatch bridge',
  '--local-path',
  newLocalPath
], {
  cwd: process.cwd(),
  encoding: 'utf8'
});
assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const cliOutput = JSON.parse(cli.stdout);
assert.equal(cliOutput.status, 'drift_detected');
assert.equal(cliOutput.draftPath, path.join(cliStateDir, 'repo-map.draft.yaml'));
assert.equal(read(cliRepoMapPath), originalCliRepoMap);

console.log('repo map drift tests passed');
