#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { arg, has, json, now, ensureDir, writeJson, hash } from './utils.mjs';
import { listRepoMapProjectOptions, resolveRepoMapEntry } from './repo-map.mjs';
import { buildEvidenceBackedFact, compactFactPack, loadProjectBaselineFromFactPack, writeEvidenceFile } from './fact-pack-utils.mjs';

const rawCmd = process.argv[2];
const cmd = rawCmd === 'conflicts' || rawCmd === 'baseline' ? rawCmd : 'build';
const task = arg('--task', 'unspecified');
const linear = arg('--linear', '');
const repoKey = arg('--repo', '');
const query = arg('--query', task);
const requestedWorkspaceReview = has('--portfolio') || /portfolio|组合巡检|项目巡检|全局项目巡检/i.test(`${task} ${query}`);

function runNode(args) {
  const r = spawnSync('node', args, { encoding: 'utf8', env: process.env });
  try { return JSON.parse(r.stdout); } catch { return { error: r.stderr || r.stdout, code: r.status }; }
}

function fact(claim, sourceType, source, confidence = 'medium', rawRef = null) {
  return { claim, sourceType, source, confidence, rawRef, timestamp: now() };
}

function latestFactPackPath() {
  const dir = 'state/fact-packs';
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

if (cmd === 'conflicts') {
  const p = process.argv[3] || latestFactPackPath();
  if (!p) { json({ ok: false, error: 'no fact pack found' }); process.exit(1); }
  const pack = JSON.parse(fs.readFileSync(p, 'utf8'));
  json({ path: p, conflicts: pack.conflicts, recommendedResolution: pack.conflicts.length ? 'Report conflicts before planning; Linear wins for project state, GitHub main wins for remote engineering state, local repo wins for working-copy state.' : 'No conflicts recorded.' });
  process.exit(0);
}

if (cmd === 'baseline') {
  const p = process.argv[3] || latestFactPackPath();
  if (!p) { json({ ok: false, error: 'no fact pack found' }); process.exit(1); }
  const maxAgeHours = Number(arg('--max-age-hours', '24'));
  const result = loadProjectBaselineFromFactPack(p, {
    maxAgeMs: Number.isFinite(maxAgeHours) ? maxAgeHours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  });
  json({ ok: !result.shouldReadLive, path: p, ...result });
  process.exit(result.status === 'present' ? 0 : 2);
}

const pack = {
  id: `fact-${hash(`${task}-${Date.now()}`).slice(0, 12)}`,
  createdAt: now(),
  scope: { task, linearProjectIdOrKey: linear || null, repoKey: repoKey || null, query },
  facts: [],
  assumptions: [],
  openQuestions: [],
  conflicts: [],
  evidenceGaps: [],
  planningImplications: [],
  piAskUser: null
};

function evidenceFact(claim, sourceType, source, confidence, raw, evidenceKey) {
  writeEvidenceFile(pack.id, evidenceKey, raw);
  return buildEvidenceBackedFact({ claim, sourceType, source, confidence, raw, factPackId: pack.id, evidenceKey });
}

pack.facts.push(fact(`Task scope received: ${task}`, 'user_input', 'current prompt', 'high'));

const hasExplicitLinear = Boolean(linear);
const needsProjectSelection = !repoKey && !linear;
const skipRepoEvidenceWithoutRepoKey = hasExplicitLinear && !repoKey;
const repoMapping = needsProjectSelection || skipRepoEvidenceWithoutRepoKey
  ? { ok: false, evidenceGaps: [], conflicts: [] }
  : resolveRepoMapEntry(repoKey);
if (repoMapping.evidenceGaps?.length) pack.evidenceGaps.push(...repoMapping.evidenceGaps);
if (repoMapping.conflicts?.length) pack.conflicts.push(...repoMapping.conflicts);
if (skipRepoEvidenceWithoutRepoKey) {
  pack.evidenceGaps.push('No repoKey provided with explicit Linear project locator; GitHub/local evidence skipped to avoid fallback to an unrelated repo.');
}

if (needsProjectSelection) {
  pack.piAskUser = {
    flow: 'project_select',
    source: 'repo_map',
    repoMapPath: process.env.REPO_MAP_PATH || 'config/repo-map.yaml',
    options: [
      ...listRepoMapProjectOptions().map(option => ({
        projectId: option.projectId,
        repoKey: option.repoKey,
        label: option.label,
        description: option.description,
        localPath: option.localPath,
        localPathExists: option.localPathExists,
        linearProjectId: option.linearProjectId,
        linearProjectName: option.linearProjectName,
        linearProjectPrefix: option.linearProjectPrefix,
        source: option.source
      })),
      {
        projectId: 'User input',
        label: 'User input',
        description: 'Type a project ID manually.',
        custom: true
      }
    ]
  };
  pack.openQuestions.push('Choose one local project ID from config/repo-map.yaml, or provide custom input before reading Linear project context.');
  pack.evidenceGaps.push('No project selected yet; confirm a local project ID before Linear project context is read.');
  pack.planningImplications.push('Do not read Linear, GitHub, or local repo evidence until the user selects a local project ID or custom target.');
}

if (repoMapping.ok) {
  pack.scope.repo = {
    source: repoMapping.source,
    key: repoMapping.key,
    owner: repoMapping.github.owner,
    repo: repoMapping.github.repo,
    defaultBranch: repoMapping.github.defaultBranch,
    localPath: repoMapping.local.root,
    localPathExists: repoMapping.local.exists,
    linearProjectId: repoMapping.linear.projectId,
    linearProjectName: repoMapping.linear.projectName,
    linearProjectPrefix: repoMapping.linear.projectPrefix,
    docs: repoMapping.docs,
    evidenceWeight: repoMapping.evidenceWeight
  };
  pack.scope.linearProjectIdOrKey = linear || repoMapping.linear.projectId || repoMapping.linear.projectName || repoMapping.linear.projectPrefix || null;
  if (repoKey) {
    pack.facts.push(evidenceFact(`Repo map resolved ${repoKey} to ${repoMapping.github.owner}/${repoMapping.github.repo}.`, 'repo_map', process.env.REPO_MAP_PATH || 'config/repo-map.yaml', repoMapping.evidenceWeight || 'high', pack.scope.repo, 'repo-map'));
  }
} else if (repoKey) {
  if (!repoMapping.evidenceGaps?.length && repoMapping.error) pack.evidenceGaps.push(repoMapping.error);
}

const effectiveLinear = linear || (repoMapping.ok ? (repoMapping.linear.projectId || repoMapping.linear.projectName || repoMapping.linear.projectPrefix || '') : '');
if (effectiveLinear && !has('--no-linear')) {
  const linearData = runNode(['scripts/linear-cli.mjs', 'project', effectiveLinear]);
  if (!linearData.ok && linearData.error) {
    pack.evidenceGaps.push(`Linear project context unavailable: ${linearData.error}`);
    if (linearData.resolution?.type === 'project_selection_gap') {
      pack.scope.linearProjectResolution = linearData.resolution;
      pack.openQuestions.push(linearData.resolution.message);
    }
  } else {
    const resolvedProjectId = linearData.resolvedProject?.resolvedProjectId || effectiveLinear;
    pack.scope.linearProjectIdOrKey = resolvedProjectId;
    pack.scope.linearProjectResolution = linearData.resolvedProject || null;
    pack.facts.push(evidenceFact(`Linear project context was retrieved for ${resolvedProjectId}.`, 'linear_live', `linear:${resolvedProjectId}`, 'high', linearData, 'linear-project'));
  }
} else if (!needsProjectSelection) {
  pack.evidenceGaps.push('No Linear project key/id provided; project state may be incomplete for extend/report tasks.');
}

if (requestedWorkspaceReview && !effectiveLinear) {
  pack.evidenceGaps.push('Project review is not loaded into a Fact Pack until one local project ID is selected.');
  if (!pack.piAskUser) pack.openQuestions.push('Choose one local project ID from config/repo-map.yaml before detailed review.');
}

if (!has('--no-github') && !needsProjectSelection && !skipRepoEvidenceWithoutRepoKey) {
  const owner = repoMapping.ok ? repoMapping.github.owner : null;
  const repo = repoMapping.ok ? repoMapping.github.repo : null;
  if (owner && repo) {
    const ghArgs = ['scripts/github-evidence.mjs', 'snapshot', '--owner', owner, '--repo', repo];
    if (repoMapping.github.defaultBranch) ghArgs.push('--ref', repoMapping.github.defaultBranch);
    const gh = runNode(ghArgs);
    if (gh.error) pack.evidenceGaps.push(`GitHub evidence unavailable: ${gh.error}`);
    else {
      pack.facts.push(evidenceFact(`GitHub repo ${owner}/${repo} snapshot collected.`, 'github_remote', `github:${owner}/${repo}`, 'high', gh, 'github-repo'));
      if (gh.repoInfo?.pushedAt) pack.planningImplications.push(`Repo last pushed at ${gh.repoInfo.pushedAt}; use this to assess implementation freshness.`);
    }
  } else {
    pack.evidenceGaps.push(repoKey
      ? `Repo map entry for ${repoKey} is missing GitHub owner/repo; GitHub evidence skipped.`
      : 'GITHUB_DEFAULT_OWNER/GITHUB_DEFAULT_REPO not configured; GitHub evidence skipped.');
  }
}

if (!has('--no-local') && !needsProjectSelection && !skipRepoEvidenceWithoutRepoKey) {
  const localRoot = repoMapping.ok ? repoMapping.local.root : null;
  if (localRoot && fs.existsSync(localRoot)) {
    const local = runNode(['scripts/local-evidence.mjs', '--root', localRoot]);
    if (local.error) pack.evidenceGaps.push(`Local repo evidence unavailable: ${local.error}`);
    else {
      pack.facts.push(evidenceFact(`Local repo snapshot collected at ${local.root}.`, 'local_repo', `local:${local.root}`, 'high', local, 'local-repo'));
      if (local.dirty) pack.conflicts.push('Local repo has uncommitted changes; planning must distinguish working-copy facts from GitHub remote facts.');
    }
  } else {
    pack.evidenceGaps.push(repoKey
      ? `Repo map entry for ${repoKey} has no existing localPath; local repo evidence skipped.`
      : 'No existing LOCAL_REPO_ROOTS path configured; local repo evidence skipped.');
  }
}

if (has('--web') && process.env.ALLOW_WEB_SEARCH !== 'false') {
  const web = runNode(['scripts/web-search.mjs', '--query', query, '--max', process.env.WEB_SEARCH_MAX_RESULTS || '8']);
  if (web.error) pack.evidenceGaps.push(`Web search unavailable: ${web.error}`);
  else pack.facts.push(evidenceFact(`Web search collected for query: ${query}`, 'web_search', web.provider || 'web', 'medium', web, 'web-search'));
}

if (!pack.facts.some(f => f.sourceType === 'linear_live') && !pack.scope.linearProjectIdOrKey && !pack.piAskUser) {
  pack.openQuestions.push('Which Linear project/team should this task target?');
}
if (!pack.facts.some(f => f.sourceType === 'github_remote') && !(pack.scope.repo?.owner && pack.scope.repo?.repo) && !pack.piAskUser) {
  pack.openQuestions.push('Which GitHub repo should be treated as engineering source of truth?');
}

pack.planningImplications.push('Project planning must cite Fact Pack facts and label missing data as assumptions.');
pack.planningImplications.push('Linear writes must remain dry-run until explicit approval.');

ensureDir('state/fact-packs');
const out = `state/fact-packs/${pack.id}.json`;
const compact = compactFactPack(pack);
writeJson(out, compact);
json({ ok: true, path: out, factPack: compact });
