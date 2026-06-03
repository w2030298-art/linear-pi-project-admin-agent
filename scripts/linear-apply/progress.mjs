// @ts-check
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, now } from '../utils.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

export function stableHash(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')}`;
}

function safeId(value) {
  return String(value || 'missing-idempotency-key').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 120);
}

export function progressPathFor(env, idempotencyKey) {
  return env.LINEAR_APPLY_PROGRESS_PATH || path.join('state', 'linear-apply-progress', `${safeId(idempotencyKey)}.json`);
}

export function planInputHash(plan) {
  return stableHash({
    idempotencyKey: plan.idempotencyKey || null,
    operations: plan.operations || []
  });
}

export function operationInputHash(op, input) {
  return stableHash({
    type: op.type,
    key: op.key || op.ref || op.operationKey || op.id || null,
    targetId: op.targetId || null,
    input
  });
}

export function loadProgress(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function initProgress(existing, { idempotencyKey, planHash, writePlanPath }) {
  if (existing) {
    if (existing.planHash !== planHash) {
      throw new Error('plan/input hash changed; run a new dry-run and approval before applying this write plan.');
    }
    return existing;
  }
  return {
    version: 1,
    idempotencyKey,
    planHash,
    writePlanPath,
    status: 'in_progress',
    createdAt: now(),
    updatedAt: now(),
    operations: {}
  };
}

export function saveProgress(file, progress) {
  ensureDir(path.dirname(file));
  progress.updatedAt = now();
  fs.writeFileSync(file, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
}

export function completedOperation(progress, key, inputHash) {
  const record = progress.operations?.[key];
  if (!record || record.status !== 'success') return null;
  if (record.inputHash !== inputHash) {
    throw new Error(`plan/input hash changed for operation ${key}; run a new dry-run and approval before replay.`);
  }
  return record;
}

export function checkpointSuccess(progress, key, record) {
  progress.operations[key] = {
    ...record,
    status: 'success',
    completedAt: now()
  };
}

export function checkpointFailure(progress, key, record) {
  progress.status = 'failed';
  progress.operations[key] = {
    ...record,
    status: 'failed',
    failedAt: now()
  };
}

export function markProgressComplete(progress, operationCount) {
  const successes = Object.values(progress.operations || {}).filter(op => op?.status === 'success').length;
  if (successes >= operationCount) progress.status = 'success';
}
