// @ts-check
import { appendAudit } from './audit.mjs';
import { normalizeType, typeToKind } from './schema.mjs';

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function labelNames(entity) {
  return asArray(entity?.labels?.nodes).map(node => clean(node?.name)).filter(Boolean).sort();
}

function pushMismatch(mismatches, operationKey, field, expected, actual) {
  mismatches.push({
    operationKey,
    field,
    expected: expected ?? null,
    actual: actual ?? null
  });
}

function compareScalar(mismatches, operationKey, field, expected, actual) {
  const left = clean(expected) ?? expected ?? null;
  const right = clean(actual) ?? actual ?? null;
  if (left !== right) pushMismatch(mismatches, operationKey, field, left, right);
}

export function diffOperationAgainstReadback(operation, entity) {
  const operationKey = clean(operation.key) || operation.type || 'operation';
  const mismatches = [];
  const input = operation.input || {};
  const type = normalizeType(operation.type);

  if (!entity?.id) {
    pushMismatch(mismatches, operationKey, 'entity.id', 'present', entity?.id || null);
    return mismatches;
  }

  if (type === 'issue.create') {
    compareScalar(mismatches, operationKey, 'title', input.title, entity.title);
    compareScalar(mismatches, operationKey, 'description', input.description, entity.description);
    const expectedTeam = clean(input.teamId) || clean(input.teamKey);
    const actualTeam = clean(entity.team?.id) || clean(entity.team?.key) || clean(entity.project?.teams?.nodes?.[0]?.key);
    if (expectedTeam && actualTeam && expectedTeam !== actualTeam) {
      pushMismatch(mismatches, operationKey, 'team', expectedTeam, actualTeam);
    }
    const expectedLabels = asArray(input.labelNames).concat(asArray(input.labels).map(label => clean(label?.name) || label)).filter(Boolean).sort();
    if (expectedLabels.length) {
      const actualLabels = labelNames(entity);
      if (JSON.stringify(expectedLabels) !== JSON.stringify(actualLabels)) {
        pushMismatch(mismatches, operationKey, 'labels', expectedLabels.join(','), actualLabels.join(','));
      }
    }
  }

  if (type === 'issue.update') {
    for (const field of ['title', 'description', 'priority']) {
      if (input[field] !== undefined) compareScalar(mismatches, operationKey, field, input[field], entity[field]);
    }
    if (input.stateId && entity.state?.id && input.stateId !== entity.state.id) {
      pushMismatch(mismatches, operationKey, 'stateId', input.stateId, entity.state.id);
    }
  }

  if (type === 'projectUpdate.create') {
    compareScalar(mismatches, operationKey, 'body', input.body, entity.body);
    compareScalar(mismatches, operationKey, 'health', input.health, entity.health);
  }

  if (type === 'issueRelation.create') {
    compareScalar(mismatches, operationKey, 'type', input.type, entity.type);
    const expectedIssue = clean(input.issueId);
    const expectedRelated = clean(input.relatedIssueId);
    const actualIssue = clean(entity.issue?.id);
    const actualRelated = clean(entity.relatedIssue?.id);
    if (expectedIssue && actualIssue && expectedIssue !== actualIssue) {
      pushMismatch(mismatches, operationKey, 'issueId', expectedIssue, actualIssue);
    }
    if (expectedRelated && actualRelated && expectedRelated !== actualRelated) {
      pushMismatch(mismatches, operationKey, 'relatedIssueId', expectedRelated, actualRelated);
    }
  }

  return mismatches;
}

export async function verifyApplyReadback(plan, results, options = {}) {
  const readback = options.readback;
  const audit = options.appendAudit || appendAudit;
  const mismatches = [];

  for (const result of results || []) {
    if (!result?.success || result.skipped) continue;
    const operation = plan.operations?.[result.index];
    if (!operation) continue;

    const kind = typeToKind(normalizeType(operation.type));
    const entityId = result.readback?.id || result.entity?.id;
    if (!kind || !entityId) continue;

    let actual = result.readback || null;
    if (!actual && readback) {
      try {
        actual = await readback(kind, entityId);
      } catch {
        actual = null;
      }
    }
    if (!actual) continue;
    mismatches.push(...diffOperationAgainstReadback(operation, actual));
  }

  const ok = mismatches.length === 0;
  if (!ok) {
    audit({
      type: 'linear_apply_readback_diff_alert',
      ok: false,
      idempotencyKey: plan.idempotencyKey || null,
      writePlanPath: options.writePlanPath || null,
      mismatchCount: mismatches.length,
      mismatches
    });
  } else {
    audit({
      type: 'linear_apply_readback_diff',
      ok: true,
      idempotencyKey: plan.idempotencyKey || null,
      writePlanPath: options.writePlanPath || null,
      mismatchCount: 0
    });
  }

  return { ok, mismatches };
}
