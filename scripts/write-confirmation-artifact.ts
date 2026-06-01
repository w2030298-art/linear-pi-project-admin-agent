import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WRITE_CONFIRMATION_UI_TITLE = "Approve & Write";
export const DEFAULT_APPROVAL_ARTIFACT_TTL_MS = 30 * 60 * 1000;

export interface ApprovalArtifact {
  approved: true;
  confirmationChannel: "ask_user";
  writePlanPath: string;
  idempotencyKey: string;
  planDigest?: string;
  confirmationId: string;
  confirmationText: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
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

type ArtifactValidationFailure = {
  ok: false;
  reason:
    | "missing_binding"
    | "missing_or_stale"
    | "store_unavailable"
    | "already_used"
    | "expired"
    | "confirmation_mismatch"
    | "plan_digest_mismatch"
    | "confirmation_text_mismatch";
  message: string;
};

const pendingArtifacts = new Map<string, ApprovalArtifact>();
const STORE_ENV = "WRITE_CONFIRMATION_ARTIFACT_STORE_PATH";
const DEFAULT_STORE_FILE = "write-confirmation-artifacts.json";
const SOURCE_PATH = fileURLToPath(import.meta.url);

function artifactKey(writePlanPath: string, idempotencyKey: string) {
  return `${writePlanPath.trim()}::${idempotencyKey.trim()}`;
}

function defaultStorePath(env: Record<string, string | undefined> = process.env) {
  const localAppData = clean(env.LOCALAPPDATA);
  if (localAppData) return path.join(localAppData, "LinearProjectAdminPi", DEFAULT_STORE_FILE);

  const xdgStateHome = clean(env.XDG_STATE_HOME);
  if (xdgStateHome) return path.join(xdgStateHome, "linear-project-admin-pi", DEFAULT_STORE_FILE);

  return path.join(os.homedir(), ".linear-project-admin-pi", DEFAULT_STORE_FILE);
}

function artifactStorePath() {
  return clean(process.env[STORE_ENV]) || defaultStorePath();
}

export function getWriteConfirmationArtifactStorePath() {
  return artifactStorePath();
}

function readArtifactStore(): Map<string, ApprovalArtifact> {
  const storePath = artifactStorePath();
  if (!fs.existsSync(storePath)) return new Map();

  const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const artifacts = parsed?.artifacts && typeof parsed.artifacts === "object" ? parsed.artifacts : {};
  return new Map(Object.entries(artifacts) as Array<[string, ApprovalArtifact]>);
}

function writeArtifactStore(artifacts: Map<string, ApprovalArtifact>) {
  const storePath = artifactStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    artifacts: Object.fromEntries(artifacts)
  };
  fs.writeFileSync(storePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function getPersistedArtifact(key: string) {
  const artifacts = readArtifactStore();
  const artifact = artifacts.get(key);
  if (artifact) pendingArtifacts.set(key, artifact);
  return artifact;
}

function persistArtifact(key: string, artifact: ApprovalArtifact) {
  const artifacts = readArtifactStore();
  artifacts.set(key, artifact);
  pendingArtifacts.set(key, artifact);
  writeArtifactStore(artifacts);
}

function findPackageRoot(start: string) {
  let current = path.dirname(start);
  while (true) {
    if (fs.existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.dirname(start);
    current = parent;
  }
}

function sourceStatus() {
  return {
    sourcePath: SOURCE_PATH,
    packageRoot: findPackageRoot(SOURCE_PATH),
    runtimeCwd: process.cwd()
  };
}

export function getWriteConfirmationArtifactStorageStatus(artifact?: Pick<ApprovalArtifact, "writePlanPath" | "idempotencyKey">) {
  const storePath = artifactStorePath();
  const status: {
    kind: "local_file";
    path: string;
    configuredByEnv: boolean;
    exists: boolean;
    readable: boolean;
    writable: boolean;
    persisted?: boolean;
    error?: string;
  } = {
    kind: "local_file",
    path: storePath,
    configuredByEnv: Boolean(clean(process.env[STORE_ENV])),
    exists: fs.existsSync(storePath),
    readable: false,
    writable: false
  };

  try {
    const artifacts = readArtifactStore();
    status.readable = true;
    if (artifact) status.persisted = artifacts.has(artifactKey(artifact.writePlanPath, artifact.idempotencyKey));
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
  }

  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.accessSync(path.dirname(storePath), fs.constants.W_OK);
    status.writable = true;
  } catch (error) {
    status.error = status.error || (error instanceof Error ? error.message : String(error));
  }

  return status;
}

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function isExpired(artifact: ApprovalArtifact, now = Date.now()) {
  return Date.parse(artifact.expiresAt) <= now;
}

function isUsed(artifact: ApprovalArtifact) {
  return Boolean(artifact.usedAt);
}

export function resetWriteConfirmationArtifactsForTests(options: { preserveStore?: boolean } = {}) {
  pendingArtifacts.clear();
  if (options.preserveStore) return;
  const storePath = artifactStorePath();
  if (fs.existsSync(storePath)) fs.rmSync(storePath, { force: true });
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
    "Confirmation channel: pi_ask_user write_confirmation Approve & Write UI.",
    "User approval: User approved exact dry-run write plan via Pi UI.",
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
    "Dry-run already completed. Review the exact write plan before approving real Linear mutations.",
    `Write plan: ${input.writePlanPath}`,
    `Idempotency key: ${input.idempotencyKey}`
  ];
  if (input.targetProjectSummary) sections.push(`Target project: ${input.targetProjectSummary}`);
  if (input.operationsSummary) sections.push(`Operations:\n${input.operationsSummary}`);
  if (input.risksSummary) sections.push(`Risks:\n${input.risksSummary}`);
  if (input.nonChangesSummary) sections.push(`Non-changes:\n${input.nonChangesSummary}`);
  if (input.planDigest) sections.push(`Plan digest: ${input.planDigest}`);
  sections.push("Choose Approve & Write to run the real apply immediately, or Cancel to keep dry-run only.");
  return sections.join("\n\n");
}

export function toApprovalArtifactResponse(artifact: ApprovalArtifact) {
  return {
    approved: artifact.approved,
    confirmationChannel: artifact.confirmationChannel,
    writePlanPath: artifact.writePlanPath,
    idempotencyKey: artifact.idempotencyKey,
    planDigest: artifact.planDigest,
    confirmationId: artifact.confirmationId,
    confirmationText: artifact.confirmationText,
    createdAt: artifact.createdAt,
    expiresAt: artifact.expiresAt,
    usedAt: artifact.usedAt,
    storage: getWriteConfirmationArtifactStorageStatus(artifact),
    source: sourceStatus()
  };
}

export function registerWriteConfirmationArtifact(input: {
  writePlanPath: string;
  idempotencyKey: string;
  planDigest?: string;
  confirmationText: string;
  confirmationId?: string;
  ttlMs?: number;
}) {
  const writePlanPath = clean(input.writePlanPath);
  const idempotencyKey = clean(input.idempotencyKey);
  if (!writePlanPath || !idempotencyKey) {
    throw new Error("write_confirmation requires writePlanPath and idempotencyKey.");
  }

  const key = artifactKey(writePlanPath, idempotencyKey);
  const existing = pendingArtifacts.get(key) || getPersistedArtifact(key);
  if (existing && !isUsed(existing) && !isExpired(existing)) {
    throw new Error("write_confirmation already pending for this exact write plan and idempotencyKey.");
  }

  const createdAt = new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_APPROVAL_ARTIFACT_TTL_MS;
  const artifact: ApprovalArtifact = {
    approved: true,
    confirmationChannel: "ask_user",
    writePlanPath,
    idempotencyKey,
    planDigest: clean(input.planDigest),
    confirmationId: clean(input.confirmationId) || crypto.randomUUID(),
    confirmationText: input.confirmationText.trim(),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString()
  };
  persistArtifact(key, artifact);
  return artifact;
}

function validateArtifactState(
  params: WriteConfirmationApplyParams,
  options: { requireUnused?: boolean } = {}
): { ok: true; artifact: ApprovalArtifact } | ArtifactValidationFailure {
  const writePlanPath = clean(params.writePlanPath);
  const idempotencyKey = clean(params.idempotencyKey);
  const confirmationId = clean(params.confirmationId);
  const planDigest = clean(params.planDigest);

  if (!writePlanPath || !idempotencyKey) {
    return {
      ok: false,
      reason: "missing_binding",
      message: "linear_apply_write_plan with confirmationChannel=ask_user requires writePlanPath and idempotencyKey from pi_ask_user write_confirmation."
    };
  }

  const key = artifactKey(writePlanPath, idempotencyKey);
  let artifact: ApprovalArtifact | undefined;
  try {
    artifact = pendingArtifacts.get(key) || getPersistedArtifact(key);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "store_unavailable",
      message: `store_unavailable: Cannot read pi_ask_user write_confirmation artifact store at ${artifactStorePath()}: ${detail}. Next step: re-run pi_ask_user(flow=write_confirmation) in the active runtime or explicitly allow conversation fallback if UI approval is unavailable.`
    };
  }
  if (!artifact) {
    return {
      ok: false,
      reason: "missing_or_stale",
      message: `missing_or_stale: No active pi_ask_user write_confirmation approval is persisted for this exact write plan and idempotencyKey in ${artifactStorePath()}. The approval may be unregistered, expired, consumed, or written by a different runtime path/store. Next step: re-run pi_ask_user(flow=write_confirmation) in the active runtime before real apply, or explicitly allow conversation fallback if UI approval is unavailable.`
    };
  }

