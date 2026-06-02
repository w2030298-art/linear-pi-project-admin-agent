import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectConnectionNodes, manifestHash } from "./linear-workspace-manifest.mjs";
import { applyPlanCommand } from "./linear-apply/command.mjs";
import { reviewWritePlan } from "./plan-reviewer.mjs";
import {
  registerWriteConfirmationArtifact,
  resetWriteConfirmationArtifactsForTests
} from "./write-confirmation-artifact.ts";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "linear-manifest-freeze-"));
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

function manifest(labelId: string, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    sourceType: "linear_live",
    collectedAt: "2026-06-01T00:00:00.000Z",
    evidenceRef: "test-manifest.json",
    completeness: { complete: true, truncated: false },
    truncated: false,
    teams: [{ id: "team-1", key: "WEN", name: "Wen Team" }],
    labels: [{ id: labelId, name: "Backend", teamId: "team-1", teamKey: "WEN", group: "Area" }],
    workflowStates: [],
    projectMilestones: [],
    projectStatuses: [],
    ...extra
  };
}

{
  const calls: Array<Record<string, unknown>> = [];
  const pages = [
    { nodes: [{ id: "team-1" }], pageInfo: { hasNextPage: true, endCursor: "cursor-1" } },
    { nodes: [{ id: "team-2" }], pageInfo: { hasNextPage: false, endCursor: null } }
  ];
  const client = {
    async rawRequest(_query: string, variables: Record<string, unknown>) {
      calls.push(variables);
      return { data: { teams: pages[calls.length - 1] } };
    }
  };
  const nodes = await collectConnectionNodes(client, {
    rootField: "teams",
    nodeSelection: "id",
    pageSize: 1
  });
  assert.deepEqual(nodes.map((node: any) => node.id), ["team-1", "team-2"]);
  assert.deepEqual(calls.map(call => call.after || null), [null, "cursor-1"]);
}

{
  const calls: Array<Record<string, unknown>> = [];
  const pages = [
    { nodes: [{ id: "state-1" }], pageInfo: { hasNextPage: true, endCursor: "state-cursor-1" } },
    { nodes: [{ id: "state-2" }], pageInfo: { hasNextPage: false, endCursor: null } }
  ];
  const client = {
    async rawRequest(_query: string, variables: Record<string, unknown>) {
      calls.push(variables);
      return { data: { team: { states: pages[calls.length - 1] } } };
    }
  };
  const nodes = await collectConnectionNodes(client, {
    rootField: "states",
    nodeSelection: "id",
    variables: { teamId: "team-1" },
    variableDefinitions: ", $teamId: String!",
    queryPrefix: "team(id: $teamId) {",
    querySuffix: "}",
    pageSize: 1
  });
  assert.deepEqual(nodes.map((node: any) => node.id), ["state-1", "state-2"]);
  assert.deepEqual(calls.map(call => call.after || null), [null, "state-cursor-1"]);
}

{
  const dir = tempDir();
  const planPath = path.join(dir, "plan.json");
  const manifestPath = path.join(dir, "plan-manifest.json");
  writeJson(planPath, {
    dryRun: true,
    idempotencyKey: "dry-run-freeze",
    targetProjectId: "project-1",
    dependencyValidation: "No relations needed.",
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        key: "create",
        type: "issue.create",
        input: {
          teamId: "team-1",
          projectId: "project-1",
          title: "Create issue",
          labelNames: ["Backend"]
        }
      }
    ]
  });
  const frozenManifest = manifest("label-before", { evidenceRef: manifestPath });
  const client = { client: { async rawRequest() { return { data: {} }; } } };
  await applyPlanCommand(planPath, {
    env: { LINEAR_WRITE_MODE: "dry-run", LINEAR_WORKSPACE_OBJECT_MANIFEST_PATH: manifestPath },
    argv: ["node", "scripts/linear-cli.mjs", "apply", planPath, "--dry-run"],
    cwd: process.cwd(),
    client: () => client,
    cachedWorkspaceObjectManifest: async () => ({ manifest: frozenManifest, manifestPath })
  });

  const updatedPlan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  assert.equal(updatedPlan.manifestHash, manifestHash(frozenManifest));
  assert.equal(updatedPlan.manifestPath, manifestPath);
  assert.match(updatedPlan.planDigest, /^sha256:/);
  assert.equal(updatedPlan.resolutions[0].id, "label-before");
  assert.equal(fs.existsSync(manifestPath), true, "dry-run should persist the approved manifest snapshot");
}

