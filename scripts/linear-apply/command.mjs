// @ts-check
import fs from 'node:fs';
import { json } from '../utils.mjs';
import { detectHostConfirmationCapabilities, resolveApplyMode } from '../write-plan-execution.mjs';
import { appendAudit, errorMessage } from './audit.mjs';
import { compileOperations, normalizeInput, opRefKey } from './normalize.mjs';
import { exactIssueLookup, mutate, readback } from './executor.mjs';
import { isCreate, normalizeType, parseWritePlan, SUPPORTED_WRITE_MODES, typeToKind } from './schema.mjs';
import { consumeWriteConfirmationArtifact } from '../write-confirmation-artifact.ts';

function argValue(argv, name, fallback = '') {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function withApprovalStorePath(artifactPath, run) {
  if (!artifactPath) return run();
  const previous = process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH;
  process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH = artifactPath;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH;
    else process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH = previous;
  }
}

function withApprovalSigningKey(env, run) {
  const previous = process.env.LINEAR_APPROVAL_PRIVATE_KEY;
  if (env.LINEAR_APPROVAL_PRIVATE_KEY !== undefined) {
    process.env.LINEAR_APPROVAL_PRIVATE_KEY = env.LINEAR_APPROVAL_PRIVATE_KEY;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.LINEAR_APPROVAL_PRIVATE_KEY;
    else process.env.LINEAR_APPROVAL_PRIVATE_KEY = previous;
  }
}

function approvalAuditRecord(result, source) {
  if (result.ok) {
    return {
      ok: true,
      source,
      writePlanPath: result.artifact.writePlanPath,
      idempotencyKey: result.artifact.idempotencyKey,
      planDigest: result.artifact.planDigest || null,
      confirmationId: result.artifact.confirmationId,
      expiresAt: result.artifact.expiresAt,
      signatureValid: true
    };
  }
  return {
    ok: false,
    source,
    reason: result.reason,
    message: result.message,
    writePlanPath: result.artifact?.writePlanPath || null,
    idempotencyKey: result.artifact?.idempotencyKey || null,
    planDigest: result.artifact?.planDigest || null,
    confirmationId: result.artifact?.confirmationId || null,
    expiresAt: result.artifact?.expiresAt || null,
    signatureValid: result.artifact?.signatureValid === true
  };
}

function optionalString(value) {
  return typeof value === 'string' ? value : undefined;
}