  if (options.requireUnused !== false && isUsed(artifact)) {
    return {
      ok: false,
      reason: "already_used",
      message: "already_used: Approval artifact was already consumed by a previous real apply and cannot be reused. Next step: re-run dry-run and pi_ask_user(flow=write_confirmation) to create a fresh approval."
    };
  }

  if (isExpired(artifact)) {
    return {
      ok: false,
      reason: "expired",
      message: "expired: Approval artifact expired before real apply. Next step: re-run dry-run and call pi_ask_user(flow=write_confirmation) again."
    };
  }

  if (confirmationId && confirmationId !== artifact.confirmationId) {
    return {
      ok: false,
      reason: "confirmation_mismatch",
      message: "confirmation_mismatch: confirmationId does not match the active pi_ask_user write_confirmation approval. Next step: pass the approvalArtifact returned by pi_ask_user unchanged, or re-run approval."
    };
  }

  if (planDigest && artifact.planDigest && planDigest !== artifact.planDigest) {
    return {
      ok: false,
      reason: "plan_digest_mismatch",
      message: "plan_digest_mismatch: planDigest does not match the approved pi_ask_user write_confirmation artifact. Next step: re-run dry-run and approve the exact current write plan."
    };
  }

  if (params.confirmationText?.trim() && params.confirmationText.trim() !== artifact.confirmationText) {
    return {
      ok: false,
      reason: "confirmation_text_mismatch",
      message: "confirmation_text_mismatch: confirmationText does not match the approved pi_ask_user write_confirmation artifact. Next step: pass the approvalArtifact returned by pi_ask_user unchanged, or re-run approval."
    };
  }

  return { ok: true, artifact };
}

export function validateWriteConfirmationArtifact(params: WriteConfirmationApplyParams) {
  return validateArtifactState(params, { requireUnused: true });
}

export function consumeWriteConfirmationArtifact(params: WriteConfirmationApplyParams) {
  const validated = validateArtifactState(params, { requireUnused: true });
  if (!validated.ok) return validated;

  const usedAt = new Date().toISOString();
  const consumed: ApprovalArtifact = { ...validated.artifact, usedAt };
  persistArtifact(artifactKey(consumed.writePlanPath, consumed.idempotencyKey), consumed);
  return { ok: true as const, artifact: consumed };
}
