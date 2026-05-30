function clean(value) {
  return String(value || '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function evidenceRef(manifest, fallback = 'workspace-project-statuses') {
  return manifest?.evidenceRef || manifest?.rawEvidenceRef || fallback;
}

function compact(status) {
  return {
    id: status.id || null,
    name: status.name || null,
    type: status.type || null,
    semanticType: semanticProjectStatus(status)
  };
}

export function semanticProjectStatus(status) {
  const type = lower(status?.type);
  const name = lower(status?.name).replace(/[-_]+/g, ' ');
  const value = `${type} ${name}`.trim();
  if (/\b(paused|pause|on hold|blocked|frozen|freeze)\b/.test(value)) return 'paused';
  if (/\b(started|active|in progress|on track)\b/.test(value)) return 'started';
  if (/\b(completed|complete|done)\b/.test(value)) return 'completed';
  if (/\b(canceled|cancelled)\b/.test(value)) return 'canceled';
  return type || null;
}

export function listProjectStatuses(manifest = {}) {
  return asArray(manifest.projectStatuses).map(status => compact(status));
}

export function resolveProjectStatus(manifest = {}, { intent } = {}) {
  const requested = lower(intent);
  const ref = evidenceRef(manifest);
  const statuses = listProjectStatuses(manifest);
  const candidates = statuses.filter(status => status.semanticType === requested);
  if (candidates.length === 1) {
    return {
      ok: true,
      kind: 'projectStatus',
      intent: requested,
      id: candidates[0].id,
      object: candidates[0],
      evidenceRef: ref,
      chain: [
        { source: 'workspaceProjectStatuses', evidenceRef: ref },
        { source: 'semanticType', intent: requested, matched: candidates[0].semanticType }
      ]
    };
  }
  return {
    ok: false,
    kind: 'projectStatus',
    intent: requested,
    code: candidates.length ? 'project_status_ambiguous' : 'project_status_absent',
    blocking: candidates.length > 1,
    message: candidates.length
      ? `Project status ${requested} matched multiple candidates.`
      : `Project status ${requested} is not available in workspace manifest.`,
    evidenceRef: ref,
    candidates
  };
}

export function resolveProjectStatusById(manifest = {}, statusId = '') {
  const id = clean(statusId);
  const ref = evidenceRef(manifest);
  const statuses = listProjectStatuses(manifest);
  const candidate = statuses.find(status => status.id === id);
  if (candidate) {
    return {
      ok: true,
      kind: 'projectStatus',
      intent: candidate.semanticType,
      id: candidate.id,
      object: candidate,
      evidenceRef: ref,
      chain: [
        { source: 'workspaceProjectStatuses', evidenceRef: ref },
        { source: 'statusId', id }
      ]
    };
  }
  return {
    ok: false,
    kind: 'projectStatus',
    intent: null,
    code: 'project_status_unknown_id',
    blocking: true,
    message: `Project statusId is not present in workspace manifest: ${id}`,
    evidenceRef: ref,
    candidates: statuses
  };
}
