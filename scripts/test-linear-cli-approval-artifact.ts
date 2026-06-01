import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPlanCommand } from "./linear-apply/command.mjs";
import {
  registerWriteConfirmationArtifact,
  resetWriteConfirmationArtifactsForTests
} from "./write-confirmation-artifact.ts";

function tempJson(name: string, value: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "linear-cli-approval-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { dir, file };
}

function writePlan(writePlanPath: string, idempotencyKey = "approval-key", planDigest = "sha256:approval") {
  fs.writeFileSync(writePlanPath, JSON.stringify({
    dryRun: false,
    idempotencyKey,
    confirmedByUser: true,
    confirmationChannel: "ask_user",
    confirmationText: "User approved exact dry-run write plan via Pi UI.",
    confirmationId: "approval-confirmation",
    planDigest,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        key: "comment",
        type: "comment.create",
        input: { id: "11111111-1111-4111-8111-111111111111", issueId: "issue-id", body: "safe apply" }
      }
    ]
  }, null, 2), "utf8");
}

function fakeClient(state: { mutated: number }) {
  return {
    client: {
      async rawRequest(query: string) {
        if (/commentCreate/.test(query)) {
          state.mutated += 1;
          return { data: { commentCreate: { success: true, comment: { id: "comment-id", body: "safe apply" } } } };
        }
        if (/comment\(id:\$id\)/.test(query)) {
          return { data: { comment: state.mutated > 0 ? { id: "comment-id", body: "safe apply" } : null } };
        }
        return { data: {} };
      }
    }
  };
}

function baseOptions(state: { mutated: number }, storePath: string, auditPath: string) {
  return {
    env: {
      LINEAR_WRITE_MODE: "confirmed-only",
      ALLOW_LINEAR_WRITES: "true",
      LINEAR_API_KEY: "test-key",
      LINEAR_APPROVAL_PRIVATE_KEY: "test-private-key",
      WRITE_CONFIRMATION_ARTIFACT_STORE_PATH: storePath,
      AUDIT_LOG_PATH: auditPath
    },
    argv: ["node", "scripts/linear-cli.mjs", "apply", "plan.json", "--confirmed", "--confirmation-channel", "ask_user", "--approval-artifact-path", storePath],
    cwd: process.cwd(),
    client: () => fakeClient(state),
    cachedWorkspaceObjectManifest: async () => ({ manifest: null, manifestPath: "test-manifest.json" })
  };
}

async function applyWithAuditPath(planPath: string, options: ReturnType<typeof baseOptions>, auditPath: string) {
  const previous = process.env.AUDIT_LOG_PATH;
  process.env.AUDIT_LOG_PATH = auditPath;
  try {
    return await applyPlanCommand(planPath, options);
  } finally {
    if (previous === undefined) delete process.env.AUDIT_LOG_PATH;
    else process.env.AUDIT_LOG_PATH = previous;
  }
}

{
  const { dir, file: planPath } = tempJson("plan.json", {});
  const storePath = path.join(dir, "artifacts.json");
  const auditPath = path.join(dir, "audit.jsonl");
  writePlan(planPath);
  const state = { mutated: 0 };

  await assert.rejects(
    () => applyWithAuditPath(planPath, baseOptions(state, storePath, auditPath), auditPath),
    /approval artifact/i
  );
  assert.equal(state.mutated, 0, "CLI apply must not mutate without a valid approval artifact");
}

{
  const { dir, file: planPath } = tempJson("plan.json", {});
  const storePath = path.join(dir, "artifacts.json");
  const auditPath = path.join(dir, "audit.jsonl");
  writePlan(planPath);
  process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH = storePath;
  process.env.LINEAR_APPROVAL_PRIVATE_KEY = "test-private-key";
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: planPath,
    idempotencyKey: "approval-key",
    planDigest: "sha256:approval",
    confirmationId: "approval-confirmation",
    confirmationText: "User approved exact dry-run write plan via Pi UI."
  });

  const state = { mutated: 0 };
  await applyWithAuditPath(planPath, baseOptions(state, storePath, auditPath), auditPath);
  assert.equal(state.mutated, 1, "valid signed approval artifact should allow one mutation");

  await assert.rejects(
    () => applyWithAuditPath(planPath, baseOptions(state, storePath, auditPath), auditPath),
    /already_used/i
  );
  assert.equal(state.mutated, 1, "consumed approval artifact must not be reusable");

  const audit = fs.readFileSync(auditPath, "utf8");
  assert.match(audit, /linear_apply_artifact_validation/);
  assert.match(audit, /approval-confirmation/);
  assert.match(audit, /sha256:approval/);
  assert.match(audit, /signatureValid/);
  assert.doesNotMatch(audit, /test-private-key/);
}

{
  const { dir, file: planPath } = tempJson("plan.json", {});
  const storePath = path.join(dir, "artifacts.json");
  const auditPath = path.join(dir, "audit.jsonl");
  writePlan(planPath);
  process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH = storePath;
  process.env.LINEAR_APPROVAL_PRIVATE_KEY = "test-private-key";
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: planPath,
    idempotencyKey: "approval-key",
    planDigest: "sha256:approval",
    confirmationId: "approval-confirmation",
    confirmationText: "User approved exact dry-run write plan via Pi UI."
  });

  const state = { mutated: 0 };
  const options = baseOptions(state, storePath, auditPath);
  delete options.env.LINEAR_APPROVAL_PRIVATE_KEY;
  const previousKey = process.env.LINEAR_APPROVAL_PRIVATE_KEY;
  delete process.env.LINEAR_APPROVAL_PRIVATE_KEY;
  try {
    await assert.rejects(
      () => applyWithAuditPath(planPath, options, auditPath),
      /LINEAR_APPROVAL_PRIVATE_KEY/i
    );
  } finally {
    if (previousKey === undefined) delete process.env.LINEAR_APPROVAL_PRIVATE_KEY;
    else process.env.LINEAR_APPROVAL_PRIVATE_KEY = previousKey;
  }
  assert.equal(state.mutated, 0, "missing approval signing key must block mutation");
}

{
  const { dir, file: planPath } = tempJson("plan.json", {});
  const storePath = path.join(dir, "artifacts.json");
  const auditPath = path.join(dir, "audit.jsonl");
  writePlan(planPath);
  process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH = storePath;
  process.env.LINEAR_APPROVAL_PRIVATE_KEY = "test-private-key";
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: planPath,
    idempotencyKey: "approval-key",
    planDigest: "sha256:approval",
    confirmationId: "approval-confirmation",
    confirmationText: "User approved exact dry-run write plan via Pi UI."
  });
  const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
  parsed.artifacts[`${planPath}::approval-key`].signature.value = "tampered";
  fs.writeFileSync(storePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

  const state = { mutated: 0 };
  await assert.rejects(
    () => applyWithAuditPath(planPath, baseOptions(state, storePath, auditPath), auditPath),
    /signature/i
  );
  assert.equal(state.mutated, 0, "tampered signature must block mutation");
}

console.log("linear cli approval artifact tests passed");
