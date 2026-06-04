import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  buildPlanConfirmationMessage,
  buildPlanConfirmationText,
  PLAN_CONFIRMATION_UI_TITLE
} from "../../scripts/plan-confirmation-ui.ts";
import {
  findLinearProjectInWorkspace,
  runRepoMapAskFlow,
  type FlowOptions,
  type RepoMapAskContext
} from "./lib/repo-map-draft.ts";
import { runProjectSelectionFlow } from "./lib/project-select.ts";

export { parseGitHubUrl } from "./lib/github-url.ts";
export {
  buildRepoMapDraft,
  createNonInteractiveRepoMapResult,
  findLinearProjectInWorkspace,
  runRepoMapAskFlow,
  validateRepoMapInputs,
  type RepoMapInputs
} from "./lib/repo-map-draft.ts";
export { CUSTOM_PROJECT_INPUT_LABEL, listRegisteredProjectChoices, runProjectSelectionFlow } from "./lib/project-select.ts";

type InputValue = string | undefined;

interface LinearResolution {
  ok: boolean;
  error?: string;
  project?: unknown;
}

export interface PlanConfirmationInputs {
  writePlanPath: string;
  idempotencyKey: string;
  targetProjectSummary?: string;
  operationsSummary?: string;
  risksSummary?: string;
  nonChangesSummary?: string;
}

type PlanConfirmationChoice = "Yes" | "No" | "调整意见";

const PLAN_CONFIRMATION_CHOICES: PlanConfirmationChoice[] = ["Yes", "No", "调整意见"];

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

function clean(value: InputValue) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function createNonInteractivePlanConfirmationResult(inputs: PlanConfirmationInputs = { writePlanPath: "", idempotencyKey: "" }) {
  return {
    ok: false,
    status: "interactive_confirmation_unavailable" as const,
    approved: false,
    writesPerformed: false,
    writePlanPath: clean(inputs.writePlanPath),
    idempotencyKey: clean(inputs.idempotencyKey),
    evidenceGaps: ["Pi UI is not available; pi_ask_user plan_confirmation cannot show Yes / No / 调整意见."],
    openQuestions: [
      "Real Linear write is blocked until pi_ask_user(flow=plan_confirmation) approves the exact write plan."
    ]
  };
}

function normalizedPlanChoice(value: string | undefined): PlanConfirmationChoice | undefined {
  const answer = clean(value);
  if (!answer) return undefined;
  const lower = answer.toLowerCase();
  if (lower === "yes" || answer === "认可当前计划") return "Yes";
  if (lower === "no" || answer === "取消本次计划") return "No";
  if (answer === "调整意见" || lower === "adjustment" || lower === "revise" || lower === "revision") return "调整意见";
  return undefined;
}

