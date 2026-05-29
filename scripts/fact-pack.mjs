#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { arg, has, json, now, ensureDir, writeJson, hash } from './utils.mjs';

const cmd = process.argv[2] === 'conflicts' ? 'conflicts' : 'build';
const task = arg('--task', 'unspecified');
const linear = arg('--linear', '');
const repoKey = arg('--repo', '');
const query = arg('--query', task);
const includePortfolio = !has('--no-portfolio') && (has('--portfolio') || /portfolio|组合巡检|项目巡检/i.test(`${task} ${query}`));

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

const pack = {
  id: `fact-${hash(`${task}-${Date.now()}`).slice(0, 12)}`,
  createdAt: now(),
  scope: { task, linearProjectIdOrKey: linear || null, repoKey: repoKey || null, query },
  facts: [],
  assumptions: [],
  openQuestions: [],
  conflicts: [],
  evidenceGaps: [],
  planningImplications: []
};

pack.facts.push(fact(`Task scope received: ${task}`, 'user_input', 'current prompt', 'high'));

if (linear) {
  const linearData = runNode(['scripts/linear-cli.mjs', 'project', linear]);
  if (!linearData.ok && linearData.error) pack.evidenceGaps.push(`Linear project context unavailable: ${linearData.error}`);
  else pack.facts.push(fact(`Linear project context was retrieved for ${linear}.`, 'linear_live', `linear:${linear}`, 'high', JSON.stringify(linearData).slice(0, 5000)));
} else {
  pack.evidenceGaps.push('No Linear project key/id provided; project state may be incomplete for extend/report/cycle tasks.');
}

if (includePortfolio) {
  const portfolio = runNode(['state/portfolio-review/build-portfolio-snapshot.mjs']);
  if (!portfolio.ok && portfolio.error) {
    pack.evidenceGaps.push(`Linear portfolio snapshot unavailable: ${portfolio.error}`);
  } else {
    pack.facts.push(fact(
      `Linear portfolio snapshot collected: ${portfolio.activeProjects || 0} active projects scanned.`,
      'linear_live',
      portfolio.outPath || 'state/portfolio-review/portfolio-snapshot-2026-05-28.json',
      'high',
      JSON.stringify(portfolio).slice(0, 5000)
    ));
    pack.planningImplications.push('Portfolio review must use the structured snapshot summary instead of oversized single-project context dumps.');
  }
}

if (!has('--no-github')) {
  // repo-map lookup is deliberately simple in scaffold. Use env fallback.
  const owner = process.env.GITHUB_DEFAULT_OWNER;
  const repo = process.env.GITHUB_DEFAULT_REPO;
  if (owner && repo) {
    const gh = runNode(['scripts/github-evidence.mjs', 'snapshot', '--owner', owner, '--repo', repo]);
    if (gh.error) pack.evidenceGaps.push(`GitHub evidence unavailable: ${gh.error}`);
    else {
      pack.facts.push(fact(`GitHub repo ${owner}/${repo} snapshot collected.`, 'github_remote', `github:${owner}/${repo}`, 'high', JSON.stringify(gh).slice(0, 5000)));
      if (gh.repoInfo?.pushedAt) pack.planningImplications.push(`Repo last pushed at ${gh.repoInfo.pushedAt}; use this to assess implementation freshness.`);
    }
  } else {
    pack.evidenceGaps.push('GITHUB_DEFAULT_OWNER/GITHUB_DEFAULT_REPO not configured; GitHub evidence skipped.');
  }
}

if (!has('--no-local')) {
  const localRoot = (process.env.LOCAL_REPO_ROOTS || '').split(',').map(s => s.trim()).filter(Boolean)[0];
  if (localRoot && fs.existsSync(localRoot)) {
    const local = runNode(['scripts/local-evidence.mjs', '--root', localRoot]);
    if (local.error) pack.evidenceGaps.push(`Local repo evidence unavailable: ${local.error}`);
    else {
      pack.facts.push(fact(`Local repo snapshot collected at ${local.root}.`, 'local_repo', `local:${local.root}`, 'high', JSON.stringify(local).slice(0, 5000)));
      if (local.dirty) pack.conflicts.push('Local repo has uncommitted changes; planning must distinguish working-copy facts from GitHub remote facts.');
    }
  } else {
    pack.evidenceGaps.push('No existing LOCAL_REPO_ROOTS path configured; local repo evidence skipped.');
  }
}

if (has('--web') && process.env.ALLOW_WEB_SEARCH !== 'false') {
  const web = runNode(['scripts/web-search.mjs', '--query', query, '--max', process.env.WEB_SEARCH_MAX_RESULTS || '8']);
  if (web.error) pack.evidenceGaps.push(`Web search unavailable: ${web.error}`);
  else pack.facts.push(fact(`Web search collected for query: ${query}`, 'web_search', web.provider || 'web', 'medium', JSON.stringify(web).slice(0, 5000)));
}

if (!pack.facts.some(f => f.sourceType === 'linear_live')) pack.openQuestions.push('Which Linear project/team should this task target?');
if (!pack.facts.some(f => f.sourceType === 'github_remote')) pack.openQuestions.push('Which GitHub repo should be treated as engineering source of truth?');

pack.planningImplications.push('Project planning must cite Fact Pack facts and label missing data as assumptions.');
pack.planningImplications.push('Linear writes must remain dry-run until explicit approval.');

ensureDir('state/fact-packs');
const out = `state/fact-packs/${pack.id}.json`;
writeJson(out, pack);
json({ ok: true, path: out, factPack: pack });
