// @ts-check
import fs from 'node:fs';
import { json } from '../utils.mjs';
import { detectHostConfirmationCapabilities, resolveApplyMode } from '../write-plan-execution.mjs';
import { appendAudit, errorMessage } from './audit.mjs';
import { compileOperations, normalizeInput, opRefKey, targetIdForUpdate } from './normalize.mjs';
import {
  connectLinearMcp,
  enrichCompiledOperationsForMcp,
  exactIssueLookupMcp,
  mutateMcp,
  readbackMcp,
  resolveWriteBackend
} from './mcp-adapter.mjs';
import {
  checkpointFailure,
  checkpointSuccess,
  completedOperation,
  initProgress,
  loadProgress,
  markProgressComplete,
  operationInputHash,
  planInputHash,
  progressPathFor,
  saveProgress
} from './progress.mjs';
import { normalizeType, parseWritePlan, SUPPORTED_WRITE_MODES, typeToKind } from './schema.mjs';
import { freezePlanManifest, validateApplyManifest } from '../linear-workspace-manifest.mjs';
import { verifyApplyReadback } from './readback-diff.mjs';
import { loadFinalValidationWorkspaceManifest } from './final-validation.mjs';

function argValue(argv, name, fallback = '') {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
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
  const progressPath = progressPathFor(env, effectivePlan.idempotencyKey);
  const currentPlanHash = planInputHash(effectivePlan);
  const existingProgress = !dryRun ? loadProgress(progressPath) : null;
  if (existingProgress && existingProgress.planHash !== currentPlanHash) {
    throw new Error('plan/input hash changed; run a new final validation and approval before applying this write plan.');
  }

  const writeBackend = resolveWriteBackend(env);
  const linear = options.client();
  const connectMcp = options.connectLinearMcp || connectLinearMcp;
  let mcpSession = null;
  if (!dryRun) {
    mcpSession = await connectMcp(env);
  }
  const exactIssueLookupFn = identifierOrId => {
    if (!mcpSession) return null;
    return exactIssueLookupMcp(mcpSession, identifierOrId);
  };

  const finalValidationManifest = !dryRun ? loadFinalValidationWorkspaceManifest(effectivePlan) : null;
  const finalValidation = /** @type {any} */ (effectivePlan).finalValidation || null;
  const compiled = await compileOperations(linear, effectivePlan, {
    cachedWorkspaceObjectManifest: options.cachedWorkspaceObjectManifest,
    workspaceManifestInfo: finalValidationManifest || undefined,
    exactIssueLookup: exactIssueLookupFn
  });
  const workspaceManifestInfo = /** @type {any} */ (compiled).workspaceManifestInfo || { manifest: null, manifestPath: null };

  if (dryRun) {
    const frozenPlan = freezePlanManifest(planPath, effectivePlan, workspaceManifestInfo.manifest, workspaceManifestInfo.manifestPath, compiled);
    const operations = enrichCompiledOperationsForMcp(compiled);
    appendAudit({
      type: 'linear_apply_manifest_compile',
      dryRun: true,
      writePlanPath: planPath,
      idempotencyKey: effectivePlan.idempotencyKey || null,
      manifestHash: frozenPlan.manifestHash || null,
      manifestPath: frozenPlan.manifestPath || workspaceManifestInfo.manifestPath || null,
      resolutionCount: frozenPlan.resolutions?.length || 0
    });
    json({
      ok: true,
      dryRun: true,
      mode,
      writeBackend,
      reason: applyMode.reason,
      confirmationChannel: applyMode.reason.confirmationChannel,
      confirmationSelfCheck: applyMode.confirmationSelfCheck,
      manifestHash: frozenPlan.manifestHash || null,
      manifestPath: frozenPlan.manifestPath || workspaceManifestInfo.manifestPath || null,
      resolutions: frozenPlan.resolutions || [],
      operations
    });
    return;
  }

  const currentResolutions = compiled.flatMap(operation => operation.resolutions || []);
  const manifestValidation = finalValidationManifest
    ? {
        ok: true,
        reason: 'final_validation_snapshot',
        approvedManifestHash: effectivePlan.manifestHash || finalValidation?.manifestHash || null,
        currentManifestHash: effectivePlan.manifestHash || finalValidation?.manifestHash || null,
        resolutionDiff: []
      }
    : validateApplyManifest(effectivePlan, workspaceManifestInfo.manifest, currentResolutions);
  appendAudit({
    type: 'linear_apply_manifest_validation',
    ok: manifestValidation.ok,
    source: finalValidationManifest ? 'final_validation_snapshot' : 'live_manifest_recheck',
    writePlanPath: planPath,
    idempotencyKey: effectivePlan.idempotencyKey || null,
    manifestPath: workspaceManifestInfo.manifestPath || null,
    approvedManifestHash: manifestValidation.approvedManifestHash || null,
    currentManifestHash: manifestValidation.currentManifestHash || null,
    resolutionDiff: manifestValidation.resolutionDiff || []
  });
  if (!manifestValidation.ok) {
    throw new Error(manifestValidation.message);
  }

  if (!existingProgress) {
    appendAudit({
      type: 'linear_apply_confirmation_validation',
      ok: true,
      source: effectivePlan.confirmationChannel || applyMode.reason.confirmationChannel.channel,
      writePlanPath: planPath,
      idempotencyKey: effectivePlan.idempotencyKey,
      confirmationId: effectivePlan.confirmationId || null
    });
  } else {
    appendAudit({
      type: 'linear_apply_confirmation_validation',
      ok: true,
      source: 'checkpoint_resume',
      writePlanPath: planPath,
      idempotencyKey: effectivePlan.idempotencyKey,
      progressPath,
      replayAction: 'reuse_checkpoint'
    });
  }

  const refs = {};
  const results = [];
  const progress = initProgress(existingProgress, {
    idempotencyKey: effectivePlan.idempotencyKey,
    planHash: currentPlanHash,
    writePlanPath: planPath
  });
  saveProgress(progressPath, progress);
  for (const [key, record] of Object.entries(progress.operations || {})) {
    if (record?.status === 'success' && record.ref?.id) refs[key] = record.ref;
  }
  const workspaceManifest = workspaceManifestInfo;
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
        issueExactLookup: exactIssueLookupFn
      };
      const input = await normalizeInput(op, refs, index, metadata);
      const inputHash = operationInputHash(op, input);
      const completed = completedOperation(progress, String(key), inputHash);
      if (completed) {
        if (completed.ref?.id) refs[String(key)] = completed.ref;
        const result = {
          index,
          key,
          type,
          kind,
          success: true,
          skipped: true,
          replayAction: 'skip_completed',
          entity: completed.entity || null,
          readback: completed.readback || completed.after || null,
          fieldTransforms: metadata.fieldTransforms,
          resolutions: metadata.objectResolutions
        };
        results.push(result);
        appendAudit({ type: 'linear_apply_operation', idempotencyKey: effectivePlan.idempotencyKey, operation: { index, key, mutationType: type }, replayAction: 'skip_completed', result });
        continue;
      }

      let before = null;
      let mutationResult = null;
      let entity = null;
      let readbackEntity = null;
      try {
        if (type === 'project.update' || type === 'issue.update') {
          before = await readbackMcp(mcpSession, kind, targetIdForUpdate(op, refs));
          if (!before && effectivePlan.readbackRequired !== false) throw new Error(`Before readback failed for ${type}`);
        }
        mutationResult = await mutateMcp(mcpSession, op, input, refs);
        entity = mutationResult.entity;
        readbackEntity = entity?.id ? await readbackMcp(mcpSession, kind, entity.id) : null;
        if (!readbackEntity && effectivePlan.readbackRequired !== false) throw new Error(`Readback failed for ${type} (${entity?.id || 'no-id'})`);
      } catch (err) {
        const failedResult = {
          index,
          key,
          type,
          kind,
          success: false,
          skipped: false,
          replayAction: 'failed',
          error: errorMessage(err),
          before,
          fieldTransforms: metadata.fieldTransforms,
          resolutions: metadata.objectResolutions
        };
        checkpointFailure(progress, String(key), {
          index,
          key,
          type,
          kind,
          inputHash,
          error: errorMessage(err),
          before,
          fieldTransforms: metadata.fieldTransforms,
          resolutions: metadata.objectResolutions
        });
        saveProgress(progressPath, progress);
        appendAudit({
          type: 'linear_apply_operation',
          idempotencyKey: effectivePlan.idempotencyKey,
          operation: { index, key, mutationType: type },
          replayAction: 'failed',
          result: failedResult
        });
        throw err;
      }

      const ref = entity?.id ? { id: entity.id, kind, data: entity } : null;
      if (ref) refs[key] = ref;

      const result = { index, key, type, kind, success: true, skipped: mutationResult.skipped, replayAction: mutationResult.skipped ? 'skip_existing' : 'new_mutation', entity, readback: readbackEntity, before, after: readbackEntity, fieldTransforms: metadata.fieldTransforms, resolutions: metadata.objectResolutions };
      results.push(result);
      checkpointSuccess(progress, String(key), {
        index,
        key,
        type,
        kind,
        inputHash,
        replayAction: result.replayAction,
        entity,
        readback: readbackEntity,
        before,
        after: readbackEntity,
        ref: ref || undefined,
        fieldTransforms: metadata.fieldTransforms,
        resolutions: metadata.objectResolutions
      });
      markProgressComplete(progress, effectivePlan.operations.length);
      saveProgress(progressPath, progress);
      appendAudit({ type: 'linear_apply_operation', idempotencyKey: effectivePlan.idempotencyKey, operation: { index, key, mutationType: type }, replayAction: result.replayAction, result });
    }
    const readbackDiff = await verifyApplyReadback(effectivePlan, results, {
      readback: (kind, id) => readbackMcp(mcpSession, kind, id),
      writePlanPath: planPath
    });
    appendAudit({ type: 'linear_apply_end', idempotencyKey: effectivePlan.idempotencyKey, success: true, resultCount: results.length, confirmation, readbackDiffOk: readbackDiff.ok });
    json({
      ok: true,
      dryRun: false,
      mode,
      writeBackend,
      idempotencyKey: effectivePlan.idempotencyKey,
      reason: applyMode.reason,
      confirmationSelfCheck: applyMode.confirmationSelfCheck,
      confirmation,
      readbackDiff,
      results
    });
  } catch (err) {
    appendAudit({ type: 'linear_apply_end', idempotencyKey: effectivePlan.idempotencyKey, success: false, error: errorMessage(err), partialResults: results, confirmation });
    throw err;
  } finally {
    if (mcpSession) await mcpSession.close();
  }
}
