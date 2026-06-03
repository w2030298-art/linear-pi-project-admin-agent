import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { planConfirmationBindingError } from "./linear-write-guard.ts";

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

export async function preparePlanConfirmation(_pi: ExtensionAPI | Record<string, unknown>, params: any) {
  if (params.dryRun !== false) return { ...params, confirmedByUser: false };

  if (params.confirmationChannel === "conversation_fallback") {
    if (params.allowConversationFallback !== true) {
      throw new Error(
        "interactive confirmation unavailable; real write not applied. pi_ask_user plan_confirmation is unavailable and current-conversation fallback was not explicitly allowed."
      );
    }
    if (params.confirmedByUser !== true) {
      throw new Error(
        "pi_ask_user plan_confirmation is unavailable; request one explicit approval in the current conversation before real apply."
      );
    }
    if (!params.confirmationText?.trim()) {
      throw new Error(
        "pi_ask_user plan_confirmation is unavailable; current conversation fallback requires confirmationText with the user's explicit approval."
      );
    }
    return {
      ...params,
      confirmationChannel: "conversation_fallback"
    };
  }

  if (params.confirmedByUser !== true) {
    throw new Error(
      "linear_apply_write_plan cancelled: real writes require one plan_confirmation approval from pi_ask_user before apply."
    );
  }

  const bindingError = planConfirmationBindingError({
    writePlanPath: params.writePlanPath,
    idempotencyKey: params.idempotencyKey,
    confirmationText: params.confirmationText
  });
  if (bindingError) throw new Error(bindingError);

  return {
    ...params,
    confirmedByUser: true,
    confirmationChannel: "ask_user",
    confirmationFallbackReason: null,
    confirmationText: params.confirmationText.trim(),
    idempotencyKey: params.idempotencyKey
  };
}

