#!/usr/bin/env node
import { LinearClient } from '@linear/sdk';
import { json, now } from './utils.mjs';
import fs from 'node:fs';

const apiKey = process.env.LINEAR_API_KEY;
const cmd = process.argv[2] || 'smoke';

function client() {
  if (!apiKey) throw new Error('LINEAR_API_KEY missing. Copy .env.example to .env and set token.');
  return new LinearClient({ apiKey });
}

async function smoke() {
  const linear = client();
  const viewer = await linear.viewer;
  json({ ok: true, sourceType: 'linear_live', collectedAt: now(), viewer: { id: viewer.id, name: viewer.name, email: viewer.email } });
}

async function workspace() {
  const linear = client();
  const viewer = await linear.viewer;
  const teams = await linear.teams();
  const labels = await linear.issueLabels();
  const users = await linear.users();
  json({
    ok: true,
    sourceType: 'linear_live',
    collectedAt: now(),
    viewer: { id: viewer.id, name: viewer.name },
    teams: teams.nodes.map(t => ({ id: t.id, key: t.key, name: t.name })),
    labels: labels.nodes.map(l => ({ id: l.id, name: l.name, color: l.color })),
    users: users.nodes.slice(0, 100).map(u => ({ id: u.id, name: u.name, active: u.active, admin: u.admin }))
  });
}

async function project(projectIdOrKey) {
  const linear = client();
  // Linear SDK methods differ across versions; use raw GraphQL for stable scaffold.
  const query = `
    query ProjectContext($id: String!) {
      project(id: $id) {
        id name description url state createdAt updatedAt startDate targetDate
        projectMilestones { nodes { id name description targetDate sortOrder } }
        documents { nodes { id title url updatedAt } }
        projectUpdates { nodes { id body url createdAt updatedAt health } }
        issues { nodes { id identifier title description priority url createdAt updatedAt
          state { id name type }
          labels { nodes { id name } }
          assignee { id name }
          cycle { id name startsAt endsAt }
          projectMilestone { id name }
        } }
      }
    }`;
  const res = await linear.client.rawRequest(query, { id: projectIdOrKey });
  json({ ok: true, sourceType: 'linear_live', collectedAt: now(), data: res.data });
}

async function issues() {
  const queryText = process.argv.includes('--query') ? process.argv[process.argv.indexOf('--query') + 1] : '';
  const linear = client();
  const query = `query Issues($term: String) { issues(filter: { or: [{ title: { containsIgnoreCase: $term } }, { description: { containsIgnoreCase: $term } }] }, first: 20) { nodes { id identifier title url updatedAt state { name type } labels { nodes { name } } } } }`;
  const res = await linear.client.rawRequest(query, { term: queryText });
  json({ ok: true, sourceType: 'linear_live', collectedAt: now(), query: queryText, data: res.data });
}

async function apply(planPath) {
  const dryRun = process.argv.includes('--dry-run') || process.env.LINEAR_WRITE_MODE === 'dry-run';
  const confirmed = process.argv.includes('--confirmed');
  const allow = process.env.ALLOW_LINEAR_WRITES === 'true';
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (dryRun || !confirmed || !allow) {
    json({ ok: true, dryRun: true, reason: { dryRun, confirmed, allow }, writePlan: plan });
    return;
  }
  // Scaffold: implement exact mutations after validating your Linear schema fields.
  json({ ok: false, error: 'apply is intentionally scaffolded. Implement exact Linear mutations after schema validation.', writePlan: plan });
}

try {
  if (cmd === 'smoke') await smoke();
  else if (cmd === 'workspace') await workspace();
  else if (cmd === 'project') await project(process.argv[3]);
  else if (cmd === 'issues') await issues();
  else if (cmd === 'apply') await apply(process.argv[3]);
  else json({ ok: false, error: `unknown command ${cmd}` });
} catch (err) {
  json({ ok: false, error: err.message, stack: process.env.DEBUG ? err.stack : undefined });
  process.exit(1);
}
