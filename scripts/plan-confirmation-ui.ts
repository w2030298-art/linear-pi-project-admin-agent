import fs from "node:fs";
import path from "node:path";

export const PLAN_CONFIRMATION_UI_TITLE_ZH = "确认 Linear 写入计划";

export interface PlanConfirmationViewInput {
  writePlanPath: string;
  idempotencyKey: string;
  targetProjectSummary?: string;
  operationsSummary?: string;
  risksSummary?: string;
  nonChangesSummary?: string;
  planDigest?: string;
  cwd?: string;
}

export interface WritePlanOperation {
  key?: string;
  type?: string;
  reason?: string;
  input?: Record<string, unknown>;
}

export interface WritePlanDocument {
  targetProject?: { id?: string; name?: string; url?: string };
  targetProjectId?: string;
  targetMilestoneId?: string;
  targetMilestoneReadback?: { id?: string; name?: string; projectId?: string };
  operations?: WritePlanOperation[];
  evidenceRefs?: string[];
  dependencyValidation?: string;
  source?: { issueIdentifier?: string; factPackPath?: string; generatedBy?: string };
}

const MUTATION_LABELS: Record<string, string> = {
  "issue.create": "创建 Issue",
  "issue.update": "更新 Issue",
  "issueRelation.create": "建立 Issue 关系",
  "issue.relation.create": "建立 Issue 关系",
  "projectUpdate.create": "项目状态更新",
  "project.update": "更新 Project",
  "project.create": "创建 Project",
  "projectMilestone.create": "创建 Milestone",
  "milestone.create": "创建 Milestone",
  "comment.create": "添加评论"
};

const DIVIDER = "────────────────────────────────────────";
const SECTION = (title: string) => [`${DIVIDER}`, `【${title}】`];

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolvePlanPath(cwd: string, writePlanPath: string) {
  return path.isAbsolute(writePlanPath) ? writePlanPath : path.resolve(cwd, writePlanPath);
}

export function loadWritePlanDocument(writePlanPath: string, cwd = process.cwd()): WritePlanDocument | null {
  const resolved = resolvePlanPath(cwd, writePlanPath);
  if (!fs.existsSync(resolved)) return null;
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as WritePlanDocument;
  } catch {
    return null;
  }
}

function displayWidth(text: string) {
  let width = 0;
  for (const char of text) {
    width += char.charCodeAt(0) > 0xff ? 2 : 1;
  }
  return width;
}

export function truncateForDisplay(text: string, maxWidth = 72, maxLines = 4) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (out.length >= maxLines) {
      out.push("  …（内容已截断，完整内容见 write plan 文件）");
      break;
    }
    if (displayWidth(line) <= maxWidth) {
      out.push(line);
      continue;
    }
    let chunk = "";
    let width = 0;
    for (const char of line) {
      const charWidth = char.charCodeAt(0) > 0xff ? 2 : 1;
      if (width + charWidth > maxWidth - 1) break;
      chunk += char;
      width += charWidth;
    }
    out.push(`${chunk}…`);
  }
  return out;
}

export function formatStructuredBullets(content: string | undefined, emptyLabel: string, indent = "  ") {
  const value = clean(content);
  if (!value) return [`${indent}· ${emptyLabel}`];
  const items = value
    .split(/\n+/)
    .flatMap(line => line.split(/(?:^|\s)[•·\-*]\s+/u).map(item => item.trim()).filter(Boolean))
    .filter(Boolean);
  if (items.length <= 1 && !value.includes("\n") && !/[•·\-*]/.test(value)) {
    return truncateForDisplay(value, 68, 6).map(line => `${indent}· ${line}`);
  }
  return items.flatMap(item => truncateForDisplay(item, 68, 3).map((line, index) => `${indent}${index === 0 ? "· " : "  "}${line}`));
}

function mutationLabel(type: string | undefined) {
  const value = clean(type);
  if (!value) return "未知操作";
  return MUTATION_LABELS[value] || value;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => asString(item)).filter(Boolean) as string[];
}

function operationHeadline(operation: WritePlanOperation, index: number) {
  const input = operation.input || {};
  const type = clean(operation.type);
  const label = mutationLabel(type);
  const rawTitle =
    asString(input.title) ||
    asString(input.identifier) ||
    asString(input.issueId) ||
    asString(input.body) ||
    clean(operation.key) ||
    `operation-${index + 1}`;
  const title = truncateForDisplay(rawTitle, 40, 1)[0];
  return `[${index + 1}] ${label} · ${title}`;
}

function operationDetailLines(operation: WritePlanOperation) {
  const input = operation.input || {};
  const lines: string[] = [`      类型：${clean(operation.type) || "unknown"}`];
  const milestone =
    asString(input.projectMilestoneName) ||
    asString(input.milestoneName) ||
    asString(input.projectMilestoneId);
  if (milestone) lines.push(`      里程碑：${milestone}`);
  const state = asString(input.state) || asString(input.stateId);
  if (state) lines.push(`      状态：${state}`);
  const priority = input.priority;
  if (priority !== undefined && priority !== null && priority !== "") lines.push(`      优先级：${priority}`);
  const labels = asStringArray(input.labelNames).concat(asStringArray(input.labels));
  if (labels.length) lines.push(`      标签：${labels.join("、")}`);
  const assignee = asString(input.assignee) || asString(input.assigneeId);
  if (assignee) lines.push(`      负责人：${assignee}`);
  const relationType = asString(input.type);
  if (clean(operation.type)?.includes("Relation") && relationType) lines.push(`      关系类型：${relationType}`);
  const related = asString(input.relatedIssueId) || asString(input.relatedIssueRef);
  if (related) lines.push(`      关联 Issue：${related}`);
  const summary =
    asString(input.description)?.split("\n")[0] ||
    asString(input.body)?.split("\n")[0] ||
    clean(operation.reason);
  if (summary) {
    for (const line of truncateForDisplay(summary, 64, 2)) {
      lines.push(`      变更摘要：${line}`);
    }
  }
  return lines;
}

