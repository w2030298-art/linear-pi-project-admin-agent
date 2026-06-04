import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import registerRuntimeMasterReload, {
  RUNTIME_LOCAL_EXCLUDE_ENTRIES,
  ensureNodeDependencies,
  ensureRuntimeLocalExclude,
  isAllowedRuntimeDirtyStatus,
  reloadMasterPreflight,
  runtimeDirtyAction,
  runtimeGitArgs,
  runtimeNpmExec,
  runtimeNpmArgs,
  shouldInstallDependencies
} from '../.pi/extensions/runtime-master-reload.ts';

{
  const clean = reloadMasterPreflight({
    insideWorkTree: true,
    branch: 'master'
  });
  assert.equal(clean.ok, true);
}

{
  const masterPreflight = reloadMasterPreflight({
    insideWorkTree: true,
    branch: 'master'
  });
  assert.equal(masterPreflight.ok, true);
}

{
  assert.equal(runtimeDirtyAction(''), 'none');
  assert.equal(runtimeDirtyAction(' M state/portfolio-review/portfolio-snapshot-2026-05-28.json'), 'stash-generated-state');
  assert.equal(runtimeDirtyAction(' M scripts/linear-cli.mjs'), 'stash-runtime-dirty-state');
  assert.equal(isAllowedRuntimeDirtyStatus(' M state/fact-packs/evidence/fact-1/local-repo.json'), true);
  assert.equal(isAllowedRuntimeDirtyStatus(' M .pi/sessions/session.jsonl'), true);
  assert.equal(isAllowedRuntimeDirtyStatus('?? state/linear-apply-progress/'), true);
  assert.equal(isAllowedRuntimeDirtyStatus(' M state/linear-apply-progress/WEN-300.json'), true);
  assert.equal(isAllowedRuntimeDirtyStatus('?? nul'), false);
  assert.equal(isAllowedRuntimeDirtyStatus(' M scripts/linear-cli.mjs'), false);
}