export async function runPlanConfirmationFlow(ctx: RepoMapAskContext, inputs: PlanConfirmationInputs) {
  const writePlanPath = clean(inputs.writePlanPath);
  const idempotencyKey = clean(inputs.idempotencyKey);
  if (!writePlanPath || !idempotencyKey) {
    return {
      ok: false,
      status: "evidence_gap" as const,
      approved: false,
      writesPerformed: false,
      evidenceGaps: ["plan_confirmation requires writePlanPath and idempotencyKey from the exact write plan."],
      openQuestions: ["Provide writePlanPath and idempotencyKey before requesting plan confirmation."]
    };
  }

  if (!ctx.hasUI || (typeof ctx.ui.select !== "function" && typeof ctx.ui.input !== "function")) {
    return createNonInteractivePlanConfirmationResult({ ...inputs, writePlanPath, idempotencyKey });
  }

  const message = buildPlanConfirmationMessage({
    writePlanPath,
    idempotencyKey,
    targetProjectSummary: clean(inputs.targetProjectSummary),
    operationsSummary: clean(inputs.operationsSummary),
    risksSummary: clean(inputs.risksSummary),
    nonChangesSummary: clean(inputs.nonChangesSummary),
  });
  const rawChoice = typeof ctx.ui.select === "function"
    ? await ctx.ui.select(`${PLAN_CONFIRMATION_UI_TITLE}\n\n${message}`, PLAN_CONFIRMATION_CHOICES)
    : await ctx.ui.input(`${PLAN_CONFIRMATION_UI_TITLE}\n\n${message}`, PLAN_CONFIRMATION_CHOICES.join(" | "));
  const choice = normalizedPlanChoice(rawChoice);

  if (choice === "No" || !choice) {
    return {
      ok: false,
      status: "cancelled" as const,
      approved: false,
      writesPerformed: false,
      writePlanPath,
      idempotencyKey,
      confirmationChannel: "ask_user" as const,
      evidenceGaps: ["Plan confirmation was cancelled; real Linear write was not applied."],
      openQuestions: ["Generate a new write plan and call pi_ask_user(flow=plan_confirmation) again before real apply."]
    };
  }

  if (choice === "调整意见") {
    const feedback = clean(await ctx.ui.input("调整意见", "Describe how the Agent should revise the write plan."));
    if (!feedback) {
      return {
        ok: false,
        status: "cancelled" as const,
        approved: false,
        writesPerformed: false,
        writePlanPath,
        idempotencyKey,
        evidenceGaps: ["Plan revision was requested but no adjustment feedback was provided."],
        openQuestions: ["Provide adjustment feedback, then regenerate the write plan and request plan confirmation again."]
      };
    }
    return {
      ok: false,
      status: "revision_requested" as const,
      approved: false,
      writesPerformed: false,
      feedback,
      writePlanPath,
      idempotencyKey,
      evidenceGaps: [],
      openQuestions: [`User requested plan adjustment: ${feedback}`],
      nextActions: ["Rewrite the write plan from the adjustment feedback, run quality review and dry-run again, then call pi_ask_user(flow=plan_confirmation) again."]
    };
  }

  const confirmationText = buildPlanConfirmationText({
    writePlanPath,
    idempotencyKey,
    targetProjectSummary: clean(inputs.targetProjectSummary),
    operationsSummary: clean(inputs.operationsSummary),
    risksSummary: clean(inputs.risksSummary),
    nonChangesSummary: clean(inputs.nonChangesSummary),
  });

  return {
    ok: true,
    status: "approved" as const,
    approved: true,
    writesPerformed: false,
    confirmedByUser: true,
    confirmationChannel: "ask_user" as const,
    confirmationText,
    writePlanPath,
    idempotencyKey
  };
}

