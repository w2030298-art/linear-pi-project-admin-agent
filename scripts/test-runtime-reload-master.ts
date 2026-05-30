import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reloadMasterPreflight, runtimeGitArgs, runtimeNpmArgs, shouldInstallDependencies } from '../.pi/extensions/runtime-master-reload.ts';

{
  const clean = reloadMasterPreflight({
    insideWorkTree: true,
    branch: 'master',
    dirtyStatus: ''
  });
  assert.equal(clean.ok, true);
}

{
  const dirty = reloadMasterPreflight({
    insideWorkTree: true,
    branch: 'master',
    dirtyStatus: ' M docs/OPERATIONS.md'
  });
  assert.equal(dirty.ok, false);
  assert.match(dirty.reason, /dirty/i);
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
  assert.deepEqual(runtimeNpmArgs(true), ['ci']);
  assert.deepEqual(runtimeNpmArgs(false), ['install']);
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