export default function (pi: ExtensionAPI) {
  const callLinear = async (signal: AbortSignal | undefined, args: string[]) => {
    const result = await pi.exec("node", ["scripts/linear-cli.mjs", ...args], { signal, timeout: 120000 });
    return text(result.stdout || result.stderr || { code: result.code });
  };

  const runLowRiskWritePlan = async (signal: AbortSignal | undefined, params: any) => {
    const inputPath = path.join("state", "sessions", `low-risk-write-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(inputPath, JSON.stringify(params, null, 2));
    const args = ["scripts/low-risk-write-plan.mjs", "--input", inputPath];
    if (params.writePlanPath) args.push("--out", params.writePlanPath);
    const result = await pi.exec("node", args, { signal, timeout: 120000 });
    try {
      return text(JSON.parse(result.stdout));
    } catch {
      return text(result.stdout || result.stderr || { code: result.code });
    }
  };

  const runStructuredWritePlanBuilder = async (signal: AbortSignal | undefined, params: any) => {
    const inputPath = path.join("state", "sessions", `write-plan-builder-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(inputPath), { recursive: true });
    fs.writeFileSync(inputPath, JSON.stringify(params, null, 2));
    const args = ["scripts/write-plan-builder.mjs", "--input", inputPath];
    if (params.writePlanPath) args.push("--out", params.writePlanPath);
    const result = await pi.exec("node", args, { signal, timeout: 120000 });
    try {
      return text(JSON.parse(result.stdout));
    } catch {
      return text(result.stdout || result.stderr || { code: result.code });
    }
  };

  pi.registerTool({
    name: "linear_prepare_low_risk_write",
    label: "Prepare Low-Risk Linear Write",
    description: "Generate a standard write plan for whitelisted L1/L2 Linear writes, then return required review, dry-run, approval, and apply steps. Never performs mutations. issue_create fields may be nested under issue or passed top-level.",
    parameters: Type.Object({
      kind: Type.String({ description: "Whitelist kind: project_update or issue_create." }),
      projectBaseline: Type.Optional(Type.Any()),
      projectUpdate: Type.Optional(Type.Any()),
      issue: Type.Optional(Type.Any({ description: "For kind=issue_create: { title, description with acceptance criteria, teamKey or teamId, labels or labelNames, projectMilestoneId, projectMilestoneReadback }." })),
      source: Type.Optional(Type.Any()),
      targetProjectId: Type.Optional(Type.String()),
      writePlanPath: Type.Optional(Type.String()),
      idempotencyKey: Type.Optional(Type.String())
    }),
    promptSnippet: "linear_prepare_low_risk_write: creates whitelisted single-operation write plans; still requires quality review, dry-run, pi_ask_user approval, and real apply.",
    promptGuidelines: [
      "Use only for low-risk single Project Update or single Issue create in one Project.",
      "For kind=issue_create, pass issue.title, issue.description, issue.teamKey/teamId, issue.labels/labelNames, issue.projectMilestoneId, and issue.projectMilestoneReadback. Top-level aliases are accepted but nested issue is clearer.",
      "If the tool returns evidence_gap, stop and build or refresh a full Fact Pack instead of guessing.",
      "After it returns write_plan_ready, run the returned quality review, then dry-run, then pi_ask_user(plan_confirmation), then pass the returned confirmation fields unchanged to real apply.",
      "Do not use this for cross-Project writes, batch writes, repo-map changes, project structure changes, or relation-heavy planning."
    ],
    async execute(_id, params, signal) {
      return runLowRiskWritePlan(signal, params);
    }
  });

  pi.registerTool({
    name: "linear_build_write_plan",
    label: "Build Linear Write Plan",
    description: "Run the structured write plan builder for operations[].type values projectUpdate.create, issue.create, issue.update, and issueRelation.create. operations[].kind is accepted as an input alias, but generated plans always use type. Never performs mutations.",
    parameters: Type.Object({
      targetProjectId: Type.Optional(Type.String()),
      targetProjectName: Type.Optional(Type.String()),
      projectBaseline: Type.Optional(Type.Any()),
      workspaceManifest: Type.Optional(Type.Any()),
      workspaceManifestPath: Type.Optional(Type.String()),
      source: Type.Optional(Type.Any()),
      evidenceRefs: Type.Optional(Type.Array(Type.String())),
      operations: Type.Array(Type.Any({ description: "Each operation needs type, or kind as an input alias, plus fields. Example: { type: 'issue.create', title, description, teamKey, labelNames, milestoneName }." })),
      writePlanPath: Type.Optional(Type.String()),
      idempotencyKey: Type.Optional(Type.String())
    }),
    promptSnippet: "linear_build_write_plan: structured write plan builder that generates idempotencyKey, operation keys, summaries, and ordered quality review, dry-run, pi_ask_user approval, and real apply steps.",
    promptGuidelines: [
      "Use this to build standard write plans for projectUpdate.create, issue.create, issue.update, or issueRelation.create instead of hand-writing JSON. Put the operation discriminator at operations[].type; operations[].kind is accepted as an input alias only.",
      "Pass a workspaceManifest or workspaceManifestPath when resolving team, label, workflow state, or Project Milestone names.",
      "If the tool returns evidence_gap, stop and refresh the missing target, team, label, state, or milestone evidence instead of guessing.",
      "After it returns write_plan_ready, run quality review, then dry-run, then pi_ask_user(plan_confirmation), then pass the returned confirmation fields unchanged to real apply.",
      "The builder only creates a write plan for approval UI binding; it does not replace quality review, risk judgment, dry-run, readback diff, or audit."
    ],
    async execute(_id, params, signal) {
      return runStructuredWritePlanBuilder(signal, params);
    }
  });

  pi.registerTool({
    name: "linear_workspace_snapshot",
    label: "Linear Workspace Snapshot",
    description: "Read teams, members, labels, workflow states, and project summaries from Linear.",
    parameters: Type.Object({}),
    promptSnippet: "linear_workspace_snapshot: reads Linear workspace configuration for manifest sync.",
    async execute(_id, _params, signal) {
      return callLinear(signal, ["workspace"]);
    }
  });

  pi.registerTool({
    name: "linear_get_project_context",
    label: "Linear Project Context",
    description: "Read a Linear project with milestones, issues, relations, updates and comments. Accepts Project ID, Project URL, /overview URL, exact/normalized Project name, or slug.",
    parameters: Type.Object({ projectIdOrKey: Type.String() }),
    promptSnippet: "linear_get_project_context: resolves Project ID/URL/overview URL/exact or normalized name/slug, then reads current project management facts from Linear.",
    async execute(_id, params, signal) {
      return callLinear(signal, ["project", params.projectIdOrKey]);
    }
  });

  pi.registerTool({
    name: "linear_get_issue",
    label: "Linear Exact Issue Lookup",
    description: "Read one Linear issue by exact identifier or UUID. Use this for WEN-123 style lookups instead of full-text search.",
    parameters: Type.Object({ identifierOrId: Type.String() }),
    promptSnippet: "linear_get_issue: exact lookup for a single Linear issue by identifier or UUID.",
    async execute(_id, params, signal) {
      return callLinear(signal, ["issue", params.identifierOrId]);
    }
  });

  pi.registerTool({
    name: "linear_search_issues",
    label: "Linear Search Issues",
    description: "Full-text search Linear issues by title or description. For exact WEN-123 lookup, use linear_get_issue.",
    parameters: Type.Object({ query: Type.String(), teamKey: Type.Optional(Type.String()) }),
    async execute(_id, params, signal) {
      const args = ["issues", "--query", params.query];
      if (params.teamKey) args.push("--team", params.teamKey);
      return callLinear(signal, args);
    }
  });

  pi.registerTool({
    name: "linear_apply_write_plan",
    label: "Apply Linear Write Plan",
    description: "Compile a dry-run write plan automatically, or apply a real write plan after one plan_confirmation approval. Uses idempotency and readback.",
    parameters: Type.Object({
      writePlanPath: Type.String(),
      confirmedByUser: Type.Boolean(),
      confirmationText: Type.String(),
      confirmationChannel: Type.Optional(Type.String()),
      idempotencyKey: Type.Optional(Type.String()),
      confirmationId: Type.Optional(Type.String()),
      allowConversationFallback: Type.Optional(Type.Boolean({ default: false })),
      dryRun: Type.Optional(Type.Boolean({ default: true }))
    }),
    promptSnippet: "linear_apply_write_plan: dry-run automatically; real apply accepts one plan_confirmation result only.",
    promptGuidelines: [
      "After generating a write plan, automatically run linear_plan_quality_review and linear_apply_write_plan with dryRun=true. Dry-run is validation only and is not user confirmation.",
      "After generating the write plan, quality review, and dry-run, call pi_ask_user with flow=plan_confirmation once to show the structured Chinese confirmation UI with Yes / No / 调整意见 for the exact writePlanPath, idempotencyKey, and summaries.",
      "After the user chooses Yes, immediately call linear_apply_write_plan with dryRun=false and the confirmation fields returned by pi_ask_user. Do not show a second confirmation UI and do not ask the user to type a confirmation phrase.",
      "linear_apply_write_plan never pops its own confirmation UI; it only accepts the confirmation result produced by pi_ask_user(plan_confirmation).",
      "If pi_ask_user plan_confirmation is unavailable and conversation fallback was not explicitly allowed, real write is blocked with: interactive confirmation unavailable; real write not applied.",
      "Conversation fallback is allowed only when Pi UI is unavailable and the user explicitly allows it via allowConversationFallback=true with confirmationChannel=conversation_fallback.",
      "Never call linear_apply_write_plan with confirmedByUser=true unless the plan_confirmation result or explicit fallback approval is present."
    ],
    async execute(_id, params, signal) {
      const prepared = await preparePlanConfirmation(pi, params);
      const args = ["apply", prepared.writePlanPath, prepared.confirmedByUser ? "--confirmed" : "--not-confirmed"];
      if (prepared.dryRun === false || prepared.confirmationChannel) {
        args.push("--confirmation-channel", prepared.confirmationChannel || "ask_user");
      }
      if (prepared.confirmationText) args.push("--confirmation-text", prepared.confirmationText);
      if (prepared.confirmationId) args.push("--confirmation-id", prepared.confirmationId);
      if (prepared.dryRun !== false) args.push("--dry-run");
      return callLinear(signal, args);
    }
  });
}