async function resolveLinearProjectWithCli(pi: ExtensionAPI, signal: AbortSignal | undefined, project: string): Promise<LinearResolution> {
  const result = await pi.exec("node", ["scripts/linear-cli.mjs", "project", project], { signal, timeout: 120000 });
  let directError = result.stderr || result.stdout || `linear-cli exited ${result.code}`;
  try {
    const parsed = JSON.parse(result.stdout);
    if (result.code === 0 && parsed?.ok && parsed?.data?.project) return { ok: true, project: parsed.data.project };
    directError = `Linear Project not found: ${project}`;
  } catch (err) {
    directError = err instanceof Error ? err.message : String(err);
  }

  const workspace = await pi.exec("node", ["scripts/linear-cli.mjs", "workspace"], { signal, timeout: 120000 });
  if (workspace.code !== 0) return { ok: false, error: workspace.stderr || directError };
  try {
    const parsed = JSON.parse(workspace.stdout);
    const match = findLinearProjectInWorkspace(project, parsed?.projects || []);
    return match ? { ok: true, project: match } : { ok: false, error: directError };
  } catch {
    return { ok: false, error: directError };
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "pi_ask_user",
    label: "Ask User",
    description: "Ask the user to choose a local project, complete repo-map fields, or approve/cancel/revise a Linear write plan. Never performs Linear mutations by itself.",
    parameters: Type.Object({
      flow: Type.Optional(Type.String({ description: "Supports project_select, repo_map, and plan_confirmation." })),
      seed: Type.Optional(Type.Object({
        projectId: Type.Optional(Type.String()),
        githubUrl: Type.Optional(Type.String()),
        linearProjectId: Type.Optional(Type.String()),
        linearProject: Type.Optional(Type.String()),
        localRepoPath: Type.Optional(Type.String()),
        repoKey: Type.Optional(Type.String()),
        defaultBranch: Type.Optional(Type.String())
      })),
      writePlanPath: Type.Optional(Type.String()),
      idempotencyKey: Type.Optional(Type.String()),
      targetProjectSummary: Type.Optional(Type.String()),
      operationsSummary: Type.Optional(Type.String()),
      risksSummary: Type.Optional(Type.String()),
      nonChangesSummary: Type.Optional(Type.String()),
      repoMapPath: Type.Optional(Type.String()),
      localRepoMapPath: Type.Optional(Type.String()),
      customLabel: Type.Optional(Type.String()),
      maxRetries: Type.Optional(Type.Number({ default: 2 }))
    }),
    promptSnippet: "pi_ask_user: Pi UI for project selection, repo-map clarification, or planning-time write-plan confirmation.",
    promptGuidelines: [
      "For single-project planning/reporting/review tasks without an explicit target, call pi_ask_user with flow=project_select before reading Linear.",
      "Project selection options must come from the local repo-map, with User input as the last option; do not list projects from Linear before the user selects one.",
      "Use pi_ask_user for repo-map gaps when GitHub, Linear Project, and local repo facts do not line up.",
      "After generating the write plan, quality review, and dry-run, call pi_ask_user with flow=plan_confirmation to show the structured Chinese confirmation UI (项目概览 / 计划结构树 / 风险 / 审批绑定) with Yes / No / 调整意见 for the exact writePlanPath, idempotencyKey, and summaries.",
      "If plan_confirmation returns revision_requested, rewrite the plan from feedback, rerun quality review and dry-run, then call plan_confirmation again.",
      "If plan_confirmation returns cancelled or interactive_confirmation_unavailable, do not apply real Linear mutations.",
      "When plan_confirmation returns approved, immediately call linear_apply_write_plan(dryRun=false) with the returned confirmation fields. Do not show a second confirmation UI.",
      "Ask one field at a time for repo_map; do not present a multi-field table.",
      "If the result is cancelled or needs_interactive_input, do not modify repo-map files.",
      "The returned repo-map draft is review-only; apply it with repo-map-drift only after separate explicit confirmation; the default target is the local overlay, not tracked config."
    ],
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (params.flow === "project_select") {
        const result = await runProjectSelectionFlow(ctx, {
          cwd: process.cwd(),
          repoMapPath: params.repoMapPath,
          localRepoMapPath: params.localRepoMapPath,
          seed: params.seed,
          customLabel: params.customLabel
        });
        return text(result);
      }

      if (params.flow === "plan_confirmation") {
        const result = await runPlanConfirmationFlow(ctx, {
          writePlanPath: params.writePlanPath || "",
          idempotencyKey: params.idempotencyKey || "",
          targetProjectSummary: params.targetProjectSummary,
          operationsSummary: params.operationsSummary,
          risksSummary: params.risksSummary,
          nonChangesSummary: params.nonChangesSummary,
        });
        return text(result);
      }

      if (params.flow && params.flow !== "repo_map") {
        return text({ ok: false, status: "unsupported_flow", evidenceGaps: [`Unsupported pi_ask_user flow: ${params.flow}`], writesPerformed: false });
      }

      const repoMapOptions: FlowOptions = {
        cwd: process.cwd(),
        repoMapPath: params.repoMapPath,
        localRepoMapPath: params.localRepoMapPath,
        seed: params.seed,
        maxRetries: params.maxRetries,
        resolveLinearProject: project => resolveLinearProjectWithCli(pi, signal, project)
      };
      const result = await runRepoMapAskFlow(ctx, repoMapOptions);
      return text(result);
    }
  });
}
