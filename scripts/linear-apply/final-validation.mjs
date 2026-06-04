// @ts-check
import fs from 'node:fs';
import { appendAudit, errorMessage } from './audit.mjs';
import {
  buildMcpToolArguments,
  mcpOperationSemanticFindings,
  operationToMcpTool,
  resolveWriteBackend
} from './mcp-adapter.mjs';
import { compileOperations } from './normalize.mjs';
import { parseWritePlan } from './schema.mjs';
import { freezePlanFinalValidation, manifestHash } from '../linear-workspace-manifest.mjs';
import { reviewWritePlan } from '../plan-reviewer.mjs';
import { detectHostConfirmationCapabilities } from '../write-plan-execution.mjs';
import { json, now } from '../utils.mjs';

function finding(code, message, options = {}) {
  return {
    code,
    severity: options.severity || 'error',
    blocking: options.blocking !== false,
    path: options.path || '$',
    message
  };
}

function finishFailure(planPath, findings, extra = {}) {
  return {
    ok: false,
    status: 'needs_revision',
    kind: 'write_plan_final_validation',
    target: planPath,
    executedMutation: false,
    reviewedAt: now(),
    findings,
    ...extra
  };
}

function finalValidationConfirmationRequest(planPath, plan, operations) {
  const operationsSummary = operations
    .map(operation => `- ${operation.type}: ${operation.input?.title || operation.input?.body || operation.key}`)
    .join('\n');
  return {
    flow: 'plan_confirmation',
    writePlanPath: planPath,
    idempotencyKey: plan.idempotencyKey,
    targetProjectSummary: plan.targetProject?.name || plan.targetProjectId || plan.projectId || '',
    operationsSummary,
    risksSummary: 'Final validation passed; real apply still requires one approval, readback diff, and audit.',
    nonChangesSummary: 'No mutation was performed during final validation.'
  };
}

function finalValidationNextToolCalls(planPath, plan, operations) {
  const confirmationRequest = finalValidationConfirmationRequest(planPath, plan, operations);
  return [
    {
      name: 'linear_validate_and_apply_write_plan',
      params: {
        ...confirmationRequest,
        writePlanPath: planPath,
        idempotencyKey: plan.idempotencyKey,
        dryRun: false
      }
    }
  ];
}

function confirmationSelfCheck(env, cwd) {
  const hostCapabilities = detectHostConfirmationCapabilities(env, cwd);
  const piAskUserAvailable = hostCapabilities.piAskUserAvailable === true;
  return {
    phase: 'final_validation',
    piAskUserPlanConfirmationAvailable: piAskUserAvailable,
    nextAction: piAskUserAvailable
      ? 'Call linear_validate_and_apply_write_plan once; it will rerun final validation, show pi_ask_user(flow=plan_confirmation), and apply immediately if approved.'
      : 'Real apply is blocked until plan_confirmation UI is available through linear_validate_and_apply_write_plan or the user explicitly allows conversation_fallback.'
  };
}

function mcpMappingFindings(operations) {
  const findings = [];
  operations.forEach((operation, index) => {
    if (!operation.mcpTool) {
      findings.push(finding(
        'write_plan_mcp_mapping_missing',
        `operations[${index}] type ${operation.type} is not supported by the Linear MCP write adapter.`,
        { path: `$.operations[${index}].type` }
      ));
    }
    if (operation.mcpTool && (!operation.mcpArguments || Object.keys(operation.mcpArguments).length === 0)) {
      findings.push(finding(
        'write_plan_mcp_arguments_missing',
        `operations[${index}] type ${operation.type} did not compile to MCP arguments.`,
        { path: `$.operations[${index}].input` }
      ));
    }
    if (operation.mcpArgumentError) {
      findings.push(finding(
        'write_plan_mcp_arguments_invalid',
        `operations[${index}] type ${operation.type} failed MCP argument compile: ${operation.mcpArgumentError}`,
        { path: `$.operations[${index}].input` }
      ));
    }
    for (const message of mcpOperationSemanticFindings(operation, index)) {
      findings.push(finding(
        'write_plan_mcp_arguments_semantic',
        message,
        { path: `$.operations[${index}].mcpArguments` }
      ));
    }
  });
  return findings;
}

function enrichCompiledOperationsForFinalValidation(compiled) {
  return compiled.map(operation => {
    const mcpTool = operationToMcpTool(operation.type);
    let mcpArguments = null;
    let mcpArgumentError = null;
    if (mcpTool) {
      try {
        mcpArguments = buildMcpToolArguments(operation.type, operation.input);
      } catch (err) {
        mcpArgumentError = errorMessage(err);
      }
    }
    return {
      ...operation,
      mcpTool,
      mcpArguments,
      ...(mcpArgumentError ? { mcpArgumentError } : {})
    };
  });
}

export function hasPassingFinalValidation(plan) {
  return plan?.finalValidation?.status === 'pass' &&
    plan?.finalValidation?.validationKind === 'single_final';
}

