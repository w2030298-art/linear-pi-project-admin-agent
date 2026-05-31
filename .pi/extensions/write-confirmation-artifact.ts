import crypto from "node:crypto";

export interface WriteConfirmationArtifact {
  writePlanPath: string;
  idempotencyKey: string;
  planDigest?: string;
  confirmationId: string;
  confirmationText: string;
  confirmationChannel: "ask_user";
  approved: true;
  consumed: boolean;
  createdAt: string;
}

export interface WriteConfirmationApplyParams {
  writePlanPath: string;
  idempotencyKey?: string;
  planDigest?: string;
  confirmationId?: string;
  confirmationText?: string;
  confirmationChannel?: string;
  confirmedByUser?: boolean;
}

const pendingArtifacts = new Map<string, WriteConfirmationArtifact>();

function artifactKey(writePlanPath: string, idempotencyKey: string) {
  return `${writePlanPath.trim()}::${idempotencyKey.trim()}`;
}

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function resetWriteConfirmationArtifactsForTests() {
  pendingArtifacts.clear();
}

export function buildWriteConfirmationText(input: {
  writePlanPath: string;
  idempotencyKey: string;
  targetProjectSummary?: string;
  operationsSummary?: string;
  risksSummary?: string;
  nonChangesSummary?: string;
  planDigest?: string;
}) {
  const lines = [
    "Confirmation channel: pi_ask_user write_confirmation approve/cancel UI.",
    "User approval: ask_user approved the exact dry-run write plan.",
    `Write plan: ${input.writePlanPath}`,
    `Idempotency key: ${input.idempotencyKey}`
  ];
  if (input.targetProjectSummary) lines.push(`Target project: ${input.targetProjectSummary}`);
  if (input.operationsSummary) lines.push(`Operations: ${input.operationsSummary}`);
  if (input.risksSummary) lines.push(`Risks: ${input.risksSummary}`);
  if (input.nonChangesSummary) lines.push(`Non-changes: ${input.nonChangesSummary}`);
  if (input.planDigest) lines.push(`Plan digest: ${input.planDigest}`);
  return lines.join("\n");
}

export function buildWriteConfirmationMessage(input: {
  writePlanPath: string;
  idempotencyKey: string;
  targetProjectSummary?: string;
  operationsSummary?: string;
  risksSummary?: string;
  nonChangesSummary?: string;
  planDigest?: string;
}) {
  const sections = [
    "Review the exact dry-run write plan before approving.",
    `Write plan: ${input.writePlanPath}`,
    `Idempotency key: ${input.idempotencyKey}`
  ];
  if (input.targetProjectSummary) sections.push(`Target project: ${input.targetProjectSummary}`);
  if (input.operationsSummary) sections.push(`Operations:\n${input.operationsSummary}`);
  if (input.risksSummary) sections.push(`Risks:\n${input.risksSummary}`);
  if (input.nonChangesSummary) sections.push(`Non-changes:\n${input.nonChangesSummary}`);
  if (input.planDigest) sections.push(`Plan digest: ${input.planDigest}`);
  sections.push("Choose Approve to continue to linear_apply_write_plan, or Cancel to keep dry-run only.");
  return sections.join("\n\n");
}

export function registerWriteConfirmationArtifact(input: {
  writePlanPath: string;
  idempotencyKey: string;
  planDigest?: string;
  confirmationText: string;
  confirmationId?: string;
}) {
  const writePlanPath = clean(input.writePlanPath);
  const idempotencyKey = clean(input.idempotencyKey);
  if (!writePlanPath || !idempotencyKey) {
    throw new Error("write_confirmation requires writePlanPath and idempotencyKey.");
  }

  const key = artifactKey(writePlanPath, idempotencyKey);
  const existing = pendingArtifacts.get(key);
  if (existing && !existing.consumed) {
    throw new Error("write_confirmation already pending for this exact write plan and idempotencyKey.");
  }

  const artifact: WriteConfirmationArtifact = {
    writePlanPath,
    idempotencyKey,
    planDigest: clean(input.planDigest),
    confirmationId: clean(input.confirmationId) || crypto.randomUUID(),
    confirmationText: input.confirmationText.trim(),
    confirmationChannel: "ask_user",
    approved: true,
    consumed: false,
    createdAt: new Date().toISOString()
  };
  pendingArtifacts.set(key, artifact);
  return artifact;
}

export function consumeWriteConfirmationArtifact(params: WriteConfirmationApplyParams) {
  const writePlanPath = clean(params.writePlanPath);
  const idempotencyKey = clean(params.idempotencyKey);
  const confirmationId = clean(params.confirmationId);
  const planDigest = clean(params.planDigest);

  if (!writePlanPath || !idempotencyKey) {
    return {
      ok: false as const,
      reason: "missing_binding" as const,
      message: "linear_apply_write_plan with confirmationChannel=ask_user requires writePlanPath and idempotencyKey from pi_ask_user write_confirmation."
    };
  }

  const key = artifactKey(writePlanPath, idempotencyKey);
  const artifact = pendingArtifacts.get(key);
  if (!artifact || artifact.consumed) {
    return {
      ok: false as const,
      reason: "missing_or_stale" as const,
      message: "No active pi_ask_user write_confirmation approval exists for this exact write plan and idempotencyKey. Call pi_ask_user(flow=write_confirmation) after dry-run before real apply."
    };
  }

  if (confirmationId && confirmationId !== artifact.confirmationId) {
    return {
      ok: false as const,
      reason: "confirmation_mismatch" as const,
      message: "confirmationId does not match the active pi_ask_user write_confirmation approval."
    };
  }

  if (planDigest && artifact.planDigest && planDigest !== artifact.planDigest) {
    return {
      ok: false as const,
      reason: "plan_digest_mismatch" as const,
      message: "planDigest does not match the approved pi_ask_user write_confirmation artifact."
    };
  }

  if (params.confirmationText?.trim() && params.confirmationText.trim() !== artifact.confirmationText) {
    return {
      ok: false as const,
      reason: "confirmation_text_mismatch" as const,
      message: "confirmationText does not match the approved pi_ask_user write_confirmation artifact."
    };
  }

  artifact.consumed = true;
  pendingArtifacts.set(key, artifact);
  return { ok: true as const, artifact };
}
