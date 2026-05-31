import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { consumeWriteConfirmationArtifact } from "./write-confirmation-artifact.ts";

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

function genericAskUser(pi: any, ctx?: Partial<ExtensionContext> | null) {
  if (ctx?.hasUI && typeof ctx?.ui?.confirm === "function") {
    return async (request: { title: string; message: string }) => ctx.ui!.confirm(request.title, request.message);
  }

  const candidates = [
    { fn: pi?.ask_user, owner: pi },
    { fn: pi?.askUser, owner: pi },
    { fn: pi?.ui?.ask_user, owner: pi?.ui },
    { fn: pi?.ui?.askUser, owner: pi?.ui }
  ];
  const match = candidates.find(candidate => typeof candidate.fn === "function");
  return match ? match.fn.bind(match.owner) : null;
}

export async function prepareWriteConfirmation(pi: ExtensionAPI | Record<string, unknown>, params: any, ctx?: Partial<ExtensionContext> | null) {
  if (params.dryRun !== false) return { ...params };

  if (params.confirmationChannel === "ask_user" || params.confirmationChannel === undefined) {
    if (params.confirmedByUser !== true) {
      throw new Error(
        "linear_apply_write_plan cancelled: real writes require pi_ask_user(flow=write_confirmation) approval before apply."
      );
    }

    const consumed = consumeWriteConfirmationArtifact({
      writePlanPath: params.writePlanPath,
      idempotencyKey: params.idempotencyKey,
      planDigest: params.planDigest,
      confirmationId: params.confirmationId,
      confirmationText: params.confirmationText,
      confirmationChannel: params.confirmationChannel,
      confirmedByUser: params.confirmedByUser
    });
    if (!consumed.ok) {
      throw new Error(consumed.message);
    }

    return {
      ...params,
      confirmedByUser: true,
      confirmationChannel: "ask_user",
      confirmationFallbackReason: null,
      confirmationText: consumed.artifact.confirmationText,
      confirmationId: consumed.artifact.confirmationId,
      idempotencyKey: consumed.artifact.idempotencyKey,
      planDigest: consumed.artifact.planDigest
    };
  }

  if (params.allowConversationFallback !== true) {
    throw new Error(
      "interactive confirmation unavailable; real write not applied. pi_ask_user write_confirmation is unavailable and current-conversation fallback was not explicitly allowed."
    );
  }
  if (params.confirmedByUser !== true) {
    throw new Error(
      "pi_ask_user write_confirmation is unavailable; request one explicit approval in the current conversation before real apply."
    );
  }
  if (!params.confirmationText?.trim()) {
    throw new Error(
      "pi_ask_user write_confirmation is unavailable; current conversation fallback requires confirmationText with the user's explicit approval."
    );
  }
  return {
    ...params,
    confirmationChannel: params.confirmationChannel || "conversation_fallback"
  };
}

export default function (pi: ExtensionAPI) {
  const callLinear = async (signal: AbortSignal | undefined, args: string[]) => {
    const result = await pi.exec("node", ["scripts/linear-cli.mjs", ...args], { signal, timeout: 120000 });
    return text(result.stdout || result.stderr || { code: result.code });
  };

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
    description: "Compile a dry-run write plan, or apply a real write plan after explicit user confirmation. Uses idempotency and readback.",
    parameters: Type.Object({
      writePlanPath: Type.String(),
      confirmedByUser: Type.Boolean(),
      confirmationText: Type.String(),
      confirmationChannel: Type.Optional(Type.String()),
      idempotencyKey: Type.Optional(Type.String()),
      confirmationId: Type.Optional(Type.String()),
      planDigest: Type.Optional(Type.String()),
      allowConversationFallback: Type.Optional(Type.Boolean({ default: false })),
      dryRun: Type.Optional(Type.Boolean({ default: true }))
    }),
    promptSnippet: "linear_apply_write_plan: applies a confirmed Linear write plan with guardrails.",
    promptGuidelines: [
      "Dry-run compilation does not require user approval and should be called with dryRun=true.",
      "After dry-run succeeds, call pi_ask_user with flow=write_confirmation for the exact writePlanPath and idempotencyKey before any real apply.",
      "Do not ask the user to type a fixed confirmation phrase; the pi_ask_user write_confirmation approval is the confirmation.",
      "If pi_ask_user write_confirmation is unavailable in the current host and text fallback was not explicitly allowed, real write is blocked with: interactive confirmation unavailable; real write not applied.",
      "When the user explicitly allows current conversation text fallback, call linear_apply_write_plan with dryRun=false, confirmedByUser=true, confirmationChannel=conversation_fallback, allowConversationFallback=true, and confirmationText containing the user's exact approval.",
      "After pi_ask_user write_confirmation approval, call linear_apply_write_plan with dryRun=false, confirmedByUser=true, confirmationChannel=ask_user, writePlanPath, idempotencyKey, confirmationText, and confirmationId from the approval result.",
      "Never call linear_apply_write_plan with confirmedByUser=true unless the user approval is present in the current conversation or Linear comment."
    ],
    async execute(_id, params, signal, _onUpdate, ctx) {
      const prepared = await prepareWriteConfirmation(pi, params, ctx);
      const askUserAvailable = Boolean(genericAskUser(pi, ctx));
      const inferredChannel = askUserAvailable
        ? "ask_user"
        : (params.allowConversationFallback === true || params.confirmationChannel === "conversation_fallback")
          ? "conversation_fallback"
          : "unavailable";
      const args = ["apply", prepared.writePlanPath, prepared.confirmedByUser ? "--confirmed" : "--not-confirmed"];
      args.push("--confirmation-channel", prepared.confirmationChannel || inferredChannel);
      if (prepared.confirmationText) args.push("--confirmation-text", prepared.confirmationText);
      if (prepared.dryRun !== false) args.push("--dry-run");
      return callLinear(signal, args);
    }
  });
}
