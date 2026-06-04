import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPlanCommand } from "./linear-apply/command.mjs";

type IssueState = Record<string, { id: string; title: string; updatedAt: string }>;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "linear-apply-reliability-"));
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function applyOptions(args: {
  auditPath: string;
  progressPath: string;
  connectLinearMcp: () => Promise<any>;
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
    client: () => ({ client: { async rawRequest() { return { data: {} }; } } }),
    connectLinearMcp: args.connectLinearMcp,
    cachedWorkspaceObjectManifest: async () => ({ manifest: null, manifestPath: "test-manifest.json" })
  };
}

async function applyWithEnv(planPath: string, options: ReturnType<typeof applyOptions>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(options.env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await applyPlanCommand(planPath, options);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createMcpMock(config: {
  state: IssueState;
  failReadbackAfterCreate?: boolean;
  failSecondCreate?: { active: boolean };
  counters?: { create: number; update: number };
  saveIssueCounter?: { saveIssue: number };
}) {
  const counters = config.counters || { create: 0, update: 0 };
  return async () => ({
    backend: "mcp",
    mock: true,
    async callTool(name: string, args: Record<string, unknown> = {}) {
      if (name === "save_issue") {
        if (config.saveIssueCounter) config.saveIssueCounter.saveIssue += 1;
        const issueId = String(args.id || "");
        if (issueId && config.state[issueId]) {
          counters.update += 1;
          config.state[issueId] = {
            ...config.state[issueId],
            title: String(args.title ?? config.state[issueId].title),
            updatedAt: `t${counters.update}`
          };
          return { issue: config.state[issueId] };
        }
        counters.create += 1;
        if (args.title === "Two" && config.failSecondCreate?.active) {
          throw new Error("temporary create failure");
        }
        const id = issueId || `issue-${counters.create}`;
        config.state[id] = {
          id,
          title: String(args.title || "Issue"),
          updatedAt: `t${counters.create}`
        };
        return { issue: config.state[id] };
      }
      if (name === "get_issue") {
        if (config.failReadbackAfterCreate) return null;
        return config.state[String(args.id)] || null;
      }
      return { ok: true, tool: name, args };
    },
    async close() {}
  });
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
    confirmationText: "User approved exact final-validated write plan via Pi UI.",
    confirmationId: `${idempotencyKey}-approval`,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      { key: "parent", type: "issue.create", input: { teamId: "team-id", title: "Parent" } }
    ]
  });
  const state: IssueState = {};

  await assert.rejects(
    () => applyWithEnv(planPath, applyOptions({
      auditPath,
      progressPath,
      connectLinearMcp: createMcpMock({ state, failReadbackAfterCreate: true })
    })),
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
    confirmationText: "User approved exact final-validated write plan via Pi UI.",
    confirmationId: `${idempotencyKey}-approval`,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      { key: "rename", type: "issue.update", input: { issueId: "issue-1", title: "After" } }
    ]
  });
  const state: IssueState = { "issue-1": { id: "issue-1", title: "Before", updatedAt: "t0" } };
  const counters = { saveIssue: 0 };
  const connectLinearMcp = createMcpMock({ state, counters: { create: 0, update: 0 }, saveIssueCounter: counters });

  await applyWithEnv(planPath, applyOptions({ auditPath, progressPath, connectLinearMcp }));
  await applyWithEnv(planPath, applyOptions({ auditPath, progressPath, connectLinearMcp }));
  assert.equal(counters.saveIssue, 1, "completed update replay should be skipped instead of resent");

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
    confirmationText: "User approved exact final-validated write plan via Pi UI.",
    confirmationId: `${idempotencyKey}-approval`,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      { key: "one", type: "issue.create", input: { teamId: "team-id", title: "One" } },
      { key: "two", type: "issue.create", input: { teamId: "team-id", title: "Two" } }
    ]
  });
  const state: IssueState = {};
  const counters = { create: 0, update: 0 };
  const failSecondCreate = { active: true };
  const connectLinearMcp = createMcpMock({ state, counters, failSecondCreate });

  await assert.rejects(
    () => applyWithEnv(planPath, applyOptions({ auditPath, progressPath, connectLinearMcp })),
    /temporary create failure/
  );
  failSecondCreate.active = false;
  await applyWithEnv(planPath, applyOptions({ auditPath, progressPath, connectLinearMcp }));
  assert.equal(counters.create, 3, "retry should skip the first successful create and only send the failed create");

  const changedPlanPath = path.join(dir, "changed-plan.json");
  writeJson(changedPlanPath, {
    dryRun: false,
    idempotencyKey,
    confirmedByUser: true,
    confirmationChannel: "ask_user",
    confirmationText: "User approved exact final-validated write plan via Pi UI.",
    confirmationId: `${idempotencyKey}-approval`,
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      { key: "one", type: "issue.create", input: { teamId: "team-id", title: "One changed" } },
      { key: "two", type: "issue.create", input: { teamId: "team-id", title: "Two" } }
    ]
  });
  await assert.rejects(
    () => applyWithEnv(changedPlanPath, applyOptions({ auditPath, progressPath, connectLinearMcp })),
    /plan\/input hash changed/i
  );
}

console.log("linear apply reliability tests passed");