function countOperationTypes(operations: WritePlanOperation[]) {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    const type = clean(operation.type) || "unknown";
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return [...counts.entries()].map(([type, count]) => `${type} ×${count}`).join("，");
}

function milestoneNameForOperation(operation: WritePlanOperation, plan: WritePlanDocument) {
  const input = operation.input || {};
  return (
    asString(input.projectMilestoneName) ||
    asString(input.milestoneName) ||
    plan.targetMilestoneReadback?.name ||
    asString(plan.targetMilestoneId) ||
    "（未指定 Milestone）"
  );
}

export function buildOperationStructureTree(plan: WritePlanDocument | null, operationsSummary?: string) {
  const operations = plan?.operations || [];
  if (!operations.length) {
    const summary = clean(operationsSummary);
    return summary
      ? formatStructuredBullets(summary, "暂无结构化操作明细")
      : ["  · 暂无 operation 明细；请核对 write plan 文件。"];
  }

  const projectName = plan?.targetProject?.name || plan?.targetProjectId || "目标 Project";
  const grouped = new Map<string, WritePlanOperation[]>();
  for (const operation of operations) {
    const milestone = milestoneNameForOperation(operation, plan || {});
    const bucket = grouped.get(milestone) || [];
    bucket.push(operation);
    grouped.set(milestone, bucket);
  }

  const lines = [`  📁 Project：${projectName}`];
  const milestoneEntries = [...grouped.entries()];
  milestoneEntries.forEach(([milestone, bucket], milestoneIndex) => {
    const isLastMilestone = milestoneIndex === milestoneEntries.length - 1;
    const milestonePrefix = isLastMilestone ? "└─" : "├─";
    lines.push(`    ${milestonePrefix} 📌 Milestone：${milestone}`);
    bucket.forEach((operation, index) => {
      const isLastOp = index === bucket.length - 1;
      const branch = isLastMilestone ? "       " : "    │  ";
      const opPrefix = isLastOp ? "└─" : "├─";
      const opIndex = operations.indexOf(operation);
      lines.push(`${branch}${opPrefix} ${operationHeadline(operation, opIndex >= 0 ? opIndex : index)}`);
      for (const detail of operationDetailLines(operation)) {
        lines.push(`${branch}${isLastOp ? "   " : "│  "}  ${detail.trimStart()}`);
      }
    });
  });
  return lines;
}

export function buildPlanConfirmationOverview(input: PlanConfirmationViewInput, plan: WritePlanDocument | null) {
  const operations = plan?.operations || [];
  const project =
    clean(input.targetProjectSummary) ||
    plan?.targetProject?.name ||
    plan?.targetProjectId ||
    "（未提供）";
  const milestone = plan?.targetMilestoneReadback?.name || plan?.targetMilestoneId;
  const typeSummary = operations.length ? countOperationTypes(operations) : clean(input.operationsSummary) || "（未知）";
  const lines = [
    `  目标项目：${project}`,
    `  操作数量：${operations.length || "—"}（${typeSummary}）`
  ];
  if (milestone) lines.push(`  目标里程碑：${milestone}`);
  const riskPreview = clean(input.risksSummary)?.split("\n")[0] || "无额外风险摘要";
  lines.push(`  风险摘要：${truncateForDisplay(riskPreview, 60, 1)[0]}`);
  lines.push("  确认选项：Yes（认可） / No（取消） / 调整意见");
  return lines;
}

export function buildPlanConfirmationMessage(input: PlanConfirmationViewInput) {
  const cwd = input.cwd || process.cwd();
  const plan = loadWritePlanDocument(input.writePlanPath, cwd);
  const sections: string[] = [
    "请审阅以下 Linear 写入计划。本次 plan_confirmation 是唯一写入授权来源，real apply 不会再次弹窗确认。",
    ...SECTION("项目概览"),
    ...buildPlanConfirmationOverview(input, plan),
    ...SECTION("计划结构"),
    ...buildOperationStructureTree(plan, input.operationsSummary),
    ...SECTION("风险说明"),
    ...formatStructuredBullets(input.risksSummary, "未列出额外风险；仍受 quality review / dry-run / audit 约束。"),
    ...SECTION("不会变更"),
    ...formatStructuredBullets(
      input.nonChangesSummary,
      "未额外声明非变更项；请以上方 operation 列表为准。"
    ),
    ...SECTION("证据来源"),
    ...(plan?.evidenceRefs?.length
      ? plan.evidenceRefs.map(ref => `  · ${ref}`)
      : formatStructuredBullets(undefined, "未在 write plan 中记录 evidenceRefs。")),
    ...SECTION("审批绑定 · 核对用"),
    `  writePlanPath: ${input.writePlanPath}`,
    `  idempotencyKey: ${input.idempotencyKey}`,
    ...(input.planDigest ? [`  planDigest: ${input.planDigest}`] : []),
    ...SECTION("下一步"),
    "  · 选择 Yes：为当前 writePlanPath / idempotencyKey / planDigest 生成 approval artifact",
    "  · 选择 No：取消，不执行 Linear 写入",
    "  · 选择 调整意见：返回修改建议，Agent 需重算 write plan 并重新 dry-run + 确认"
  ];
  return sections.join("\n");
}

export function buildPlanConfirmationText(input: PlanConfirmationViewInput) {
  const lines = [
    "Confirmation channel: pi_ask_user plan_confirmation Yes/No/Adjustment UI.",
    "User approval: User approved exact Linear write plan during planning via Pi UI.",
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
