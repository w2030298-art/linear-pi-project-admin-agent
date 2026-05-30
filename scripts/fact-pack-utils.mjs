import path from 'node:path';
import { ensureDir, now, readJson, writeJson } from './utils.mjs';

const EVIDENCE_ROOT = 'state/fact-packs/evidence';

function cleanSegment(value) {
  return String(value || 'evidence')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'evidence';
}

function countNodes(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value.nodes)) return value.nodes.length;
  return null;
}

function summarizeObject(value, depth = 0) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return String(value).slice(0, 180);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (depth >= 2) return `object(${Object.keys(value).length} keys)`;

  const parts = [];
  for (const [key, child] of Object.entries(value).slice(0, 14)) {
    const nodeCount = countNodes(child);
    if (nodeCount !== null) parts.push(`${key}: ${Array.isArray(child) ? 'array' : 'nodes'}(${nodeCount})`);
    else if (child && typeof child === 'object') parts.push(`${key}: ${summarizeObject(child, depth + 1)}`);
    else if (child !== null && child !== undefined && child !== '') parts.push(`${key}: ${String(child).slice(0, 80)}`);
  }
  return parts.join('; ');
}

function nodes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.nodes)) return value.nodes;
  return [];
}

function projectFromEvidence(raw) {
  return raw?.data?.project || raw?.project || null;
}

function latestTimestamp(values) {
  const timestamps = values
    .filter(Boolean)
    .map(value => Date.parse(value))
    .filter(value => Number.isFinite(value));
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function hasField(value, fieldPath) {
  let cursor = value;
  for (const part of fieldPath.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) return false;
    cursor = cursor[part];
  }
  return cursor !== undefined && cursor !== null && cursor !== '';
}

export function evidenceStorePathForFactPack(factPackId, evidenceKey) {
  return path.posix.join(EVIDENCE_ROOT, cleanSegment(factPackId), `${cleanSegment(evidenceKey)}.json`);
}

export function summarizeEvidence(raw) {
  if (!raw || typeof raw !== 'object') return String(raw || '');
  const project = raw.data?.project || raw.project;
  if (project) {
    const issues = countNodes(project.issues) ?? 0;
    const milestones = countNodes(project.projectMilestones) ?? 0;
    const updates = countNodes(project.projectUpdates) ?? 0;
    const docs = countNodes(project.documents) ?? 0;
    return [
      `project=${project.name || project.id || 'unknown'}`,
      `issues=${issues}`,
      `milestones=${milestones}`,
      `updates=${updates}`,
      `documents=${docs}`,
      project.state ? `state=${project.state}` : null,
      project.updatedAt ? `updatedAt=${project.updatedAt}` : null
    ].filter(Boolean).join('; ');
  }
  return summarizeObject(raw);
}

export function buildProjectBaselineFromEvidence(raw, { evidenceRef = null } = {}) {
  const project = projectFromEvidence(raw);
  if (!project) return null;

  const issues = nodes(project.issues);
  const milestones = nodes(project.projectMilestones);
  const updates = nodes(project.projectUpdates);
  const documents = nodes(project.documents);
  const collectedAt = raw?.collectedAt || raw?.timestamp || now();

  return {
    kind: 'linear_project_baseline',
    collectedAt,
    rawEvidenceRef: evidenceRef,
    project: {
      id: project.id || null,
      name: project.name || null,
      url: project.url || null,
      state: project.state || null,
      description: project.description || null,
      updatedAt: project.updatedAt || null,
      startDate: project.startDate || null,
      targetDate: project.targetDate || null
    },
    counts: {
      issues: issues.length,
      milestones: milestones.length,
      updates: updates.length,
      documents: documents.length
    },
    latestUpdatedAt: latestTimestamp([
      project.updatedAt,
      ...issues.map(issue => issue.updatedAt),
      ...milestones.map(milestone => milestone.updatedAt),
      ...updates.map(update => update.updatedAt || update.createdAt),
      ...documents.map(document => document.updatedAt)
    ]),
    issueSample: issues.slice(0, 12).map(issue => ({
      identifier: issue.identifier || null,
      title: issue.title || null,
      state: issue.state?.name || issue.state || null,
      stateType: issue.state?.type || null,
      updatedAt: issue.updatedAt || null
    })),
    milestoneSample: milestones.slice(0, 8).map(milestone => ({
      id: milestone.id || null,
      name: milestone.name || null,
      targetDate: milestone.targetDate || null,
      updatedAt: milestone.updatedAt || null
    })),
    updateSample: updates.slice(0, 5).map(update => ({
      id: update.id || null,
      createdAt: update.createdAt || null,
      updatedAt: update.updatedAt || null,
      health: update.health || null
    }))
  };
}