{
  assert.ok(RUNTIME_LOCAL_EXCLUDE_ENTRIES.includes('nul'));
  assert.ok(RUNTIME_LOCAL_EXCLUDE_ENTRIES.includes('state/linear-apply-progress/'));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-local-exclude-'));
  fs.mkdirSync(path.join(tempDir, '.git', 'info'), { recursive: true });
  ensureRuntimeLocalExclude(tempDir);
  ensureRuntimeLocalExclude(tempDir);
  const excludeText = fs.readFileSync(path.join(tempDir, '.git', 'info', 'exclude'), 'utf8');
  assert.match(excludeText, /^nul$/m);
  assert.match(excludeText, /^state\/linear-apply-progress\/$/m);
  assert.equal((excludeText.match(/^nul$/gm) || []).length, 1);
  assert.equal((excludeText.match(/^state\/linear-apply-progress\/$/gm) || []).length, 1);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

{
  const sourceDriftPreflight = reloadMasterPreflight({
    insideWorkTree: true,
    branch: 'master'
  });
  assert.equal(sourceDriftPreflight.ok, true);
}

{
  const feature = reloadMasterPreflight({
    insideWorkTree: true,
    branch: 'feature/test'
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
  assert.deepEqual(runtimeGitArgs('C:\\runtime', 'stash-runtime-dirty-state'), [
    '-C',
    'C:\\runtime',
    'stash',
    'push',
    '--include-untracked',
    '-m',
    'linear-pi-runtime-code-drift-before-reload'
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-deps-fail-'));
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"runtime-test"}\n');
  fs.mkdirSync(path.join(tempDir, 'node_modules'));
  const notices: string[] = [];
  const pi = {
    exec: async () => ({ code: 1, stdout: '', stderr: 'simulated npm failure' })
  };

  const result = await ensureNodeDependencies(pi as any, tempDir, (message) => notices.push(message));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'simulated npm failure');
  assert.deepEqual(notices, ['Installing runtime dependencies before reload...']);
  assert.equal(fs.existsSync(path.join(tempDir, 'node_modules', '.linear-pi-runtime-deps.stamp')), false);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-command-deps-fail-'));
  fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"runtime-test"}\n');
  fs.mkdirSync(path.join(tempDir, 'node_modules'));
  const notifications: Array<{ message: string; level: string }> = [];
  const execCalls: Array<{ command: string; args: string[] }> = [];
  let handler: any;
  let reloadCalled = false;
  const pi = {
    registerCommand: (_name: string, command: any) => {
      handler = command.handler;
    },
    exec: async (command: string, args: string[]) => {
      execCalls.push({ command, args });
      if (command === 'git' && args.includes('--is-inside-work-tree')) return { code: 0, stdout: 'true\n', stderr: '' };
      if (command === 'git' && args.includes('--show-current')) return { code: 0, stdout: 'master\n', stderr: '' };
      if (command === 'git' && args.includes('--porcelain')) return { code: 0, stdout: '', stderr: '' };
      if (command === 'git' && args.includes('fetch')) return { code: 0, stdout: '', stderr: '' };
      if (command === 'git' && args.includes('pull')) return { code: 0, stdout: '', stderr: '' };
      return { code: 1, stdout: '', stderr: 'simulated npm failure' };
    }
  };

  registerRuntimeMasterReload(pi as any);
  const result = await handler([], {
    cwd: tempDir,
    hasUI: true,
    ui: {
      notify: (message: string, level: string) => notifications.push({ message, level })
    },
    reload: async () => {
      reloadCalled = true;
    }
  });

  assert.equal(reloadCalled, false);
  assert.equal(result, undefined);
  assert.ok(notifications.some(item => item.level === 'error' && /currently running runtime/i.test(item.message)));
  assert.ok(execCalls.some(call => call.command === 'cmd.exe' || call.command === 'npm'));
  fs.rmSync(tempDir, { recursive: true, force: true });
}

{
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-command-code-drift-'));
  const notifications: Array<{ message: string; level: string }> = [];
  const execCalls: Array<{ command: string; args: string[] }> = [];
  let handler: any;
  let reloadCalled = false;
  const pi = {
    registerCommand: (_name: string, command: any) => {
      handler = command.handler;
    },
    exec: async (command: string, args: string[]) => {
      execCalls.push({ command, args });
      if (command === 'git' && args.includes('--is-inside-work-tree')) return { code: 0, stdout: 'true\n', stderr: '' };
      if (command === 'git' && args.includes('--show-current')) return { code: 0, stdout: 'master\n', stderr: '' };
      if (command === 'git' && args.includes('--porcelain')) return { code: 0, stdout: ' M docs/OPERATIONS.md\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    }
  };

  registerRuntimeMasterReload(pi as any);
  await handler([], {
    cwd: tempDir,
    hasUI: true,
    ui: {
      notify: (message: string, level: string) => notifications.push({ message, level })
    },
    reload: async () => {
      reloadCalled = true;
    }
  });

  assert.equal(reloadCalled, true);
  assert.ok(execCalls.some(call => call.command === 'git' && call.args.includes('stash') && call.args.includes('linear-pi-runtime-code-drift-before-reload')));
  assert.ok(execCalls.some(call => call.command === 'git' && call.args.includes('fetch')));
  assert.ok(execCalls.some(call => call.command === 'git' && call.args.includes('pull')));
  assert.ok(notifications.some(item => item.level === 'info' && /code\/config changes/i.test(item.message)));
  fs.rmSync(tempDir, { recursive: true, force: true });
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
  assert.match(launchGuide, /currently running runtime/i);
  assert.match(launchGuide, /Stashes.*code\/config/i);
  assert.match(smokeReport, /\/reload-master/);
  assert.match(smokeReport, /npm dependencies/i);
}

console.log('runtime reload master tests passed');
