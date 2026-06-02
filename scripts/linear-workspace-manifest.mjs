// @ts-check
import path from 'node:path';
import { hash, now, writeJson } from './utils.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function withoutVolatileManifestFields(manifest) {
  const copy = { ...(manifest || {}) };
  delete copy.collectedAt;
  delete copy.evidenceRef;
  delete copy.rawEvidenceRef;
  delete copy.manifestHash;
  if (copy.completeness && typeof copy.completeness === 'object') {
    copy.completeness = { ...copy.completeness };
    delete copy.completeness.checkedAt;
  }
  return stable(copy);
}

export function manifestHash(manifest) {
  return `sha256:${hash(withoutVolatileManifestFields(manifest))}`;
}

export function manifestIsIncomplete(manifest) {
  return manifest?.truncated === true || manifest?.completeness?.truncated === true || manifest?.completeness?.complete === false;
}

export async function collectConnectionNodes(client, {
  rootField,
  nodeSelection,
  variables = {},
  pageSize = 250,
  queryName = `Paginated${rootField}`,
  variableDefinitions = '',
  queryPrefix = '',
  querySuffix = ''
}) {
  const nodes = [];
  let after = null;
  while (true) {
    const query = `
      query ${queryName}($first: Int!, $after: String${variableDefinitions}) {
        ${queryPrefix}
          ${rootField}(first: $first, after: $after) {
            nodes { ${nodeSelection} }
            pageInfo { hasNextPage endCursor }
          }
        ${querySuffix}
      }`;
    const res = await client.rawRequest(query, { ...variables, first: pageSize, after });
    const container = queryPrefix ? Object.values(res.data || {})[0] : res.data;
    const connection = container?.[rootField];
    nodes.push(...(connection?.nodes || []));
    if (!connection?.pageInfo?.hasNextPage) break;
    after = connection.pageInfo.endCursor;
    if (!after) break;
  }
  return nodes;
}

export async function collectNestedConnectionNodes(client, {
  rootField,
  nestedField,
  rootSelection,
  nestedSelection,
  variables = {},
  pageSize = 100,
  queryName = `Paginated${rootField}${nestedField}`
}) {
  const rootNodes = await collectConnectionNodes(client, {
    rootField,
    nodeSelection: `${rootSelection} ${nestedField} { nodes { ${nestedSelection} } pageInfo { hasNextPage endCursor } }`,
    variables,
    pageSize,
    queryName
  });
  const incomplete = rootNodes.some(node => node?.[nestedField]?.pageInfo?.hasNextPage);
  return {
    rootNodes,
    nestedNodes: rootNodes.flatMap(node => (node?.[nestedField]?.nodes || []).map(child => ({ node, child }))),
    incomplete
  };
}

export function defaultPlanManifestPath(planPath, plan) {
  const base = path.basename(planPath || `${plan?.idempotencyKey || 'write-plan'}.json`, '.json');
  const dir = path.dirname(planPath || path.join('state', 'write-plans', base));
  return path.join(dir, `${base}-manifest.json`);
}

export function persistManifestSnapshot(manifest, manifestPath) {
  const snapshot = {
    ...(manifest || {}),
    evidenceRef: manifestPath,
    manifestHash: manifestHash(manifest)
  };
  writeJson(manifestPath, snapshot);
  return snapshot;
}

export function freezePlanManifest(planPath, plan, manifest, manifestPath, compiled) {
  if (!planPath || !manifest) return plan;
  const snapshotPath = manifestPath || defaultPlanManifestPath(planPath, plan);
  const snapshot = persistManifestSnapshot(manifest, snapshotPath);
  const resolutions = compiled.flatMap(operation =>
    (operation.resolutions || []).map(resolution => ({
      ...resolution,
      operationIndex: operation.index,
      operationKey: operation.key,
      path: resolution.path || resolution.locator?.path || null
    }))
  );
  const nextPlan = {
    ...plan,
    manifestHash: snapshot.manifestHash,
    manifestPath: snapshotPath,
    manifestCompleteness: snapshot.completeness || { complete: !manifestIsIncomplete(snapshot), truncated: manifestIsIncomplete(snapshot) },
    resolutions
  };
  const digestPlan = { ...nextPlan };
  delete digestPlan.planDigest;
  nextPlan.planDigest = `sha256:${hash(digestPlan)}`;
  writeJson(planPath, nextPlan);
  return nextPlan;
}

function compactResolution(resolution) {
  return {
    kind: resolution.kind || null,
    path: resolution.path || null,
    id: resolution.id || resolution.object?.id || null,
    locator: resolution.locator || null
  };
}

export function resolutionDiff(approved = [], current = []) {
  const approvedByKey = new Map(approved.map(item => [`${item.path || ''}:${item.kind || ''}:${JSON.stringify(item.locator || {})}`, compactResolution(item)]));
  const currentByKey = new Map(current.map(item => [`${item.path || ''}:${item.kind || ''}:${JSON.stringify(item.locator || {})}`, compactResolution(item)]));
  const changed = [];
  for (const [key, before] of approvedByKey) {
    const after = currentByKey.get(key);
    if (!after || before.id !== after.id) changed.push({ key, before, after: after || null });
  }
  for (const [key, after] of currentByKey) {
    if (!approvedByKey.has(key)) changed.push({ key, before: null, after });
  }
  return changed;
}

export function validateApplyManifest(plan, currentManifest, currentResolutions = []) {
  if (!currentManifest) {
    return {
      ok: true,
      approvedManifestHash: plan.manifestHash || null,
      currentManifestHash: null,
      resolutionDiff: []
    };
  }
  if (manifestIsIncomplete(currentManifest)) {
    return {
      ok: false,
      reason: 'manifest_incomplete',
      message: 'workspace manifest is incomplete; rerun workspace manifest pagination and dry-run before real apply.',
      approvedManifestHash: plan.manifestHash || null,
      currentManifestHash: currentManifest ? manifestHash(currentManifest) : null,
      resolutionDiff: resolutionDiff(plan.resolutions || [], currentResolutions)
    };
  }
  if (!plan.manifestHash) {
    return {
      ok: false,
      reason: 'manifest_hash_missing',
      message: 'manifestHash missing from approved write plan; rerun dry-run and approval before real apply.',
      approvedManifestHash: null,
      currentManifestHash: currentManifest ? manifestHash(currentManifest) : null,
      resolutionDiff: resolutionDiff(plan.resolutions || [], currentResolutions)
    };
  }
  const currentManifestHash = manifestHash(currentManifest);
  const diff = resolutionDiff(plan.resolutions || [], currentResolutions);
  if (plan.manifestHash !== currentManifestHash) {
    return {
      ok: false,
      reason: 'manifest_hash_mismatch',
      message: `manifestHash mismatch: approved ${plan.manifestHash}, current ${currentManifestHash}. Rerun dry-run and approval before real apply.`,
      approvedManifestHash: plan.manifestHash,
      currentManifestHash,
      resolutionDiff: diff
    };
  }
  if (diff.length) {
    return {
      ok: false,
      reason: 'resolution_diff',
      message: 'Linear object resolution changed since approval; rerun dry-run and approval before real apply.',
      approvedManifestHash: plan.manifestHash,
      currentManifestHash,
      resolutionDiff: diff
    };
  }
  return {
    ok: true,
    approvedManifestHash: plan.manifestHash,
    currentManifestHash,
    resolutionDiff: []
  };
}

export function manifestCompleteness(counts = {}, truncated = false) {
  return {
    complete: !truncated,
    truncated,
    counts,
    checkedAt: now()
  };
}