export async function applyPlanCommand(planPath, options) {
  if (!planPath) throw new Error('apply requires a write plan path.');
  const env = options.env || process.env;
  const argv = options.argv || process.argv;
  const mode = env.LINEAR_WRITE_MODE || 'dry-run';
  if (!SUPPORTED_WRITE_MODES.has(mode)) throw new Error(`Unsupported LINEAR_WRITE_MODE=${mode}. Supported: ${[...SUPPORTED_WRITE_MODES].join(', ')}`);

  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const cliDryRun = argv.includes('--dry-run');
  const cliConfirmed = argv.includes('--confirmed');
  const confirmationText = argValue(argv, '--confirmation-text', '');
  const confirmationId = argValue(argv, '--confirmation-id', '');
  const confirmationChannelOverride = argValue(argv, '--confirmation-channel', '');
  const approvalArtifactPath = argValue(argv, '--approval-artifact-path', env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH || '');
  const allow = env.ALLOW_LINEAR_WRITES === 'true';
  const hostCapabilities = detectHostConfirmationCapabilities(env, options.cwd || process.cwd());
  if (confirmationChannelOverride === 'ask_user') hostCapabilities.askUserAvailable = true;
  if (confirmationChannelOverride === 'conversation_fallback') {
    hostCapabilities.askUserAvailable = false;
    hostCapabilities.conversationFallbackAllowed = true;
  }
  if (confirmationChannelOverride === 'unavailable') hostCapabilities.conversationFallbackAllowed = false;

  const applyMode = resolveApplyMode({ mode, cliDryRun, cliConfirmed, allow, plan, confirmationText, confirmationId, writePlanPath: planPath, hostCapabilities });
  const dryRun = applyMode.dryRun;
  const effectivePlan = parseWritePlan(applyMode.effectivePlan, { dryRun });

  let consumedApproval = null;
  if (!dryRun) {
    consumedApproval = withApprovalSigningKey(env, () => withApprovalStorePath(approvalArtifactPath, () => consumeWriteConfirmationArtifact({
      writePlanPath: planPath,
      idempotencyKey: effectivePlan.idempotencyKey,
      planDigest: optionalString(effectivePlan.planDigest),
      confirmationId: optionalString(effectivePlan.confirmationId)
    })));
    const auditRecord = approvalAuditRecord(consumedApproval, approvalArtifactPath ? 'approval_artifact_path' : 'default_store');
    appendAudit({ type: 'linear_apply_artifact_validation', ...auditRecord });
    if (!consumedApproval.ok) {
      throw new Error(`approval artifact blocked: ${consumedApproval.message}`);
    }
  }

  const linear = options.client();
  const compiled = await compileOperations(linear, effectivePlan, {
    cachedWorkspaceObjectManifest: options.cachedWorkspaceObjectManifest,
    exactIssueLookup
  });

  if (dryRun) {
    json({
      ok: true,
      dryRun: true,
      mode,
      reason: applyMode.reason,
      confirmationChannel: applyMode.reason.confirmationChannel,
      confirmationSelfCheck: applyMode.confirmationSelfCheck,
      operations: compiled
    });
    return;
  }

  const refs = {};
  const results = [];
  const workspaceManifest = await options.cachedWorkspaceObjectManifest(linear, effectivePlan);
  const confirmation = {
    channel: effectivePlan.confirmationChannel || applyMode.reason.confirmationChannel.channel,
    fallbackReason: effectivePlan.confirmationFallbackReason || null,
    confirmationId: effectivePlan.confirmationId || null,
    confirmationText: effectivePlan.confirmationText || null,
    writePlanPath: planPath,
    idempotencyKey: effectivePlan.idempotencyKey
  };
  appendAudit({ type: 'linear_apply_start', idempotencyKey: effectivePlan.idempotencyKey, operationCount: effectivePlan.operations.length, dryRun: false, confirmation });

  try {
    for (const [index, rawOp] of effectivePlan.operations.entries()) {
      const op = { ...rawOp, planIdempotencyKey: effectivePlan.idempotencyKey };
      const type = normalizeType(op.type);
      const kind = typeToKind(type);
      const key = opRefKey(op, index);
      const metadata = {
        fieldTransforms: [],
        objectResolutions: [],
        objectFindings: [],
        workspaceManifest: workspaceManifest.manifest,
        workspaceManifestPath: workspaceManifest.manifestPath,
        issueExactLookup: identifierOrId => exactIssueLookup(linear, identifierOrId)
      };
      const input = await normalizeInput(linear, op, refs, index, metadata);
      if (isCreate(type) && input.id) refs[key] = { id: input.id, kind, pending: true };

      const mutationResult = await mutate(linear, op, input, refs);
      const entity = mutationResult.entity;
      if (entity?.id) refs[key] = { id: entity.id, kind, data: entity };
      const readbackEntity = entity?.id ? await readback(linear, kind, entity.id) : null;
      if (!readbackEntity && effectivePlan.readbackRequired !== false) throw new Error(`Readback failed for ${type} (${entity?.id || 'no-id'})`);

      const result = { index, key, type, kind, success: true, skipped: mutationResult.skipped, entity, readback: readbackEntity, fieldTransforms: metadata.fieldTransforms, resolutions: metadata.objectResolutions };
      results.push(result);
      appendAudit({ type: 'linear_apply_operation', idempotencyKey: effectivePlan.idempotencyKey, operation: { index, key, mutationType: type }, result });
    }
    appendAudit({ type: 'linear_apply_end', idempotencyKey: effectivePlan.idempotencyKey, success: true, resultCount: results.length, confirmation });
    json({ ok: true, dryRun: false, mode, idempotencyKey: effectivePlan.idempotencyKey, reason: applyMode.reason, confirmationSelfCheck: applyMode.confirmationSelfCheck, confirmation, results });
  } catch (err) {
    appendAudit({ type: 'linear_apply_end', idempotencyKey: effectivePlan.idempotencyKey, success: false, error: errorMessage(err), partialResults: results, confirmation });
    throw err;
  }
}
