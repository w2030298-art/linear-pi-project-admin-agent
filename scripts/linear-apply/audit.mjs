// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, now } from '../utils.mjs';

/**
 * @param {unknown} value
 * @returns {string}
 */
export function errorMessage(value) {
  return value instanceof Error ? value.message : String(value);
}

/**
 * @param {unknown} value
 */
export function redacted(value) {
  if (Array.isArray(value)) return value.map(redacted);
  if (!value || typeof value !== 'object') return value;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = /token|secret|password|apiKey|privateKey|authorization/i.test(key) ? '[REDACTED]' : redacted(entry);
  }
  return out;
}

/**
 * @param {Record<string, unknown>} entry
 */
export function appendAudit(entry) {
  const auditPath = process.env.AUDIT_LOG_PATH || 'state/audit.jsonl';
  ensureDir(path.dirname(auditPath));
  fs.appendFileSync(auditPath, JSON.stringify(redacted({ ts: now(), ...entry })) + '\n');
}

/**
 * @param {string} fallback
 * @param {unknown} error
 * @param {Record<string, unknown>} [context]
 */
export function appendAuditWarning(fallback, error, context = {}) {
  appendAudit({ type: 'linear_apply_warning', fallback, error: errorMessage(error), ...context });
}
