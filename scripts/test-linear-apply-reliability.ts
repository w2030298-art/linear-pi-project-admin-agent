import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPlanCommand } from "./linear-apply/command.mjs";

type Request = { query: string; variables: Record<string, any> };

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "linear-apply-reliability-"));
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function options(args: {
  client: any;
  auditPath: string;
  progressPath: string;
}) {
  return {
    env: {
      LINEAR_WRITE_MODE: "confirmed-only",
      ALLOW_LINEAR_WRITES: "true",
      LINEAR_API_KEY: "test-key",
      AUDIT_LOG_PATH: args.auditPath,
      LINEAR_APPLY_PROGRESS_PATH: args.progressPath
    },
    argv: [
      "node",
      "scripts/linear-cli.mjs",
      "apply",
      "plan.json",
      "--confirmed",
      "--confirmation-channel",
      "ask_user"
    ],
    cwd: process.cwd(),
    client: () => args.client,
    cachedWorkspaceObjectManifest: async () => ({ manifest: null, manifestPath: "test-manifest.json" })
  };
}

async function applyWithEnv(planPath: string, applyOptions: ReturnType<typeof options>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(applyOptions.env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await applyPlanCommand(planPath, applyOptions);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function issueReadback(id: string, state: Record<string, any>) {
  const entity = state[id];
  return entity ? { id, identifier: entity.identifier || "WEN-1", title: entity.title || "Issue", updatedAt: entity.updatedAt || "t0" } : null;
}

{
  const dir = tempDir();
  const planPath = path.join(dir, "plan.json");
  const auditPath = path.join(dir, "audit.jsonl");
  const progressPath = path.join(dir, "progress.json");
  const idempotencyKey = "create-readback-failure";
  writeJson(planPath, {
    dryRun: false,
    idempotencyKey,
    confirmedByUser: true,
    confirmationChannel: "ask_user",
    confirmationText: "User approved exact dry-run write plan via Pi UI.",
    confirmationId: `${idempotencyKey}-approval`,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      { key: "parent", type: "issue.create", input: { teamId: "team-id", title: "Parent" } }
    ]
  });
  const requests: Request[] = [];
  const client = {
    client: {
      async rawRequest(query: string, variables: Record<string, any>) {
        requests.push({ query, variables });
        if (/issueCreate/.test(query)) {
          return { data: { issueCreate: { success: true, issue: { id: variables.input.id, title: variables.input.title } } } };
        }
        if (/issue\(id:\$id\)/.test(query)) return { data: { issue: null } };
        return { data: {} };
      }
    }
  };

  await assert.rejects(
    () => applyWithEnv(planPath, options({ client, auditPath, progressPath })),
    /Readback failed/
  );
  const progress = JSON.parse(fs.readFileSync(progressPath, "utf8"));
  assert.equal(progress.operations.parent?.status, "failed", "failed create must not become a successful checkpoint ref");
  assert.equal(progress.operations.parent?.entityId, undefined, "failed create must not checkpoint a reusable phantom id");
}

{
  const dir = tempDir();
  const planPath = path.join(dir, "plan.json");
  const auditPath = path.join(dir, "audit.jsonl");
  const progressPath = path.join(dir, "progress.json");
  const idempotencyKey = "update-replay";
  writeJson(planPath, {
    dryRun: false,
    idempotencyKey,
    confirmedByUser: true,
    confirmationChannel: "ask_user",
    confirmationText: "User approved exact dry-run write plan via Pi UI.",
    confirmationId: `${idempotencyKey}-approval`,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      { key: "rename", type: "issue.update", input: { issueId: "issue-1", title: "After" } }
    ]
  });
  const state: Record<string, any> = { "issue-1": { id: "issue-1", title: "Before", updatedAt: "t0" } };
  let updateMutations = 0;
  const client = {
    client: {
      async rawRequest(query: string, variables: Record<string, any>) {
        if (/issueUpdate/.test(query)) {
          updateMutations += 1;
          state[variables.id] = { ...state[variables.id], ...variables.input, updatedAt: `t${updateMutations}` };
          return { data: { issueUpdate: { success: true, issue: issueReadback(variables.id, state) } } };
        }
        if (/issue\(id:\$id\)/.test(query)) return { data: { issue: issueReadback(variables.id, state) } };
        return { data: {} };
      }
    }
  };

  await applyWithEnv(planPath, options({ client, auditPath, progressPath }));
  await applyWithEnv(planPath, options({ client, auditPath, progressPath }));
  assert.equal(updateMutations, 1, "completed update replay should be skipped instead of resent");

  const progress = JSON.parse(fs.readFileSync(progressPath, "utf8"));
  assert.equal(progress.operations.rename.status, "success");
  assert.equal(progress.operations.rename.before.title, "Before");
  assert.equal(progress.operations.rename.after.title, "After");
  assert.match(fs.readFileSync(auditPath, "utf8"), /"replayAction":"skip_completed"/);
}

{
  const dir = tempDir();
  const planPath = path.join(dir, "plan.json");
  const auditPath = path.join(dir, "audit.jsonl");
  const progressPath = path.join(dir, "progress.json");
  const idempotencyKey = "partial-retry";
  writeJson(planPath, {
    dryRun: false,
    idempotencyKey,
    confirmedByUser: true,
    confirmationChannel: "ask_user",
    confirmationText: "User approved exact dry-run write plan via Pi UI.",
    confirmationId: `${idempotencyKey}-approval`,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      { key: "one", type: "issue.create", input: { teamId: "team-id", title: "One" } },
      { key: "two", type: "issue.create", input: { teamId: "team-id", title: "Two" } }
    ]
  });
  const state: Record<string, any> = {};
  let createMutations = 0;
  let failSecondCreate = true;
  const client = {
    client: {
      async rawRequest(query: string, variables: Record<string, any>) {
        if (/issueCreate/.test(query)) {
          createMutations += 1;
          if (variables.input.title === "Two" && failSecondCreate) throw new Error("temporary create failure");
          state[variables.input.id] = { id: variables.input.id, title: variables.input.title, updatedAt: `t${createMutations}` };
          return { data: { issueCreate: { success: true, issue: issueReadback(variables.input.id, state) } } };
        }
        if (/issue\(id:\$id\)/.test(query)) return { data: { issue: issueReadback(variables.id, state) } };
        return { data: {} };
      }
    }
  };

  await assert.rejects(
    () => applyWithEnv(planPath, options({ client, auditPath, progressPath })),
    /temporary create failure/
  );
  failSecondCreate = false;
  await applyWithEnv(planPath, options({ client, auditPath, progressPath }));
  assert.equal(createMutations, 3, "retry should skip the first successful create and only send the failed create");

  const changedPlanPath = path.join(dir, "changed-plan.json");
  writeJson(changedPlanPath, {
    dryRun: false,
    idempotencyKey,
    confirmedByUser: true,
    confirmationChannel: "ask_user",
    confirmationText: "User approved exact dry-run write plan via Pi UI.",
    confirmationId: `${idempotencyKey}-approval`,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      { key: "one", type: "issue.create", input: { teamId: "team-id", title: "One changed" } },
      { key: "two", type: "issue.create", input: { teamId: "team-id", title: "Two" } }
    ]
  });
  await assert.rejects(
    () => applyWithEnv(changedPlanPath, options({ client, auditPath, progressPath })),
    /plan\/input hash changed/i
  );
}

console.log("linear apply reliability tests passed");