export function loadFinalValidationWorkspaceManifest(plan) {
  if (!hasPassingFinalValidation(plan)) return null;
  const manifestPath = plan.manifestPath || plan.finalValidation.manifestPath;
  if (!manifestPath) throw new Error('finalValidation is present but manifestPath is missing; rerun linear_validate_and_apply_write_plan or diagnostic validate-write-plan.');
  if (!fs.existsSync(manifestPath)) throw new Error(`final validation manifest snapshot is missing: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expectedHash = plan.manifestHash || plan.finalValidation.manifestHash;
  const actualHash = manifestHash(manifest);
  if (expectedHash && expectedHash !== actualHash) {
    throw new Error(`final validation manifest snapshot hash mismatch: approved ${expectedHash}, snapshot ${actualHash}. Rerun linear_validate_and_apply_write_plan or diagnostic validate-write-plan.`);
  }
  return { manifest, manifestPath };
}

export async function validateWritePlanCommand(planPath, options = {}) {
  if (!planPath) throw new Error('validate-write-plan requires a write plan path.');
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const emitJson = options.emitJson !== false;
  const writeBackend = resolveWriteBackend(env);
  const rawPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

  let effectivePlan;
  try {
    effectivePlan = parseWritePlan(rawPlan, { dryRun: true });
  } catch (err) {
    const result = finishFailure(planPath, [
      finding('write_plan_schema_invalid', errorMessage(err))
    ]);
    appendAudit({ type: 'linear_write_plan_final_validation', ok: false, writePlanPath: planPath, error: errorMessage(err) });
    if (emitJson) json(result);
    return result;
  }

  let compiled;
  try {
    const linear = options.client();
    compiled = await compileOperations(linear, effectivePlan, {
      cachedWorkspaceObjectManifest: options.cachedWorkspaceObjectManifest,
      exactIssueLookup: options.exactIssueLookup || (() => null)
    });
  } catch (err) {
    const result = finishFailure(planPath, [
      finding('write_plan_compile_failed', errorMessage(err))
    ], { idempotencyKey: effectivePlan.idempotencyKey || null });
    appendAudit({
      type: 'linear_write_plan_final_validation',
      ok: false,
      writePlanPath: planPath,
      idempotencyKey: effectivePlan.idempotencyKey || null,
      error: errorMessage(err)
    });
    if (emitJson) json(result);
    return result;
  }

  const workspaceManifestInfo = /** @type {any} */ (compiled).workspaceManifestInfo || { manifest: null, manifestPath: null };
  const operations = enrichCompiledOperationsForFinalValidation(compiled);
  const review = /** @type {any} */ (reviewWritePlan(effectivePlan, {
    target: planPath,
    workspaceManifest: workspaceManifestInfo.manifest
  }));
  const findings = [
    ...review.findings,
    ...mcpMappingFindings(operations)
  ];
  if (findings.some(item => item.blocking)) {
    const result = finishFailure(planPath, findings, {
      idempotencyKey: effectivePlan.idempotencyKey || null,
      resolutions: review.resolutions || [],
      operations
    });
    appendAudit({
      type: 'linear_write_plan_final_validation',
      ok: false,
      writePlanPath: planPath,
      idempotencyKey: effectivePlan.idempotencyKey || null,
      findingCount: findings.length
    });
    if (emitJson) json(result);
    return result;
  }

  const finalValidation = {
    validationKind: 'single_final',
    status: 'pass',
    validatedAt: now(),
    writeBackend,
    operationCount: operations.length,
    operationTypes: operations.map(operation => operation.type),
    mcpTools: operations.map(operation => operation.mcpTool).filter(Boolean)
  };
  const frozenPlan = freezePlanFinalValidation(
    planPath,
    effectivePlan,
    workspaceManifestInfo.manifest,
    workspaceManifestInfo.manifestPath,
    compiled,
    finalValidation
  );
  const result = {
    ok: true,
    status: 'pass',
    kind: 'write_plan_final_validation',
    target: planPath,
    executedMutation: false,
    reviewedAt: now(),
    writePlanPath: planPath,
    idempotencyKey: effectivePlan.idempotencyKey || null,
    writeBackend,
    finalValidation: frozenPlan.finalValidation,
    manifestHash: frozenPlan.manifestHash || null,
    manifestPath: frozenPlan.manifestPath || null,
    resolutions: frozenPlan.resolutions || [],
    operations,
    confirmationRequest: finalValidationConfirmationRequest(planPath, effectivePlan, operations),
    confirmationSelfCheck: confirmationSelfCheck(env, cwd),
    nextToolCalls: finalValidationNextToolCalls(planPath, effectivePlan, operations),
    findings
  };
  appendAudit({
    type: 'linear_write_plan_final_validation',
    ok: true,
    writePlanPath: planPath,
    idempotencyKey: effectivePlan.idempotencyKey || null,
    operationCount: operations.length,
    manifestHash: result.manifestHash,
    resolutionCount: result.resolutions.length
  });
  if (emitJson) json(result);
  return result;
}
