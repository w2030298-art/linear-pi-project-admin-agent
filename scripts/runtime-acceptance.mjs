import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STABLE_BRANCH = 'master';
const CODE_DRIFT_STASH_MESSAGE = 'linear-pi-runtime-code-drift-before-acceptance';
const RUNTIME_CHECKS = [
  ['npm', ['run', 'test:runtime-reload-master']],
  ['npm', ['run', 'test:runtime-local-protection']],
  ['npm', ['run', 'test:runtime-instruction-boundary']],
  ['npm', ['run', 'test:wezterm-launch']]
];

function parseArgs(argv) {
  const options = {
    ci: false,
    sync: false,
    runtimeRoot: process.env.LINEAR_PI_RUNTIME_ROOT || defaultRuntimeRoot()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--ci') {
      options.ci = true;
      continue;
    }
    if (arg === '--sync') {
      options.sync = true;
      continue;
    }
    if (arg === '--runtime-root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--runtime-root requires a path');
      options.runtimeRoot = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function defaultRuntimeRoot() {
  return path.join(os.homedir(), 'linear-pi-project-admin-agent-runtime');
}

function sourceRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function commandSpec(command, args) {
  if (process.platform === 'win32' && command === 'npm') {
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm', ...args] };
  }
  return { command, args };
}

function run(command, args, cwd) {
  const spec = commandSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd,
    stdio: 'inherit',
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`);
  }
}

function read(command, args, cwd) {
  const spec = commandSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed in ${cwd}: ${output}`);
  }
  return (result.stdout || '').trim();
}

function ensureRuntimeRoot(runtimeRoot) {
  if (!fs.existsSync(runtimeRoot)) {
    throw new Error(`Runtime root does not exist: ${runtimeRoot}`);
  }
  if (read('git', ['rev-parse', '--is-inside-work-tree'], runtimeRoot) !== 'true') {
    throw new Error(`Runtime root is not a git worktree: ${runtimeRoot}`);
  }

  const branch = read('git', ['branch', '--show-current'], runtimeRoot);
  if (branch !== STABLE_BRANCH) {
    throw new Error(`Runtime root is on ${branch || '(detached)'}, not ${STABLE_BRANCH}`);
  }
}

function runtimeStatus(runtimeRoot) {
  return read('git', ['status', '--porcelain'], runtimeRoot);
}

function quarantineRuntimeChanges(runtimeRoot) {
  const status = read('git', ['status', '--porcelain'], runtimeRoot);
  if (!status) return false;

  console.log(`runtime checkout has local changes; stashing before acceptance sync:\n${status}`);
  run('git', ['stash', 'push', '--include-untracked', '-m', CODE_DRIFT_STASH_MESSAGE], runtimeRoot);

  const remaining = runtimeStatus(runtimeRoot);
  if (remaining) {
    throw new Error(`Runtime root still has local changes after stash:\n${remaining}`);
  }
  return true;
}

function ensureSameRemote(source, runtimeRoot) {
  const sourceRemote = read('git', ['remote', 'get-url', 'origin'], source);
  const runtimeRemote = read('git', ['remote', 'get-url', 'origin'], runtimeRoot);
  if (sourceRemote !== runtimeRemote) {
    throw new Error(`Runtime remote differs from source remote:\nsource=${sourceRemote}\nruntime=${runtimeRemote}`);
  }
}

function syncRuntime(runtimeRoot) {
  run('git', ['fetch', 'origin', STABLE_BRANCH], runtimeRoot);
  run('git', ['pull', '--ff-only', 'origin', STABLE_BRANCH], runtimeRoot);
}

function installDependencies(root) {
  if (fs.existsSync(path.join(root, 'package-lock.json'))) {
    run('npm', ['ci'], root);
  } else {
    run('npm', ['install'], root);
  }
}

function runRuntimeChecks(root) {
  run('npm', ['run', 'validate'], root);
  run('npm', ['run', 'typecheck'], root);
  for (const [command, args] of RUNTIME_CHECKS) {
    run(command, args, root);
  }
}

function runCiAcceptance(root) {
  runRuntimeChecks(root);
}

function runLocalRuntimeAcceptance(root, options) {
  ensureRuntimeRoot(options.runtimeRoot);
  quarantineRuntimeChanges(options.runtimeRoot);
  ensureSameRemote(root, options.runtimeRoot);
  if (options.sync) syncRuntime(options.runtimeRoot);
  ensureRuntimeRoot(options.runtimeRoot);
  quarantineRuntimeChanges(options.runtimeRoot);
  installDependencies(options.runtimeRoot);
  runRuntimeChecks(options.runtimeRoot);
  const head = read('git', ['rev-parse', '--short', 'HEAD'], options.runtimeRoot);
  console.log(`runtime acceptance passed: ${options.runtimeRoot} @ ${head}`);
}

const options = parseArgs(process.argv.slice(2));
const root = sourceRoot();

if (options.ci) {
  runCiAcceptance(root);
} else {
  runLocalRuntimeAcceptance(root, options);
}
