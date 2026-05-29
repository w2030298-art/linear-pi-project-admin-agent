import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

function readRepoMap(repoMapPath) {
  if (!fs.existsSync(repoMapPath)) return { repos: [] };
  return YAML.parse(fs.readFileSync(repoMapPath, 'utf8')) || { repos: [] };
}

function normalizeEntry(entry, cwd) {
  const localPath = entry.localPath
    ? (path.isAbsolute(entry.localPath) ? entry.localPath : path.resolve(cwd, entry.localPath))
    : null;
  return {
    key: entry.key,
    github: {
      owner: entry.owner || entry.githubOwner || entry.github?.owner || null,
      repo: entry.repo || entry.githubRepo || entry.github?.repo || null,
      defaultBranch: entry.defaultBranch || entry.github?.defaultBranch || null
    },
    local: {
      root: localPath ? path.resolve(localPath) : null,
      exists: Boolean(localPath && fs.existsSync(localPath))
    },
    linear: {
      projectId: entry.linearProjectId || entry.linear?.projectId || null,
      projectName: entry.linearProjectName || entry.linear?.projectName || null,
      projectPrefix: entry.linearProjectPrefix || entry.linear?.projectPrefix || null
    },
    docs: Array.isArray(entry.docs) ? entry.docs : [],
    evidenceWeight: entry.evidenceWeight || null
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
    evidenceWeight: null
  };
}

export function resolveRepoMapEntry(repoKey, options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const repoMapPath = options.repoMapPath || env.REPO_MAP_PATH || 'config/repo-map.yaml';

  if (!repoKey) {
    const fallback = envFallback(env, cwd);
    return {
      ok: Boolean(fallback.github.owner || fallback.github.repo || fallback.local.root),
      source: 'env_fallback',
      ...fallback
    };
  }

  const repoMap = readRepoMap(repoMapPath);
  const entry = (repoMap.repos || []).find(item => item.key === repoKey);
  if (!entry) {
    return {
      ok: false,
      source: 'repo_map',
      key: repoKey,
      error: `repoKey not found in ${repoMapPath}: ${repoKey}`
    };
  }

  return {
    ok: true,
    source: 'repo_map',
    ...normalizeEntry(entry, cwd)
  };
}
