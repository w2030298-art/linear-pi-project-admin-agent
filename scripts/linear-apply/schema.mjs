// @ts-check
import { z } from 'zod';

export const SUPPORTED_WRITE_MODES = new Set(['dry-run', 'confirmed-only']);

const CREATE_TYPES = new Set([
  'project.create',
  'projectMilestone.create',
  'milestone.create',
  'project.milestone.create',
  'issue.create',
  'issueRelation.create',
  'issue.relation.create',
  'projectRelation.create',
  'project.relation.create',
  'projectUpdate.create',
  'project.update.create',
  'comment.create'
]);

const objectInputSchema = z.record(z.string(), z.unknown());

export const writeOperationSchema = z.object({
  type: z.string().min(1),
  input: objectInputSchema.default({}),
  key: z.string().optional(),
  ref: z.string().optional(),
  operationKey: z.string().optional(),
  id: z.string().optional(),
  targetId: z.string().optional(),
  level: z.string().nullable().optional(),
  reason: z.string().nullable().optional()
}).passthrough();

export const writePlanSchema = z.object({
  operations: z.array(writeOperationSchema).min(1),
  idempotencyKey: z.string().min(1).optional(),
  confirmedByUser: z.boolean().optional(),
  confirmationText: z.string().optional(),
  confirmationChannel: z.string().optional(),
  confirmationFallbackReason: z.string().nullable().optional(),
  confirmationId: z.string().optional(),
  readbackRequired: z.boolean().optional(),
  auditLogRequired: z.boolean().optional()
}).passthrough();

/**
 * @param {unknown} type
 */
export function normalizeType(type) {
  return String(type || '').trim();
}

/**
 * @param {unknown} type
 */
export function typeToKind(type) {
  const t = normalizeType(type);
  if (t === 'project.create' || t === 'project.update') return 'project';
  if (t === 'projectMilestone.create' || t === 'milestone.create' || t === 'project.milestone.create') return 'projectMilestone';
  if (t === 'issue.create' || t === 'issue.update') return 'issue';
  if (t === 'issueRelation.create' || t === 'issue.relation.create') return 'issueRelation';
  if (t === 'projectRelation.create' || t === 'project.relation.create') return 'projectRelation';
  if (t === 'projectUpdate.create' || t === 'project.update.create') return 'projectUpdate';
  if (t === 'comment.create') return 'comment';
  return null;
}

/**
 * @param {unknown} type
 */
export function isCreate(type) {
  return CREATE_TYPES.has(normalizeType(type));
}

/**
 * @param {unknown} plan
 * @param {{ dryRun: boolean }} options
 */
export function parseWritePlan(plan, options) {
  const parsed = writePlanSchema.safeParse(plan);
  if (!parsed.success) {
    throw new Error(`Write plan schema validation failed: ${parsed.error.issues.map(issue => `${issue.path.join('.') || '$'} ${issue.message}`).join('; ')}`);
  }

  const effectivePlan = parsed.data;
  for (const [index, op] of effectivePlan.operations.entries()) {
    if (!typeToKind(op.type)) throw new Error(`operations[${index}] unsupported type: ${op.type}`);
    const input = op.input || {};
    if (/^issue\.(create|update)$/.test(normalizeType(op.type)) && input.cycleId) {
      throw new Error(`operations[${index}].input.cycleId is not supported by this agent write schema.`);
    }
  }

  if (!options.dryRun) {
    if (!effectivePlan.idempotencyKey) throw new Error('idempotencyKey is required for non-dry-run apply.');
    if (effectivePlan.confirmedByUser !== true) throw new Error('confirmedByUser=true is required for non-dry-run apply.');
    if (!effectivePlan.confirmationText) throw new Error('confirmationText is required for non-dry-run apply.');
    if (effectivePlan.confirmationChannel === 'conversation_fallback') {
      const text = String(effectivePlan.confirmationText || '');
      for (const required of ['Fallback reason:', 'User approval:', 'Write plan:', 'Idempotency key:']) {
        if (!text.includes(required)) throw new Error(`conversation fallback confirmationText must include "${required}"`);
      }
    }
    if (effectivePlan.readbackRequired === false) throw new Error('readbackRequired=false is not allowed for non-dry-run apply.');
    if (effectivePlan.auditLogRequired === false) throw new Error('auditLogRequired=false is not allowed for non-dry-run apply.');
  }

  return effectivePlan;
}
