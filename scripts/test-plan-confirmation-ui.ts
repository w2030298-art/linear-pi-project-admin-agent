import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOperationStructureTree,
  buildPlanConfirmationMessage,
  formatStructuredBullets,
  loadWritePlanDocument,
  PLAN_CONFIRMATION_UI_TITLE_ZH,
  truncateForDisplay
} from "./plan-confirmation-ui.ts";
import { PLAN_CONFIRMATION_UI_TITLE } from "./write-confirmation-artifact.ts";
import { runPlanConfirmationFlow } from "../.pi/extensions/pi-ask-user.ts";
import { resetWriteConfirmationArtifactsForTests } from "./write-confirmation-artifact.ts";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "plan-confirmation-ui-"));
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

assert.equal(PLAN_CONFIRMATION_UI_TITLE, PLAN_CONFIRMATION_UI_TITLE_ZH);

{
  const folded = truncateForDisplay(`第一行\n${"中文长文本".repeat(30)}`, 24, 2);
  assert.ok(folded.length >= 2);
  assert.match(folded[folded.length - 1], /…/);
}

{
  const bullets = formatStructuredBullets("风险 A\n- 风险 B\n• 风险 C", "无");
  assert.ok(bullets.some(line => line.includes("风险 A")));
  assert.ok(bullets.some(line => line.includes("风险 B")));
  assert.ok(bullets.some(line => line.includes("风险 C")));
}

{
  const root = tempDir();
  const writePlanPath = path.join(root, "single-issue.json");
  writeJson(writePlanPath, {
    targetProjectId: "proj-admin",
    targetProject: { id: "proj-admin", name: "Linear Admin Runtime" },
    targetMilestoneReadback: { id: "m3", name: "M3｜Linear Bridge 与写入治理" },
    evidenceRefs: ["state/fact-packs/fact-7f1e56a7fd91.json"],
    operations: [
      {
        key: "issue-wen-299",
        type: "issue.create",
        reason: "Create structured plan confirmation UI issue.",
        input: {
          title: "计划确认 UI 结构化中文展示",
          teamKey: "WEN",
          projectMilestoneName: "M3｜Linear Bridge 与写入治理",
          labelNames: ["Full-stack", "Improvement"],
          priority: 3,
          description: "Acceptance criteria:\n- Structured Chinese UI\n- Tree view for operations"
        }
      }
    ]
  });

  const plan = loadWritePlanDocument(writePlanPath, root);
  assert.ok(plan);
  const tree = buildOperationStructureTree(plan!, undefined);
  assert.ok(tree.some(line => line.includes("Project：Linear Admin Runtime")));
  assert.ok(tree.some(line => line.includes("Milestone：M3｜Linear Bridge 与写入治理")));
  assert.ok(tree.some(line => line.includes("创建 Issue")));
  assert.ok(tree.some(line => line.includes("issue.create")));
  assert.ok(tree.some(line => line.includes("Full-stack")));

  const message = buildPlanConfirmationMessage({
    writePlanPath,
    idempotencyKey: "wen-299-single",
    targetProjectSummary: "Linear Admin Runtime",
    risksSummary: "• 不改变写入安全边界",
    nonChangesSummary: "• repo-map 不变",
    planDigest: "sha256:single",
    cwd: root
  });
  assert.match(message, /【项目概览】/);
  assert.match(message, /【计划结构】/);
  assert.match(message, /【风险说明】/);
  assert.match(message, /【审批绑定 · 核对用】/);
  assert.match(message, /writePlanPath: .+single-issue\.json/);
  assert.match(message, /idempotencyKey: wen-299-single/);
  assert.match(message, /planDigest: sha256:single/);
  assert.match(message, /Yes（认可）/);
  assert.match(message, /fact-7f1e56a7fd91\.json/);
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = tempDir();
  const writePlanPath = path.join(root, "multi-op.json");
  writeJson(writePlanPath, {
    targetProjectId: "proj-admin",
    targetProject: { name: "Linear Admin Runtime" },
    operations: [
      {
        key: "issue-create",
        type: "issue.create",
        input: {
          title: "Issue A",
          projectMilestoneName: "M3｜Bridge",
          labelNames: ["Backend"],
          priority: 2
        }
      },
      {
        key: "project-update",
        type: "projectUpdate.create",
        input: { body: "Status update body", health: "onTrack" }
      },
      {
        key: "relation",
        type: "issueRelation.create",
        input: { type: "blocks", issueId: "WEN-298", relatedIssueId: "WEN-299" }
      }
    ]
  });

  const message = buildPlanConfirmationMessage({
    writePlanPath,
    idempotencyKey: "wen-299-multi",
    risksSummary: "",
    nonChangesSummary: "",
    cwd: root
  });
  assert.match(message, /操作数量：3/);
  assert.match(message, /issue\.create ×1/);
  assert.match(message, /projectUpdate\.create ×1/);
  assert.match(message, /issueRelation\.create ×1/);
  assert.match(message, /项目状态更新/);
  assert.match(message, /建立 Issue 关系/);
  assert.match(message, /未列出额外风险/);
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = tempDir();
  const writePlanPath = path.join(root, "long-text.json");
  const longBody = "中文长文本".repeat(120);
  writeJson(writePlanPath, {
    targetProject: { name: "Demo" },
    operations: [{ type: "projectUpdate.create", input: { body: longBody, health: "onTrack" } }]
  });
  const message = buildPlanConfirmationMessage({
    writePlanPath,
    idempotencyKey: "long-text",
    cwd: root
  });
  assert.match(message, /…/);
  fs.rmSync(root, { recursive: true, force: true });
}

{
  process.env.LINEAR_APPROVAL_PRIVATE_KEY = "test-private-key";
  resetWriteConfirmationArtifactsForTests();
  const root = tempDir();
  const writePlanPath = path.join(root, "approve.json");
  writeJson(writePlanPath, {
    targetProject: { name: "Demo Project" },
    operations: [{ type: "issue.update", input: { identifier: "WEN-299", title: "Updated" } }]
  });

  let capturedPrompt = "";
  const approved = await runPlanConfirmationFlow(
    {
      hasUI: true,
      ui: {
        async input() {
          return undefined;
        },
        async select(title: string) {
          capturedPrompt = title;
          return "Yes";
        }
      }
    },
    {
      writePlanPath,
      idempotencyKey: "snapshot-key",
      targetProjectSummary: "Demo Project",
      operationsSummary: "- issue.update: WEN-299",
      planDigest: "sha256:snapshot",
      risksSummary: "• 无删除操作",
      nonChangesSummary: "• 无 repo-map 变更"
    }
  );

  assert.equal(approved.ok, true);
  assert.match(capturedPrompt, /确认 Linear 写入计划/);
  assert.match(capturedPrompt, /【计划结构】/);
  assert.match(capturedPrompt, /planDigest: sha256:snapshot/);
  assert.equal(approved.approvalArtifact?.approvalKind, "plan_confirmation");
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("test-plan-confirmation-ui: all checks passed");
