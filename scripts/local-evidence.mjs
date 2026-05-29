#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import fg from 'fast-glob';
import { arg, json, now } from './utils.mjs';
import { scoreDocument, tokenizeQuery } from './retrieval-utils.mjs';

const cmd = process.argv[2] === 'docs' ? 'docs' : 'repo';
const root = path.resolve(arg('--root', process.env.LOCAL_REPO_ROOTS?.split(',')[0] || '.'));
const query = arg('--query', '');

function sh(command, cwd) {
  try { return execSync(command, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return null; }
}

function safeStat(p) {
  try { const s = fs.statSync(p); return { size: s.size, mtime: s.mtime.toISOString() }; } catch { return null; }
}

async function repoSnapshot() {
  const branch = sh('git rev-parse --abbrev-ref HEAD', root);
  const commit = sh('git rev-parse HEAD', root);
  const status = sh('git status --short', root);
  const files = await fg(['README*', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'docs/**/*.{md,mdx,txt}', 'architecture/**/*.{md,mdx,txt}'], { cwd: root, dot: false, ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'] });
  const manifests = files.slice(0, 80).map(f => ({ path: f, ...safeStat(path.join(root, f)) }));
  json({
    sourceType: 'local_repo',
    collectedAt: now(),
    root,
    branch,
    commit,
    dirty: Boolean(status),
    status: status || '',
    manifests
  });
}

async function docsSearch() {
  const requestedRoot = arg('--root');
  const roots = requestedRoot
    ? [path.resolve(requestedRoot)]
    : (process.env.LOCAL_DOC_ROOTS || './docs,./research').split(',').map(x => path.resolve(x.trim())).filter(Boolean);
  const tokens = tokenizeQuery(query);
  const results = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    const files = await fg(['**/*.{md,mdx,txt,json,yaml,yml}'], { cwd: r, ignore: ['node_modules/**', '.git/**'] });
    for (const f of files.slice(0, 300)) {
      const p = path.join(r, f);
      const content = fs.readFileSync(p, 'utf8');
      const match = tokens.length ? scoreDocument(f, content, tokens) : { score: 1, matchedTokens: [] };
      if (!query || match.score > 0) {
        results.push({ root: r, path: f, stat: safeStat(p), score: match.score, matchedTokens: match.matchedTokens, excerpt: content.slice(0, 1200) });
      }
    }
  }
  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  json({ sourceType: 'local_docs', collectedAt: now(), query, tokens, results: results.slice(0, 20) });
}

if (cmd === 'docs') await docsSearch();
else await repoSnapshot();
