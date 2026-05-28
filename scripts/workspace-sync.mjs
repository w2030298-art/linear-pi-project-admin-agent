#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { json, readJson, writeJson, now } from './utils.mjs';

const r = spawnSync('node', ['scripts/linear-cli.mjs', 'workspace'], { encoding: 'utf8', env: process.env });
let live;
try { live = JSON.parse(r.stdout); } catch { live = { ok: false, error: r.stderr || r.stdout }; }
const manifestPath = 'config/workspace.manifest.json';
const manifest = readJson(manifestPath, {});

if (!live.ok) {
  json({ ok: false, error: live.error, note: 'Set LINEAR_API_KEY before workspace sync.' });
  process.exit(1);
}

const liveLabelNames = new Set((live.labels || []).map(l => l.name));
const knownLabels = new Set(Object.values(manifest.labels || {}).flatMap(group => group.allowed || []));
const unmappedLabels = [...liveLabelNames].filter(name => !knownLabels.has(name));
const knownTeamKeys = new Set((manifest.teams || []).map(t => t.key));
const newTeams = (live.teams || []).filter(t => !knownTeamKeys.has(t.key));

const draft = { ...manifest, lastSyncedAt: now(), teams: live.teams, members: live.users, _unmappedLabels: unmappedLabels };
if (process.argv.includes('--write-draft')) writeJson('state/workspace.manifest.draft.json', draft);
json({ ok: true, unmappedLabels, newTeams, draftPath: process.argv.includes('--write-draft') ? 'state/workspace.manifest.draft.json' : null, liveSummary: { teams: live.teams.length, labels: live.labels.length, users: live.users.length } });
