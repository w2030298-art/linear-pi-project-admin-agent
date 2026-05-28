#!/usr/bin/env node
import { arg, has, json, now, fetchJson } from './utils.mjs';

const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const headers = token ? { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' } : { 'Accept': 'application/vnd.github+json' };
const cmd = process.argv[2] || 'snapshot';
const owner = arg('--owner', process.env.GITHUB_DEFAULT_OWNER);
const repo = arg('--repo', process.env.GITHUB_DEFAULT_REPO);
const ref = arg('--ref', undefined);

if (!owner || !repo) {
  json({ ok: false, error: 'owner/repo required. Pass --owner and --repo or set GITHUB_DEFAULT_OWNER/GITHUB_DEFAULT_REPO.' });
  process.exit(2);
}

async function gh(path) {
  return fetchJson(`https://api.github.com/repos/${owner}/${repo}${path}`, { headers });
}

async function snapshot() {
  const repoInfo = await gh('');
  const branch = ref || repoInfo.default_branch;
  const [readme, pulls, workflows] = await Promise.allSettled([
    gh(`/readme?ref=${encodeURIComponent(branch)}`),
    has('--no-prs') ? Promise.resolve([]) : gh('/pulls?state=open&per_page=10'),
    has('--no-actions') ? Promise.resolve([]) : gh('/actions/runs?per_page=5')
  ]);
  json({
    sourceType: 'github_remote',
    collectedAt: now(),
    owner, repo, ref: branch,
    repoInfo: {
      id: repoInfo.id,
      fullName: repoInfo.full_name,
      defaultBranch: repoInfo.default_branch,
      pushedAt: repoInfo.pushed_at,
      description: repoInfo.description,
      language: repoInfo.language,
      visibility: repoInfo.visibility
    },
    readme: readme.status === 'fulfilled' ? { path: readme.value.path, sha: readme.value.sha, size: readme.value.size } : { error: readme.reason?.message },
    openPullRequests: pulls.status === 'fulfilled' ? pulls.value.map(p => ({ number: p.number, title: p.title, state: p.state, draft: p.draft, updatedAt: p.updated_at, url: p.html_url })) : [],
    workflowRuns: workflows.status === 'fulfilled' && workflows.value.workflow_runs ? workflows.value.workflow_runs.map(r => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, branch: r.head_branch, updatedAt: r.updated_at, url: r.html_url })) : []
  });
}

async function fileRead() {
  const filePath = arg('--path');
  if (!filePath) throw new Error('--path required');
  const data = await gh(`/contents/${encodeURIComponent(filePath).replaceAll('%2F','/')}?ref=${encodeURIComponent(ref || 'HEAD')}`);
  const content = data.encoding === 'base64' ? Buffer.from(data.content, 'base64').toString('utf8') : data.content;
  json({ sourceType: 'github_remote', collectedAt: now(), owner, repo, path: filePath, sha: data.sha, size: data.size, content });
}

if (cmd === 'snapshot') await snapshot();
else if (cmd === 'file') await fileRead();
else json({ ok: false, error: `unknown command ${cmd}` });
