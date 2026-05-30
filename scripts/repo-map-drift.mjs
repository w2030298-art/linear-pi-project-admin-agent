#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { ensureDir, hash, json, now } from './utils.mjs';
import { mergeRepoMaps, repoMapPaths, validateRepoMap } from './repo-map.mjs';

const DEFAULT_STATE_DIR = 'state';
const DRAFT_FILE_NAME = 'repo-map.draft.yaml';

const REQUIRED_USER_FIELDS = [
  { field: 'github.owner', title: 'GitHub URL' },
  { field: 'github.repo', title: 'GitHub URL' },
  { field: 'github.defaultBranch', title: 'Default branch' },
  { field: 'linear.projectId', title: 'Linear Project ID' },
  { field: 'localPath', title: 'Local repo path' }
];

const DRIFT_FIELDS = [
  { field: 'github.owner', source: 'github_remote' },
  { field: 'github.repo', source: 'github_remote' },
  { field: 'github.defaultBranch', source: 'github_remote' },
  { field: 'linear.projectId', source: 'linear_project' },
  { field: 'linear.projectName', source: 'linear_project' },
  { field: 'linear.projectPrefix', source: 'linear_project' },
  { field: 'localPath', source: 'local_repo' }
];

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readYaml(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return YAML.parse(fs.readFileSync(file, 'utf8')) || fallback;
}

function writeYaml(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, YAML.stringify(value));
}

function repoKeyOf(entry) {
  return clean(entry?.repoKey) || clean(entry?.key);
}

function getValue(obj, field) {
  return field.split('.').reduce((value, part) => value?.[part], obj);
}

function setValue(obj, field, value) {
  const parts = field.split('.');
  let cursor = obj;
  for (const part of parts.slice(0, -1)) {
    cursor[part] ||= {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function normalizeComparable(field, value, cwd) {
  const text = clean(value);
  if (!text) return undefined;
  if (field === 'localPath') return path.resolve(cwd, text);
  return text;
}

function valuesEqual(field, left, right, cwd) {
  const normalizedLeft = normalizeComparable(field, left, cwd);
  const normalizedRight = normalizeComparable(field, right, cwd);
  if (!normalizedLeft || !normalizedRight) return true;
  if (field === 'localPath') {
    return path.normalize(normalizedLeft).toLowerCase() === path.normalize(normalizedRight).toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

export function parseGitHubRemote(remoteUrl) {
  const trimmed = clean(remoteUrl);
  if (!trimmed) return {};

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2].replace(/\.git$/i, '') };

  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== 'github.com') return {};
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return {};
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
  } catch {
    const sshUrlMatch = trimmed.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i);
    return sshUrlMatch
      ? { owner: sshUrlMatch[1], repo: sshUrlMatch[2].replace(/\.git$/i, '') }
      : {};
  }
}

function gitOutput(localPath, args) {
  const result = spawnSync('git', ['-C', localPath, ...args], { encoding: 'utf8' });
  return result.status === 0 ? clean(result.stdout) : undefined;
}

function resolvePath(cwd, value) {
  const text = clean(value);
  if (!text) return undefined;
  return path.resolve(cwd, text);
}

