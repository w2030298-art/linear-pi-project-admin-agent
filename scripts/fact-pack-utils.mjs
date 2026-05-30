import path from 'node:path';
import { ensureDir, now, writeJson } from './utils.mjs';

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
  const compactFacts = (pack.facts || []).map(fact => {
    if (fact.evidenceRef) {
      evidenceRefs.set(fact.evidenceRef, {
        sourceType: fact.sourceType,
        source: fact.source,
        path: fact.evidenceRef,
        summary: fact.summary || null
      });
    }
    return {
      ...fact,
      rawRef: null
    };
  });
  return {
    ...pack,
    facts: compactFacts,
    evidenceManifest: [...evidenceRefs.values()]
  };
}
