/**
 * WEN-300 characterization test: planDigest lifecycle causes structural
 * confirmation conflicts (builder digest vs dry-run digest vs apply digest).
 *
 * This test documents the problem state; it does NOT assert desired fixed behavior.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWritePlan } from "./write-plan-builder.mjs";
import { freezePlanManifest } from "./linear-workspace-manifest.mjs";
import {
  consumeWriteConfirmationArtifact,
  registerWriteConfirmationArtifact,
  resetWriteConfirmationArtifactsForTests
} from "./write-confirmation-artifact.ts";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wen300-plan-digest-"));
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function withSigningKey<T>(run: () => T): T {
  const previous = process.env.LINEAR_APPROVAL_PRIVATE_KEY;
  process.env.LINEAR_APPROVAL_PRIVATE_KEY = "wen300-test-signing-key";
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.LINEAR_APPROVAL_PRIVATE_KEY;
    else process.env.LINEAR_APPROVAL_PRIVATE_KEY = previous;
  }
}

function minimalManifest() {
  return {
    version: 1,
    sourceType: "linear_live",
    collectedAt: "2026-06-02T00:00:00.000Z",
    completeness: { complete: true, truncated: false },
    teams: [{ id: "team-wen", key: "WEN", name: "Wen Team" }],
    labels: [{ id: "label-1", name: "Full-stack", teamId: "team-wen", teamKey: "WEN", group: "Area" }],
    workflowStates: [{ id: "state-backlog", name: "Backlog", type: "backlog", teamId: "team-wen" }],
    projectMilestones: [],
    projectStatuses: []
  };
}

function mockCompiledOperations() {
  return [
    {
      index: 0,
      key: "project-update-1",
      type: "projectUpdate.create",
      resolutions: [{ kind: "project", path: "project", id: "project-linear-admin", locator: { id: "project-linear-admin" } }]
    }
  ];
}

{
  const root = tempDir();
  const writePlanPath = path.join(root, "state", "write-plans", "wen300-test-plan.json");
  const manifest = minimalManifest();

  const built: any = buildWritePlan(
    {
      targetProjectId: "project-linear-admin",
      projectBaseline: { project: { id: "project-linear-admin", name: "Linear Admin" } },
      workspaceManifest: manifest,
      operations: [{ type: "projectUpdate.create", input: { body: "WEN-300 characterization update", health: "onTrack" } }]
    },
    { writePlanPath }
  );
  assert.equal(built.ok, true);

  const builderDigest = built.planDigest;
  assert.match(builderDigest || "", /^sha256:/);
  assert.equal(built.nextToolCalls?.approval?.params?.planDigest, builderDigest);

  writeJson(writePlanPath, built.writePlan);

  const frozen = freezePlanManifest(writePlanPath, built.writePlan, manifest, path.join(root, "manifest.json"), mockCompiledOperations());
  const dryRunDigest = frozen.planDigest;
  assert.notEqual(builderDigest, dryRunDigest, "dry-run must change planDigest on the same write plan file");

  resetWriteConfirmationArtifactsForTests();
  withSigningKey(() => {
    registerWriteConfirmationArtifact({
      approvalKind: "plan_confirmation",
      writePlanPath,
      idempotencyKey: built.idempotencyKey!,
      planDigest: builderDigest,
      confirmationText: "User approved builder digest"
    });
  });

  const mismatch = withSigningKey(() =>
    consumeWriteConfirmationArtifact({
      writePlanPath,
      idempotencyKey: built.idempotencyKey!,
      planDigest: dryRunDigest,
      confirmationText: "User approved builder digest"
    })
  );
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "plan_digest_mismatch");

  const duplicateAttempt = withSigningKey(() => {
    try {
      registerWriteConfirmationArtifact({
        approvalKind: "plan_confirmation",
        writePlanPath,
        idempotencyKey: built.idempotencyKey!,
        planDigest: dryRunDigest,
        confirmationText: "User approved dry-run digest"
      });
      return { blocked: false };
    } catch (error) {
      return { blocked: true, message: error instanceof Error ? error.message : String(error) };
    }
  });
  assert.equal(duplicateAttempt.blocked, true);
  assert.match(duplicateAttempt.message || "", /already pending/i);

  fs.rmSync(root, { recursive: true, force: true });
}

console.log("test-plan-digest-lifecycle-wen300: all characterization checks passed");