{
  const dir = tempDir();
  const planPath = path.join(dir, "plan.json");
  const storePath = path.join(dir, "artifacts.json");
  const auditPath = path.join(dir, "audit.jsonl");
  const progressPath = path.join(dir, "progress.json");
  const approvedManifest = manifest("label-before");
  writeJson(planPath, {
    dryRun: false,
    idempotencyKey: "manifest-drift",
    manifestHash: manifestHash(approvedManifest),
    manifestPath: path.join(dir, "approved-manifest.json"),
    resolutions: [{ kind: "label", id: "label-before", path: "$.operations[0].input.labelNames" }],
    confirmedByUser: true,
    confirmationChannel: "ask_user",
    confirmationText: "User approved exact dry-run write plan via Pi UI.",
    confirmationId: "manifest-drift-approval",
    readbackRequired: true,
    auditLogRequired: true,
    operations: [
      {
        key: "create",
        type: "issue.create",
        input: {
          teamId: "team-1",
          projectId: "project-1",
          title: "Create issue",
          labelNames: ["Backend"]
        }
      }
    ]
  });
  process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH = storePath;
  process.env.LINEAR_APPROVAL_PRIVATE_KEY = "test-private-key";
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: planPath,
    idempotencyKey: "manifest-drift",
    confirmationId: "manifest-drift-approval",
    confirmationText: "User approved exact dry-run write plan via Pi UI."
  });
  let mutations = 0;
  const client = {
    client: {
      async rawRequest(query: string) {
        if (/issueCreate/.test(query)) mutations += 1;
        return { data: {} };
      }
    }
  };

  const env = {
        LINEAR_WRITE_MODE: "confirmed-only",
        ALLOW_LINEAR_WRITES: "true",
        LINEAR_APPROVAL_PRIVATE_KEY: "test-private-key",
        WRITE_CONFIRMATION_ARTIFACT_STORE_PATH: storePath,
        AUDIT_LOG_PATH: auditPath,
        LINEAR_APPLY_PROGRESS_PATH: progressPath
      };
  await assert.rejects(
    () => withEnv(env, () => applyPlanCommand(planPath, {
        env,
        argv: ["node", "scripts/linear-cli.mjs", "apply", planPath, "--confirmed", "--confirmation-channel", "ask_user", "--approval-artifact-path", storePath],
        cwd: process.cwd(),
        client: () => client,
        cachedWorkspaceObjectManifest: async () => ({ manifest: manifest("label-after"), manifestPath: path.join(dir, "current-manifest.json") })
      })),
    /manifestHash mismatch/
  );
  assert.equal(mutations, 0, "manifest drift must block before Linear mutation");
  const audit = fs.readFileSync(auditPath, "utf8");
  assert.match(audit, /linear_apply_manifest_validation/);
  assert.match(audit, /resolutionDiff/);
}

{
  const report = reviewWritePlan(
    {
      dryRun: false,
      confirmedByUser: true,
      idempotencyKey: "incomplete-manifest",
      dependencyValidation: "No relations needed.",
      targetProjectId: "project-1",
      readbackRequired: true,
      auditLogRequired: true,
      operations: [
        { type: "issue.create", input: { teamId: "team-1", title: "Issue", labelNames: ["Backend"] } }
      ]
    },
    { workspaceManifest: manifest("label-1", { completeness: { complete: false, truncated: true }, truncated: true }) }
  );
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((finding: any) => finding.code === "workspace_manifest_incomplete"));
}

console.log("linear manifest freeze tests passed");