export function buildEvidenceBackedFact({
  claim,
  sourceType,
  source,
  confidence = 'medium',
  raw,
  factPackId,
  evidenceKey,
  timestamp = now()
}) {
  return {
    claim,
    sourceType,
    source,
    confidence,
    rawRef: null,
    evidenceRef: evidenceStorePathForFactPack(factPackId, evidenceKey),
    summary: summarizeEvidence(raw),
    timestamp
  };
}

export function writeEvidenceFile(factPackId, evidenceKey, raw) {
  const outPath = evidenceStorePathForFactPack(factPackId, evidenceKey);
  ensureDir(path.dirname(outPath));
  writeJson(outPath, raw);
  return outPath;
}

export function compactFactPack(pack) {
  const evidenceRefs = new Map();
  let projectBaseline = pack.projectBaseline || null;
  const compactFacts = (pack.facts || []).map(fact => {
    if (fact.evidenceRef) {
      evidenceRefs.set(fact.evidenceRef, {
        sourceType: fact.sourceType,
        source: fact.source,
        path: fact.evidenceRef,
        summary: fact.summary || null
      });
      if (!projectBaseline && fact.sourceType === 'linear_live') {
        const raw = readJson(fact.evidenceRef);
        projectBaseline = buildProjectBaselineFromEvidence(raw, { evidenceRef: fact.evidenceRef });
      }
    }
    return {
      ...fact,
      rawRef: null
    };
  });
  return {
    ...pack,
    facts: compactFacts,
    projectBaseline,
    evidenceManifest: [...evidenceRefs.values()]
  };
}

export function loadProjectBaselineFromFactPack(factPackPath, {
  now: nowIso = new Date().toISOString(),
  maxAgeMs = 24 * 60 * 60 * 1000,
  requiredFields = ['project.id', 'counts.issues', 'rawEvidenceRef']
} = {}) {
  const pack = readJson(factPackPath);
  if (!pack) {
    return {
      status: 'absent',
      shouldReadLive: true,
      reason: `Fact Pack not found: ${factPackPath}`,
      baseline: null,
      evidenceRef: null,
      rawEvidencePath: null
    };
  }

  const linearFact = (pack.facts || []).find(fact => fact.sourceType === 'linear_live' && fact.evidenceRef);
  const evidenceRef = pack.projectBaseline?.rawEvidenceRef || linearFact?.evidenceRef || null;
  let baseline = pack.projectBaseline || null;
  if (!baseline && evidenceRef) {
    baseline = buildProjectBaselineFromEvidence(readJson(evidenceRef), { evidenceRef });
  }

  if (!baseline) {
    return {
      status: 'absent',
      shouldReadLive: true,
      reason: 'No reusable Project baseline or Linear Project evidenceRef found in Fact Pack.',
      baseline: null,
      evidenceRef,
      rawEvidencePath: evidenceRef ? path.resolve(evidenceRef) : null
    };
  }

  const missingFields = requiredFields.filter(field => !hasField(baseline, field));
  if (missingFields.length) {
    return {
      status: 'insufficient',
      shouldReadLive: true,
      reason: `Project baseline missing required field(s): ${missingFields.join(', ')}`,
      baseline,
      evidenceRef: baseline.rawEvidenceRef || evidenceRef,
      rawEvidencePath: baseline.rawEvidenceRef ? path.resolve(baseline.rawEvidenceRef) : null
    };
  }

  const collectedAt = Date.parse(baseline.collectedAt || pack.createdAt);
  const current = Date.parse(nowIso);
  if (Number.isFinite(collectedAt) && Number.isFinite(current) && current - collectedAt > maxAgeMs) {
    return {
      status: 'stale',
      shouldReadLive: true,
      reason: `Project baseline is stale: collectedAt=${new Date(collectedAt).toISOString()}`,
      baseline,
      evidenceRef: baseline.rawEvidenceRef || evidenceRef,
      rawEvidencePath: baseline.rawEvidenceRef ? path.resolve(baseline.rawEvidenceRef) : null
    };
  }

  return {
    status: 'present',
    shouldReadLive: false,
    reason: 'Reusable Project baseline loaded from Fact Pack evidenceRef.',
    baseline,
    evidenceRef: baseline.rawEvidenceRef || evidenceRef,
    rawEvidencePath: baseline.rawEvidenceRef ? path.resolve(baseline.rawEvidenceRef) : null
  };
}
