#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

function isIgnored(path) {
  return git(['check-ignore', '--no-index', '--quiet', path]).status === 0;
}

const protectedIgnoredPaths = [
  '.env',
  '.env.local',
  '.env.production',
  'state/audit.jsonl',
  'state/linear-events.jsonl',
  'state/seen-linear-deliveries.json',
  'state/seen-linear-deliveries.jsonl',
  'state/seen-linear-deliveries.jsonl.lock',
  'state/repo-map.draft.yaml',
  'state/repo-map.local.yaml',
  'state/repo-map-audit.jsonl',
  'state/workspace.manifest.draft.json',
  'state/write-plans/test.json',
  'state/audit-reports/test.md',
  'state/linear-apply-progress/test.json',
  'state/pi-queue/test.md',
  'state/pi-queue/test.out.log',
  'state/fact-packs/fact-test.json',
  'state/fact-packs/evidence/fact-test/local.json',
  'state/portfolio-review/portfolio-snapshot-test.json',
  'state/sessions/session.jsonl',
  '.pi/sessions/session.jsonl',
  'node_modules/.linear-pi-runtime-deps.stamp',
  'nul'
];

for (const path of protectedIgnoredPaths) {
  assert.equal(isIgnored(path), true, `${path} should be ignored so runtime pull/reload does not own it`);
}

assert.equal(isIgnored('.env.example'), false, '.env.example should stay trackable as a template');
assert.equal(fs.existsSync('state/portfolio-review/build-portfolio-snapshot.mjs'), false, 'workspace-wide portfolio snapshot helper should not remain an active fact source');

const trackedProtected = git([
  'ls-files',
  '.env',
  '.env.local',
  '.env.production',
  'state/repo-map.draft.yaml',
  'state/repo-map.local.yaml',
  'state/repo-map-audit.jsonl',
  'state/write-plans',
  'state/audit-reports',
  'state/linear-apply-progress',
  '.pi/sessions'
]);
assert.equal(trackedProtected.status, 0, trackedProtected.stderr);
assert.equal(trackedProtected.stdout.trim(), '', 'runtime-local protected files should not be tracked');

const installer = fs.readFileSync('scripts/install-wezterm-linear-pi-shortcut.ps1', 'utf8');
const reloadExtension = fs.readFileSync('.pi/extensions/runtime-master-reload.ts', 'utf8');
assert.match(installer, /REPO_MAP_LOCAL_PATH/);
assert.match(installer, /repo-map\.local\.yaml/);
const installerSelfTest = spawnSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  'scripts/install-wezterm-linear-pi-shortcut.ps1',
  '-WezTermGui',
  process.execPath,
  '-SkipRuntimeInit',
  '-SelfTestAllowedRuntimeDirty'
], { encoding: 'utf8' });
assert.equal(installerSelfTest.status, 0, installerSelfTest.stderr || installerSelfTest.stdout);
const selfTest = JSON.parse(installerSelfTest.stdout);
assert.equal(selfTest.nulLocalExcludeConfigured, true, 'launcher should ignore accidental root nul files before runtime dirty checks');
assert.equal(selfTest.linearApplyProgressDirtyAllowed, true, 'launcher should allow generated Linear apply progress state');
assert.equal(selfTest.codeDirtyAllowed, false, 'launcher should classify source code changes as runtime code drift');
assert.match(installer, /linear-pi-runtime-code-drift-before-launch/);
assert.match(reloadExtension, /linear-pi-runtime-code-drift-before-reload/);
assert.doesNotMatch(installer, /refusing to overwrite runtime state/);
for (const source of [installer, reloadExtension]) {
  assert.doesNotMatch(source, /git\s+clean/i);
  assert.doesNotMatch(source, /reset\s+--hard/i);
  assert.doesNotMatch(source, /Remove-Item[\s\S]{0,120}\$RuntimeRoot/i);
}

const guide = fs.readFileSync('docs/WEZTERM_PI_LAUNCH.md', 'utf8');
assert.match(guide, /\.env/);
assert.match(guide, /state\/repo-map\.draft\.yaml/);
assert.match(guide, /state\/repo-map-audit\.jsonl/);
assert.match(guide, /state\/write-plans\//);
assert.match(guide, /state\/linear-apply-progress\//);
assert.match(guide, /git pull --ff-only/);
assert.match(guide, /does not run `git clean`/i);
assert.match(guide, /Stashes.*code\/config/i);

console.log('runtime local protection tests passed');
