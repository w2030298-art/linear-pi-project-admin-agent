import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const VALID_EVIDENCE_WEIGHTS = new Set(['high', 'medium', 'low']);
const DEFAULT_REPO_MAP_PATH = 'config/repo-map.yaml';
const DEFAULT_LOCAL_REPO_MAP_PATH = 'state/repo-map.local.yaml';

export function readRepoMap(repoMapPath) {
  if (!fs.existsSync(repoMapPath)) return { repos: [] };
  return YAML.parse(fs.readFileSync(repoMapPath, 'utf8')) || { repos: [] };
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function docsList(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function resolveLocalPath(localPath, cwd) {
  if (!localPath) return null;
  return path.resolve(path.isAbsolute(localPath) ? localPath : path.resolve(cwd, localPath));
}

function samePath(left, right) {
  if (!left || !right) return true;
  return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
}

function repoKeyOf(entry) {
  return text(entry.repoKey) || text(entry.key);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function mergeRepoMaps(baseMap = {}, localMap = {}) {
  const repos = [];
  const byKey = new Map();
  for (const entry of Array.isArray(baseMap.repos) ? baseMap.repos : []) {
    const copied = clone(entry);
    const key = repoKeyOf(copied);
    if (key) byKey.set(key, repos.length);
    repos.push(copied);
  }
  for (const entry of Array.isArray(localMap.repos) ? localMap.repos : []) {
    const copied = clone(entry);
    const key = repoKeyOf(copied);
    if (key && byKey.has(key)) repos[byKey.get(key)] = copied;
    else {
      if (key) byKey.set(key, repos.length);
      repos.push(copied);
    }
  }
  return { version: baseMap.version || localMap.version || 1, repos };
}

export function repoMapPaths(options = {}) {
  const env = options.env || process.env;
  return {
    repoMapPath: options.repoMapPath || env.REPO_MAP_PATH || DEFAULT_REPO_MAP_PATH,
    localRepoMapPath: options.localRepoMapPath || env.REPO_MAP_LOCAL_PATH || DEFAULT_LOCAL_REPO_MAP_PATH
  };
}

export function readMergedRepoMap(options = {}) {
  const { repoMapPath, localRepoMapPath } = repoMapPaths(options);
  const baseMap = readRepoMap(repoMapPath);
  const localMap = readRepoMap(localRepoMapPath);
  return {
    repoMap: mergeRepoMaps(baseMap, localMap),
    repoMapPath,
    localRepoMapPath,
    localRepoMapExists: fs.existsSync(localRepoMapPath)
  };
}

function normalizeEntry(entry, cwd, sourcePath = null) {
  const localPath = text(entry.localPath) || text(entry.local?.path) || text(entry.local?.root);
  const localRoot = resolveLocalPath(localPath, cwd);
  return {
    key: repoKeyOf(entry),
    github: {
      owner: text(entry.github?.owner) || text(entry.owner) || text(entry.githubOwner),
      repo: text(entry.github?.repo) || text(entry.repo) || text(entry.githubRepo),
      defaultBranch: text(entry.github?.defaultBranch) || text(entry.defaultBranch)
    },
    local: {
      path: localPath,
      root: localRoot,
      exists: Boolean(localRoot && fs.existsSync(localRoot))
    },
    linear: {
      projectId: text(entry.linear?.projectId) || text(entry.linearProjectId),
      projectName: text(entry.linear?.projectName) || text(entry.linearProjectName),
      projectPrefix: text(entry.linear?.projectPrefix) || text(entry.linearProjectPrefix)
    },
    docs: docsList(entry.docs),
    evidenceWeight: text(entry.evidenceWeight),
    sourcePath
  };
}

function envFallback(env, cwd) {
  const localRoot = (env.LOCAL_REPO_ROOTS || '').split(',').map(s => s.trim()).filter(Boolean)[0] || null;
  return {
    key: null,
    github: {
      owner: env.GITHUB_DEFAULT_OWNER || null,
      repo: env.GITHUB_DEFAULT_REPO || null,
      defaultBranch: env.GITHUB_DEFAULT_BRANCH || null
    },
    local: {
      root: localRoot ? path.resolve(cwd, localRoot) : null,
      exists: Boolean(localRoot && fs.existsSync(path.resolve(cwd, localRoot)))
    },
    linear: { projectId: null, projectName: null, projectPrefix: null },
    docs: [],
    evidenceWeight: null,
    evidenceGaps: [],
    conflicts: []
  };
}

function validateEntry(normalized, repoMapPath) {
  const label = normalized.key || '<missing repoKey>';
  const gaps = [];
  if (!normalized.key) gaps.push(`repo-map entry in ${repoMapPath} is missing repoKey.`);
  if (!normalized.github.owner) gaps.push(`repo-map entry ${label} is missing github.owner.`);
  if (!normalized.github.repo) gaps.push(`repo-map entry ${label} is missing github.repo.`);
  if (!normalized.github.defaultBranch) gaps.push(`repo-map entry ${label} is missing github.defaultBranch.`);
  if (!normalized.linear.projectId && !normalized.linear.projectName && !normalized.linear.projectPrefix) {
    gaps.push(`repo-map entry ${label} is missing a Linear project locator: linear.projectId, linear.projectName, or linear.projectPrefix.`);
  }
  if (!normalized.local.root) gaps.push(`repo-map entry ${label} is missing localPath.`);
  else if (!normalized.local.exists) gaps.push(`repo-map entry ${label} localPath does not exist: ${normalized.local.root}.`);
  if (!normalized.docs.length) gaps.push(`repo-map entry ${label} is missing docs.`);
  if (!normalized.evidenceWeight) gaps.push(`repo-map entry ${label} is missing evidenceWeight.`);
  else if (!VALID_EVIDENCE_WEIGHTS.has(normalized.evidenceWeight)) {
    gaps.push(`repo-map entry ${label} has invalid evidenceWeight: ${normalized.evidenceWeight}.`);
  }
  return gaps;
}

function envConflicts(normalized, env, cwd) {
  const conflicts = [];
  const compare = [
    ['GITHUB_DEFAULT_OWNER', env.GITHUB_DEFAULT_OWNER, normalized.github.owner],
    ['GITHUB_DEFAULT_REPO', env.GITHUB_DEFAULT_REPO, normalized.github.repo],
    ['GITHUB_DEFAULT_BRANCH', env.GITHUB_DEFAULT_BRANCH, normalized.github.defaultBranch]
  ];
  for (const [name, envValue, mapValue] of compare) {
    if (envValue && mapValue && envValue !== mapValue) {
      conflicts.push(`repo-map entry ${normalized.key} overrides ${name}: env=${envValue}, repo-map=${mapValue}.`);
    }
  }

  const envLocal = (env.LOCAL_REPO_ROOTS || '').split(',').map(s => s.trim()).filter(Boolean)[0] || null;
  if (envLocal && normalized.local.root) {
    const envLocalRoot = path.resolve(cwd, envLocal);
    if (!samePath(envLocalRoot, normalized.local.root)) {
      conflicts.push(`repo-map entry ${normalized.key} overrides LOCAL_REPO_ROOTS: env=${envLocalRoot}, repo-map=${normalized.local.root}.`);
    }
  }
  return conflicts;
}

export function validateRepoMap(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const { repoMap, repoMapPath, localRepoMapPath } = readMergedRepoMap({ ...options, env });
  const entries = Array.isArray(repoMap.repos) ? repoMap.repos.map(entry => normalizeEntry(entry, cwd, repoMapPath)) : [];
  const evidenceGaps = [];
  const conflicts = [];
  const seen = new Set();

  if (!Array.isArray(repoMap.repos)) evidenceGaps.push(`repo-map ${repoMapPath} plus ${localRepoMapPath} is missing repos array.`);
  for (const entry of entries) {
    evidenceGaps.push(...validateEntry(entry, repoMapPath));
    if (entry.key) {
      if (seen.has(entry.key)) conflicts.push(`repo-map ${repoMapPath} has duplicate repoKey: ${entry.key}.`);
      seen.add(entry.key);
    }
  }

  return { ok: !evidenceGaps.length && !conflicts.length, entries, repoMapPath, localRepoMapPath, evidenceGaps, conflicts };
}

export function listRepoMapProjectOptions(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  let repoMap;
  try {
    repoMap = readMergedRepoMap({ ...options, env }).repoMap;
  } catch {
    return [];
  }
  const repos = Array.isArray(repoMap.repos) ? repoMap.repos : [];
  return repos
    .map(entry => normalizeEntry(entry, cwd))
    .filter(entry => entry.key && entry.local.root)
    .map(entry => ({
      projectId: entry.key,
      repoKey: entry.key,
      label: entry.key,
      description: `${entry.local.root || 'missing localPath'}; Linear ${entry.linear.projectId || entry.linear.projectName || entry.linear.projectPrefix || 'unmapped Linear Project'}`,
      localPath: entry.local.root,
      localPathExists: entry.local.exists,
      linearProjectId: entry.linear.projectId,
      linearProjectName: entry.linear.projectName,
      linearProjectPrefix: entry.linear.projectPrefix,
      githubOwner: entry.github.owner,
      githubRepo: entry.github.repo,
      defaultBranch: entry.github.defaultBranch,
      source: 'repo_map'
    }));
}

export function resolveRepoMapEntry(repoKey, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const paths = repoMapPaths({ ...options, env });

  if (!repoKey) {
    const fallback = envFallback(env, cwd);
    return {
      ok: Boolean(fallback.github.owner || fallback.github.repo || fallback.local.root),
      source: 'env_fallback',
      ...fallback
    };
  }

  let repoMap;
  try {
    repoMap = readMergedRepoMap({ ...options, env }).repoMap;
  } catch (error) {
    return {
      ok: false,
      source: 'repo_map',
      key: repoKey,
      error: `repo-map ${paths.repoMapPath} plus ${paths.localRepoMapPath} could not be read: ${error.message}`,
      evidenceGaps: [`repo-map ${paths.repoMapPath} plus ${paths.localRepoMapPath} could not be read: ${error.message}`],
      conflicts: []
    };
  }

  const repos = Array.isArray(repoMap.repos) ? repoMap.repos : [];
  const matches = repos.filter(item => repoKeyOf(item) === repoKey);
  const entry = matches[0];
  if (!entry) {
    return {
      ok: false,
      source: 'repo_map',
      key: repoKey,
      error: `repoKey not found in ${paths.repoMapPath} or ${paths.localRepoMapPath}: ${repoKey}`,
      evidenceGaps: [`repoKey not found in ${paths.repoMapPath} or ${paths.localRepoMapPath}: ${repoKey}`],
      conflicts: []
    };
  }

  const normalized = normalizeEntry(entry, cwd);
  const evidenceGaps = validateEntry(normalized, `${paths.repoMapPath} + ${paths.localRepoMapPath}`);
  const conflicts = envConflicts(normalized, env, cwd);
  if (matches.length > 1) conflicts.push(`repo-map ${paths.repoMapPath} plus ${paths.localRepoMapPath} has duplicate repoKey: ${repoKey}.`);

  return {
    ok: true,
    complete: !evidenceGaps.length,
    source: 'repo_map',
    ...normalized,
    evidenceGaps,
    conflicts
  };
}
