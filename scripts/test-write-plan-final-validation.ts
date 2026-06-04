import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPlanCommand } from "./linear-apply/command.mjs";
import { validateWritePlanCommand } from "./linear-apply/final-validation.mjs";
import { manifestHash } from "./linear-workspace-manifest.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "write-plan-final-validation-"));
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function withEnv<T>(env: Record<string, string>, run: () => Promise<T>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function manifest(labelId: string, manifestPath: string) {
  return {
    version: 1,
    sourceType: "linear_live",
    collectedAt: "2026-06-04T00:00:00.000Z",
    evidenceRef: manifestPath,
    completeness: { complete: true, truncated: false },
    truncated: false,
    teams: [{ id: "team-1", key: "WEN", name: "Wen Team" }],
    labels: [{ id: labelId, name: "Backend", teamId: "team-1", teamKey: "WEN", group: "Area" }],
    workflowStates: [],
    projectMilestones: [{ id: "milestone-1", name: "M1", projectId: "project-1" }],
    projectStatuses: []
  };
}

{
  const dir = tempDir();
  const planPath = path.join(dir, "plan.json");
  const manifestPath = path.join(dir, "validation-manifest.json");
  const auditPath = path.join(dir, "audit.jsonl");
  const progressPath = path.join(dir, "progress.json");
  const validationManifest = manifest("label-before", manifestPath);
  writeJson(planPath, {
    dryRun: true,
    idempotencyKey: "final-validation-reuse",
    targetProjectId: "project-1",
    targetMilestoneId: "milestone-1",
    targetMilestoneReadback: {
      id: "milestone-1",
      projectId: "project-1",
      name: "M1"
    },
    dependencyValidation: "Single issue is independent.",
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        key: "create",
        type: "issue.create",
        input: {
          teamId: "team-1",
          projectId: "project-1",
          projectMilestoneId: "milestone-1",
          title: "Create issue",
          description: "Acceptance criteria:\n- It validates once",
          labelNames: ["Backend"]
        }
      }
    ]
  });

  const validation: any = await validateWritePlanCommand(planPath, {
    env: { AUDIT_LOG_PATH: auditPath },
    emitJson: false,
    client: () => ({ client: { async rawRequest() { return { data: {} }; } } }),
    cachedWorkspaceObjectManifest: async () => ({ manifest: validationManifest, manifestPath })
  });

  assert.equal(validation.ok, true);
  assert.equal(validation.status, "pass");
  assert.equal(validation.finalValidation.operationCount, 1);
  assert.deepEqual(validation.nextToolCalls.map((call: any) => call.name), [
    "pi_ask_user",
    "linear_apply_write_plan"
  ]);

  const updatedPlan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  assert.equal(updatedPlan.finalValidation.status, "pass");
  assert.equal(updatedPlan.manifestHash, manifestHash(validationManifest));
  assert.equal(updatedPlan.resolutions[0].id, "label-before");

  let savedIssueArgs: Record<string, unknown> | null = null;
  const state: Record<string, any> = {};
  const connectLinearMcp = async () => ({
    backend: "mcp",
    async callTool(name: string, args: Record<string, unknown> = {}) {
      if (name === "save_issue") {
        savedIssueArgs = args;
        const issue = {
          id: String(args.id || "issue-1"),
          title: String(args.title || ""),
          description: String(args.description || ""),
          team: { id: "team-1" },
          labels: { nodes: [{ id: "label-before", name: "Backend" }] }
        };
        state[issue.id] = issue;
        return { issue };
      }
      if (name === "get_issue") return state[String(args.id)] || null;
      return { ok: true };
    },
    async close() {}
  });

  const env = {
    LINEAR_WRITE_MODE: "confirmed-only",
    ALLOW_LINEAR_WRITES: "true",
    LINEAR_API_KEY: "test-key",
    AUDIT_LOG_PATH: auditPath,
    LINEAR_APPLY_PROGRESS_PATH: progressPath
  };
  await withEnv(env, () => applyPlanCommand(planPath, {
    env,
    argv: ["node", "scripts/linear-cli.mjs", "apply", planPath, "--confirmed", "--confirmation-channel", "ask_user"],
    cwd: process.cwd(),
    client: () => ({ client: { async rawRequest() { return { data: {} }; } } }),
    connectLinearMcp,
    cachedWorkspaceObjectManifest: async () => ({
      manifest: manifest("label-after", path.join(dir, "current-manifest.json")),
      manifestPath: path.join(dir, "current-manifest.json")
    })
  }));

  assert.deepEqual(savedIssueArgs?.labels, ["label-before"]);
  assert.doesNotMatch(fs.readFileSync(auditPath, "utf8"), /manifestHash mismatch/);
}

{
  const dir = tempDir();
  const planPath = path.join(dir, "unsupported-mcp-plan.json");
  const manifestPath = path.join(dir, "manifest.json");
  writeJson(planPath, {
    dryRun: true,
    idempotencyKey: "unsupported-mcp-mapping",
    dependencyValidation: "New project plan includes one issue.",
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      { key: "project", type: "project.create", input: { name: "Project", teamId: "team-1" } },
      { key: "milestone", type: "projectMilestone.create", input: { projectRef: "$project", name: "M1" } },
      {
        key: "issue",
        type: "issue.create",
        input: {
          projectRef: "$project",
          projectMilestoneRef: "$milestone",
          teamId: "team-1",
          title: "Issue",
          description: "Acceptance criteria:\n- It validates mappings",
          labelNames: ["Backend"]
        }
      }
    ]
  });

  const validation: any = await validateWritePlanCommand(planPath, {
    env: {},
    emitJson: false,
    client: () => ({ client: { async rawRequest() { return { data: {} }; } } }),
    cachedWorkspaceObjectManifest: async () => ({ manifest: manifest("label-1", manifestPath), manifestPath })
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.status, "needs_revision");
  assert.ok(
    validation.findings.some((finding: any) => finding.code === "write_plan_mcp_mapping_missing"),
    "final validation should catch operations without MCP mutation mapping"
  );
}

console.log("write plan final validation tests passed");
