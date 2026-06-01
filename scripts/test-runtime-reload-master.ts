import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RUNTIME_LOCAL_EXCLUDE_ENTRIES,
  ensureRuntimeLocalExclude,
  isAllowedRuntimeDirtyStatus,
  reloadMasterPreflight,
  runtimeGitArgs,
  runtimeNpmExec,
  runtimeNpmArgs,
  shouldInstallDependencies
} from '../.pi/extensions/runtime-master-reload.ts';

{
  const clean = reloadMasterPreflight({
    insideWorkTree: true,
    branch: 'master',
    dirtyStatus: ''
  });
  assert.equal(clean.ok, true);
}

{
  const generatedDirty = reloadMasterPreflight({
    insideWorkTree: true,
    branch: 'master',
    dirtyStatus: ' M state/portfolio-review/portfolio-snapshot-2026-05-28.json'
  });
  assert.equal(generatedDirty.ok, true);
}

{
  assert.equal(isAllowedRuntimeDirtyStatus(' M state/fact-packs/evidence/fact-1/local-repo.json'), true);
  assert.equal(isAllowedRuntimeDirtyStatus(' M .pi/sessions/session.jsonl'), true);
  assert.equal(isAllowedRuntimeDirtyStatus('?? nul'), false);
  assert.equal(isAllowedRuntimeDirtyStatus(' M scripts/linear-cli.mjs'), false);
}

{
  assert.ok(RUNTIME_LOCAL_EXCLUDE_ENTRIES.includes('nul'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-local-exclude-'));
  fs.mkdirSync(path.join(tempDir, '.git', 'info'), { recursive: true });
  ensureRuntimeLocalExclude(tempDir);
  ensureRuntimeLocalExclude(tempDir);
  const excludeText = fs.readFileSync(path.join(tempDir, '.git', 'info', 'exclude'), 'utf8');
  assert.match(excludeText, /^nul$/m);
  assert.equal((excludeText.match(/^nul$/gm) || []).length, 1);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

{
  const sourceDirty = reloadMasterPreflight({
    insideWorkTree: true,
    branch: 'master',
    dirtyStatus: ' M docs/OPERATIONS.md'
  });
  assert.equal(sourceDirty.ok, false);
  assert.match(sourceDirty.reason, /dirty/i);
}

{
  const feature = reloadMasterPreflight({
    insideWorkTree: true,
    branch: 'feature/test',
    dirtyStatus: ''
  });
  assert.equal(feature.ok, false);
  assert.match(feature.reason, /master/i);
}

{
  assert.deepEqual(runtimeGitArgs('C:\\runtime', 'fetch'), ['-C', 'C:\\runtime', 'fetch', 'origin', 'master']);
  assert.deepEqual(runtimeGitArgs('C:\\runtime', 'pull'), ['-C', 'C:\\runtime', 'pull', '--ff-only', 'origin', 'master']);
  assert.deepEqual(runtimeGitArgs('C:\\runtime', 'stash-generated-state'), [
    '-C',
    'C:\\runtime',
    'stash',
    'push',
    '--include-untracked',
    '-m',
    'linear-pi-runtime-generated-state-before-reload'
  ]);
  assert.deepEqual(runtimeNpmArgs(true), ['ci']);
  assert.deepEqual(runtimeNpmArgs(false), ['install']);
  const npmCi = runtimeNpmExec(true);
  if (process.platform === 'win32') {
    assert.equal(npmCi.command.toLowerCase(), 'cmd.exe');
    assert.deepEqual(npmCi.args, ['/d', '/s', '/c', 'npm', 'ci']);
  } else {
    assert.equal(npmCi.command, 'npm');
    assert.deepEqual(npmCi.args, ['ci']);
  }
}

{
  assert.equal(shouldInstallDependencies({ hasPackageJson: false, hasNodeModules: false, hasStamp: false }), false);
  assert.equal(shouldInstallDependencies({ hasPackageJson: true, hasNodeModules: false, hasStamp: false }), true);
  assert.equal(shouldInstallDependencies({ hasPackageJson: true, hasNodeModules: true, hasStamp: false }), true);
  assert.equal(shouldInstallDependencies({
    hasPackageJson: true,
    hasNodeModules: true,
    hasStamp: true,
    packageJsonMtimeMs: 10,
    stampMtimeMs: 20
  }), false);
  assert.equal(shouldInstallDependencies({
    hasPackageJson: true,
    hasNodeModules: true,
    hasStamp: true,
    packageJsonMtimeMs: 30,
    stampMtimeMs: 20
  }), true);
  assert.equal(shouldInstallDependencies({
    hasPackageJson: true,
    hasPackageLock: true,
    hasNodeModules: true,
    hasStamp: true,
    packageJsonMtimeMs: 10,
    packageLockMtimeMs: 30,
    stampMtimeMs: 20
  }), true);
}

{
  const settings = fs.readFileSync('.pi/settings.json', 'utf8');
  assert.match(settings, /extensions\/runtime-master-reload\.ts/);

  const source = fs.readFileSync('.pi/extensions/runtime-master-reload.ts', 'utf8');
  assert.match(source, /registerCommand\(["']reload-master["']/);
  assert.match(source, /ctx\.reload\(\)/);
  assert.match(source, /--ff-only/);
  assert.match(source, /stash.*push/s);
  assert.match(source, /npm/);
  assert.match(source, /branch.*master/i);
  assert.match(source, /dirty/i);
}

{
  const launchGuide = fs.readFileSync('docs/WEZTERM_PI_LAUNCH.md', 'utf8');
  const smokeReport = fs.readFileSync('docs/reports/wezterm-pi-smoke-2026-05-29.md', 'utf8');
  assert.match(launchGuide, /\/reload-master/);
  assert.match(launchGuide, /pull.*origin\/master/i);
  assert.match(launchGuide, /npm ci/);
  assert.match(launchGuide, /clean.*master/i);
  assert.match(smokeReport, /\/reload-master/);
  assert.match(smokeReport, /npm dependencies/i);
}

console.log('runtime reload master tests passed');