function detectGitFacts(localPath, cwd) {
  const resolved = resolvePath(cwd, localPath);
  if (!resolved || !fs.existsSync(resolved)) return {};

  const remote = gitOutput(resolved, ['config', '--get', 'remote.origin.url']);
  const remoteFacts = parseGitHubRemote(remote);
  const originHead = gitOutput(resolved, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const defaultBranch = originHead?.replace(/^origin\//, '');
  return {
    github: {
      ...remoteFacts,
      defaultBranch
    },
    localPath: resolved
  };
}

function compact(value) {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter(item => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const cleaned = compact(item);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return Object.keys(result).length ? result : undefined;
  }
  return value === undefined || value === null || value === '' ? undefined : value;
}

function normalizeEntryForDraft(entry = {}, cwd) {
  const normalized = {
    repoKey: repoKeyOf(entry),
    github: {
      owner: clean(entry.github?.owner) || clean(entry.owner) || clean(entry.githubOwner),
      repo: clean(entry.github?.repo) || clean(entry.repo) || clean(entry.githubRepo),
      defaultBranch: clean(entry.github?.defaultBranch) || clean(entry.defaultBranch)
    },
    linear: {
      projectId: clean(entry.linear?.projectId) || clean(entry.linearProjectId),
      projectName: clean(entry.linear?.projectName) || clean(entry.linearProjectName),
      projectPrefix: clean(entry.linear?.projectPrefix) || clean(entry.linearProjectPrefix)
    },
    localPath: clean(entry.localPath) || clean(entry.local?.path) || clean(entry.local?.root),
    docs: Array.isArray(entry.docs) ? entry.docs.map(clean).filter(Boolean) : undefined,
    evidenceWeight: clean(entry.evidenceWeight)
  };
  if (normalized.localPath) normalized.localPath = path.resolve(cwd, normalized.localPath);
  return compact(normalized) || {};
}

function mergeSourceFacts(sourceFacts = {}, currentEntry = {}, cwd = process.cwd()) {
  const localPath = clean(sourceFacts.localPath) || clean(currentEntry.localPath);
  const gitFacts = detectGitFacts(localPath, cwd);
  const githubUrlFacts = parseGitHubRemote(sourceFacts.githubUrl);
  return compact({
    github: {
      ...gitFacts.github,
      ...githubUrlFacts,
      owner: clean(sourceFacts.github?.owner) || clean(sourceFacts.githubOwner) || githubUrlFacts.owner || gitFacts.github?.owner,
      repo: clean(sourceFacts.github?.repo) || clean(sourceFacts.githubRepo) || githubUrlFacts.repo || gitFacts.github?.repo,
      defaultBranch: clean(sourceFacts.github?.defaultBranch) || clean(sourceFacts.defaultBranch) || gitFacts.github?.defaultBranch
    },
    linear: {
      projectId: clean(sourceFacts.linear?.projectId) || clean(sourceFacts.linearProjectId),
      projectName: clean(sourceFacts.linear?.projectName) || clean(sourceFacts.linearProjectName),
      projectPrefix: clean(sourceFacts.linear?.projectPrefix) || clean(sourceFacts.linearProjectPrefix)
    },
    localPath: resolvePath(cwd, sourceFacts.localPath) || gitFacts.localPath,
    docs: Array.isArray(sourceFacts.docs) ? sourceFacts.docs.map(clean).filter(Boolean) : undefined,
    evidenceWeight: clean(sourceFacts.evidenceWeight)
  }) || {};
}

function projectContext(entry, facts) {
  const linear = {
    projectId: getValue(facts, 'linear.projectId') || getValue(entry, 'linear.projectId'),
    projectName: getValue(facts, 'linear.projectName') || getValue(entry, 'linear.projectName')
  };
  const name = linear.projectName || 'unknown Linear Project';
  const id = linear.projectId || 'unresolved-project-id';
  return { ...linear, label: `Project ${name} (${id})` };
}

function piAskUserSeed(repoKey, entry, facts) {
  const owner = getValue(facts, 'github.owner') || getValue(entry, 'github.owner');
  const repo = getValue(facts, 'github.repo') || getValue(entry, 'github.repo');
  const seed = {
    linearProjectId: getValue(facts, 'linear.projectId') || getValue(entry, 'linear.projectId'),
    linearProject: getValue(facts, 'linear.projectName') || getValue(entry, 'linear.projectName'),
    githubUrl: owner && repo ? `https://github.com/${owner}/${repo}` : undefined,
    localRepoPath: getValue(facts, 'localPath') || getValue(entry, 'localPath'),
    repoKey,
    defaultBranch: getValue(facts, 'github.defaultBranch') || getValue(entry, 'github.defaultBranch')
  };
  return compact(seed) || {};
}

function openQuestionFor(field, context) {
  const title = REQUIRED_USER_FIELDS.find(item => item.field === field)?.title || field;
  return `Provide ${title} for ${context.label} before applying repo-map drift.`;
}

function buildUpdatedRepoMap(repoMap, repoKey, entry) {
  const next = {
    version: repoMap.version || 1,
    repos: Array.isArray(repoMap.repos) ? [...repoMap.repos] : []
  };
  const index = next.repos.findIndex(item => repoKeyOf(item) === repoKey);
  if (index >= 0) next.repos[index] = entry;
  else next.repos.push(entry);
  return next;
}

function lcsDiff(beforeText, afterText, beforeLabel, afterLabel) {
  const normalizedBefore = beforeText.replace(/\r\n/g, '\n').trimEnd();
  const normalizedAfter = afterText.replace(/\r\n/g, '\n').trimEnd();
  if (normalizedBefore === normalizedAfter) return '';
  const before = normalizedBefore.split(/\r?\n/);
  const after = normalizedAfter.split(/\r?\n/);
  const dp = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines = [`--- ${beforeLabel}`, `+++ ${afterLabel}`];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      lines.push(` ${before[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`-${before[i]}`);
      i++;
    } else {
      lines.push(`+${after[j]}`);
      j++;
    }
  }
  while (i < before.length) lines.push(`-${before[i++]}`);
  while (j < after.length) lines.push(`+${after[j++]}`);
  return `${lines.join('\n')}\n`;
}

function draftPathFor(options) {
  if (options.draftPath) return options.draftPath;
  return path.join(options.stateDir || DEFAULT_STATE_DIR, DRAFT_FILE_NAME);
}

function rollbackAdvice(repoMapPath, writeTracked = false) {
  if (!writeTracked) {
    return [
      `Review the repo-map local overlay with: ${repoMapPath}`,
      `Before commit, revert by editing or removing the repo-map local overlay: ${repoMapPath}`,
      'After commit, no git rollback is needed for this machine-local overlay.'
    ];
  }
  return [
    `Review the repo-map change with: git diff -- ${repoMapPath}`,
    `Before commit, revert with: git checkout -- ${repoMapPath}`,
    'After commit, revert with: git revert <commit>'
  ];
}

function prospectiveValidation(cwd, repoMapPath, localRepoMapPath, targetMap, writeTracked = false) {
  const targetPath = writeTracked ? repoMapPath : localRepoMapPath;
  const tmpPath = path.join(path.dirname(targetPath), `.repo-map-validate-${process.pid}-${Date.now()}.yaml`);
  try {
    writeYaml(tmpPath, targetMap);
    return writeTracked
      ? validateRepoMap({ cwd, repoMapPath: tmpPath, localRepoMapPath, env: {} })
      : validateRepoMap({ cwd, repoMapPath, localRepoMapPath: tmpPath, env: {} });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

export function checkRepoMapDrift(options = {}) {
  const cwd = options.cwd || process.cwd();
  const repoKey = clean(options.repoKey || options.repo);
  if (!repoKey) throw new Error('repoKey is required for repo-map drift detection.');

  const { repoMapPath, localRepoMapPath } = repoMapPaths({
    repoMapPath: options.repoMapPath,
    localRepoMapPath: options.localRepoMapPath,
    env: options.env || process.env
  });
  const baseRepoMap = readYaml(repoMapPath, { version: 1, repos: [] });
  const localRepoMap = readYaml(localRepoMapPath, { version: 1, repos: [] });
  const repoMap = mergeRepoMaps(baseRepoMap, localRepoMap);
  const repos = Array.isArray(repoMap.repos) ? repoMap.repos : [];
  const currentRaw = repos.find(item => repoKeyOf(item) === repoKey) || { repoKey };
  const current = normalizeEntryForDraft(currentRaw, cwd);
  current.repoKey ||= repoKey;
  const sourceFacts = mergeSourceFacts(options.sourceFacts || {}, current, cwd);

  const draftEntry = compact({
    ...current,
    repoKey,
    github: {
      ...current.github,
      ...sourceFacts.github
    },
    linear: {
      ...current.linear,
      ...sourceFacts.linear
    },
    localPath: sourceFacts.localPath ? path.resolve(cwd, sourceFacts.localPath) : current.localPath,
    docs: sourceFacts.docs || current.docs,
    evidenceWeight: sourceFacts.evidenceWeight || current.evidenceWeight
  }) || { repoKey };

  for (const spec of DRIFT_FIELDS) {
    const currentValue = getValue(current, spec.field);
    const detectedValue = getValue(sourceFacts, spec.field);
    if (clean(currentValue) && clean(detectedValue) && valuesEqual(spec.field, currentValue, detectedValue, cwd)) {
      const preserved = spec.field === 'localPath'
        ? clean(currentRaw.localPath) || clean(currentRaw.local?.path) || clean(currentRaw.local?.root) || currentValue
        : currentValue;
      setValue(draftEntry, spec.field, preserved);
    }
  }

  const drifts = [];
  for (const spec of DRIFT_FIELDS) {
    const currentValue = getValue(current, spec.field);
    const detectedValue = getValue(sourceFacts, spec.field);
    if (clean(currentValue) && clean(detectedValue) && !valuesEqual(spec.field, currentValue, detectedValue, cwd)) {
      drifts.push({
        field: spec.field,
        current: normalizeComparable(spec.field, currentValue, cwd),
        detected: normalizeComparable(spec.field, detectedValue, cwd),
        source: spec.source
      });
    }
  }

  const missingFields = [];
  for (const spec of REQUIRED_USER_FIELDS) {
    const currentValue = getValue(current, spec.field);
    const detectedValue = getValue(sourceFacts, spec.field);
    if (!clean(currentValue)) {
      missingFields.push({
        field: spec.field,
        detected: normalizeComparable(spec.field, detectedValue, cwd),
        needsUserInput: !clean(detectedValue)
      });
    }
  }
  if (!Array.isArray(current.docs) || current.docs.length === 0) {
    missingFields.push({ field: 'docs', needsUserInput: !Array.isArray(sourceFacts.docs) || sourceFacts.docs.length === 0 });
  }
  if (!clean(current.evidenceWeight)) {
    missingFields.push({ field: 'evidenceWeight', detected: sourceFacts.evidenceWeight, needsUserInput: !clean(sourceFacts.evidenceWeight) });
  }

  const nextLocalRepoMap = buildUpdatedRepoMap(localRepoMap, repoKey, draftEntry);
  const nextEffectiveRepoMap = mergeRepoMaps(baseRepoMap, nextLocalRepoMap);
  const diff = lcsDiff(
    YAML.stringify(repoMap),
    YAML.stringify(nextEffectiveRepoMap),
    'repo-map effective current',
    'repo-map effective after local overlay'
  );
  const needsInteractiveInput = missingFields.some(field => field.needsUserInput);
  const hasChanges = drifts.length > 0 || missingFields.length > 0;
  const status = needsInteractiveInput
    ? 'needs_interactive_input'
    : drifts.length
      ? 'drift_detected'
      : missingFields.length
        ? 'missing_fields'
        : 'in_sync';
  const context = projectContext(current, sourceFacts);
  const openQuestions = missingFields
    .filter(field => field.needsUserInput)
    .map(field => openQuestionFor(field.field, context));
  const evidenceGaps = openQuestions.map(question => `Repo-map drift check needs user input: ${question}`);
  const draft = {
    version: 1,
    kind: 'repo-map-draft',
    repoKey,
    createdAt: now(),
    repoMapPath,
    localRepoMapPath,
    applyTargetPath: localRepoMapPath,
    sourceFacts,
    drifts,
    missingFields,
    entry: draftEntry,
    confirmationRequired: true,
    writesPerformed: false
  };

  const draftPath = hasChanges ? draftPathFor(options) : null;
  if (draftPath) writeYaml(draftPath, draft);

  return {
    ok: status === 'in_sync',
    status,
    repoKey,
    repoMapPath,
    localRepoMapPath,
    draftPath,
    draft,
    sourceFacts,
    drifts,
    missingFields,
    evidenceGaps,
    openQuestions,
    piAskUser: needsInteractiveInput ? { flow: 'repo_map', seed: piAskUserSeed(repoKey, current, sourceFacts) } : null,
    diff,
    rollbackAdvice: rollbackAdvice(localRepoMapPath),
    writesPerformed: false
  };
}

export function applyRepoMapDraft(options = {}) {
  const cwd = options.cwd || process.cwd();
  const draftPath = options.draftPath || path.join(DEFAULT_STATE_DIR, DRAFT_FILE_NAME);
  const confirmed = options.confirmed === true;
  const draft = readYaml(draftPath, null);
  const { repoMapPath, localRepoMapPath } = repoMapPaths({
    repoMapPath: options.repoMapPath || draft?.repoMapPath,
    localRepoMapPath: options.localRepoMapPath || draft?.localRepoMapPath,
    env: options.env || process.env
  });
  const writeTracked = options.writeTracked === true;
  if (!draft?.entry || !draft?.repoKey) {
    return {
      ok: false,
      status: 'invalid_draft',
      error: `repo-map draft is missing entry or repoKey: ${draftPath}`,
      writesPerformed: false
    };
  }

  const baseRepoMap = readYaml(repoMapPath, { version: 1, repos: [] });
  const localRepoMap = readYaml(localRepoMapPath, { version: 1, repos: [] });
  const currentEffectiveRepoMap = mergeRepoMaps(baseRepoMap, localRepoMap);
  const targetRepoMapPath = writeTracked ? repoMapPath : localRepoMapPath;
  const targetRepoMap = writeTracked ? baseRepoMap : localRepoMap;
  const nextTargetRepoMap = buildUpdatedRepoMap(targetRepoMap, draft.repoKey, draft.entry);
  const nextEffectiveRepoMap = writeTracked
    ? mergeRepoMaps(nextTargetRepoMap, localRepoMap)
    : mergeRepoMaps(baseRepoMap, nextTargetRepoMap);
  const afterText = YAML.stringify(nextTargetRepoMap);
  const diff = lcsDiff(
    YAML.stringify(currentEffectiveRepoMap),
    YAML.stringify(nextEffectiveRepoMap),
    'repo-map effective current',
    writeTracked ? 'repo-map effective after tracked config' : 'repo-map effective after local overlay'
  );

  if (!confirmed) {
    return {
      ok: false,
      status: 'confirmation_required',
      repoKey: draft.repoKey,
      repoMapPath,
      localRepoMapPath,
      targetRepoMapPath,
      draftPath,
      diff,
      rollbackAdvice: rollbackAdvice(targetRepoMapPath, writeTracked),
      writesPerformed: false,
      evidenceGaps: [
        writeTracked
          ? 'Explicit user confirmation is required before modifying config/repo-map.yaml.'
          : 'Explicit user confirmation is required before modifying the repo-map local overlay.'
      ]
    };
  }

  const validation = prospectiveValidation(cwd, repoMapPath, localRepoMapPath, nextTargetRepoMap, writeTracked);
  if (!validation.ok) {
    return {
      ok: false,
      status: 'validation_failed',
      repoKey: draft.repoKey,
      repoMapPath,
      localRepoMapPath,
      targetRepoMapPath,
      draftPath,
      diff,
      validation,
      writesPerformed: false,
      evidenceGaps: validation.evidenceGaps,
      conflicts: validation.conflicts
    };
  }

  ensureDir(path.dirname(targetRepoMapPath));
  fs.writeFileSync(targetRepoMapPath, afterText);
  const postValidation = validateRepoMap({ cwd, repoMapPath, localRepoMapPath, env: {} });
  const auditLogPath = options.auditLogPath || path.join(path.dirname(draftPath), 'repo-map-audit.jsonl');
  ensureDir(path.dirname(auditLogPath));
  const auditRecord = {
    timestamp: now(),
    event: 'repo_map_draft_applied',
    repoKey: draft.repoKey,
    repoMapPath,
    localRepoMapPath,
    targetRepoMapPath,
    writeTracked,
    draftPath,
    confirmationText: clean(options.confirmationText) || null,
    idempotencyKey: `repo-map-${draft.repoKey}-${hash({ draftPath, diff }).slice(0, 12)}`,
    drifts: draft.drifts || [],
    missingFields: draft.missingFields || [],
    writesPerformed: true
  };
  fs.appendFileSync(auditLogPath, `${JSON.stringify(auditRecord)}\n`);

  return {
    ok: postValidation.ok,
    status: postValidation.ok ? 'applied' : 'applied_with_validation_errors',
    repoKey: draft.repoKey,
    repoMapPath,
    localRepoMapPath,
    targetRepoMapPath,
    draftPath,
    auditLogPath,
    diff,
    validation: postValidation,
    rollbackAdvice: rollbackAdvice(targetRepoMapPath, writeTracked),
    writesPerformed: true
  };
}

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function has(name) {
  return process.argv.includes(name);
}

function cliSourceFacts() {
  const docsArg = clean(arg('--docs'));
  return compact({
    githubUrl: clean(arg('--github-url')),
    github: {
      owner: clean(arg('--github-owner')),
      repo: clean(arg('--github-repo')),
      defaultBranch: clean(arg('--default-branch'))
    },
    linear: {
      projectId: clean(arg('--linear-project-id')),
      projectName: clean(arg('--linear-project-name')),
      projectPrefix: clean(arg('--linear-project-prefix'))
    },
    localPath: clean(arg('--local-path')),
    docs: docsArg ? docsArg.split(',').map(clean).filter(Boolean) : undefined,
    evidenceWeight: clean(arg('--evidence-weight'))
  }) || {};
}

function printUsageAndExit() {
  console.error([
    'Usage:',
    '  node scripts/repo-map-drift.mjs check --repo <repoKey> [--repo-map config/repo-map.yaml] [--local-repo-map state/repo-map.local.yaml] [--state-dir state]',
    '  node scripts/repo-map-drift.mjs apply --draft state/repo-map.draft.yaml --confirmed [--local-repo-map state/repo-map.local.yaml] [--write-tracked] --confirmation-text "..."]'
  ].join('\n'));
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === 'check') {
      const result = checkRepoMapDrift({
        repoKey: arg('--repo') || arg('--repo-key'),
        repoMapPath: arg('--repo-map'),
        localRepoMapPath: arg('--local-repo-map'),
        stateDir: arg('--state-dir', DEFAULT_STATE_DIR),
        draftPath: arg('--draft'),
        sourceFacts: cliSourceFacts()
      });
      json(result);
      process.exit(0);
    }
    if (command === 'apply') {
      const result = applyRepoMapDraft({
        repoMapPath: arg('--repo-map'),
        localRepoMapPath: arg('--local-repo-map'),
        draftPath: arg('--draft', path.join(DEFAULT_STATE_DIR, DRAFT_FILE_NAME)),
        auditLogPath: arg('--audit-log'),
        confirmed: has('--confirmed'),
        writeTracked: has('--write-tracked'),
        confirmationText: arg('--confirmation-text', '')
      });
      json(result);
      process.exit(result.ok ? 0 : 1);
    }
    printUsageAndExit();
  } catch (error) {
    json({ ok: false, status: 'error', error: error instanceof Error ? error.message : String(error), writesPerformed: false });
    process.exit(1);
  }
}
