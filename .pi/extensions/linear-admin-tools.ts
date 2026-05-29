import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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

function approvedAskUserResponse(response: any) {
  if (response === true) return true;
  if (typeof response === "string") return /^(approve|approved|yes|确认|同意)$/i.test(response.trim());
  const value = response?.value || response?.choice || response?.action || response?.status;
  if (typeof value === "string") return /^(approve|approved|yes|确认|同意)$/i.test(value.trim());
  return response?.approved === true || response?.ok === true;
}

export async function prepareWriteConfirmation(pi: ExtensionAPI | Record<string, unknown>, params: any, ctx?: Partial<ExtensionContext> | null) {
  if (params.dryRun !== false) return { ...params };

  const askUser = genericAskUser(pi, ctx);
  if (askUser) {
    const response = await askUser({
      title: "Approve Linear write plan",
      message: [
        "Review the dry-run output for this exact write plan before approving.",
        `Write plan: ${params.writePlanPath}`,
        "Choose approve to run the Linear mutations, or cancel to keep dry-run only."
      ].join("\n"),
      options: [
        { label: "Approve", value: "approve" },
        { label: "Cancel", value: "cancel" }
      ]
    });
    if (!approvedAskUserResponse(response)) {
      throw new Error("linear_apply_write_plan cancelled: ask_user approve/cancel did not approve the write.");
    }
    return {
      ...params,
      confirmedByUser: true,
      confirmationChannel: "ask_user",
      confirmationText: params.confirmationText || "ask_user approved the exact dry-run write plan."
    };
  }

  if (params.confirmedByUser !== true) {
    throw new Error(
      "Generic ask_user is unavailable; pi_ask_user is repo-map only and cannot confirm Linear writes. Request one explicit approval in the current conversation before real apply."
    );
  }
  if (!params.confirmationText?.trim()) {
    throw new Error(
      "Generic ask_user is unavailable; current conversation fallback requires confirmationText with the user's explicit approval."
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
    description: "Read teams, members, labels, workflow states, cycles and project summaries from Linear.",
    parameters: Type.Object({}),
    promptSnippet: "linear_workspace_snapshot: reads Linear workspace configuration for manifest sync.",
    async execute(_id, _params, signal) {
      return callLinear(signal, ["workspace"]);
    }
  });

  pi.registerTool({
    name: "linear_get_project_context",
    label: "Linear Project Context",
    description: "Read a Linear project with milestones, issues, relations, updates and comments.",
    parameters: Type.Object({ projectIdOrKey: Type.String() }),
    promptSnippet: "linear_get_project_context: reads current project management facts from Linear.",
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
      dryRun: Type.Optional(Type.Boolean({ default: true }))
    }),
    promptSnippet: "linear_apply_write_plan: applies a confirmed Linear write plan with guardrails.",
    promptGuidelines: [
      "Dry-run compilation does not require user approval and should be called with dryRun=true.",
      "Use ask_user exactly once through the Pi UI confirmation channel before real Linear writes to ask the user to approve or reject the exact dry-run write plan.",
      "Do not ask the user to type a fixed confirmation phrase; the ask_user approval is the confirmation.",
      "If ask_user is not available in the current host, say that generic ask_user is unavailable, pi_ask_user is repo-map only, and current conversation explicit approval fallback will be used.",
      "When using current conversation explicit approval fallback, call linear_apply_write_plan with dryRun=false, confirmedByUser=true, confirmationChannel=conversation_fallback, and confirmationText containing the user's exact approval.",
      "After ask_user approval, call linear_apply_write_plan with dryRun=false, confirmedByUser=true, confirmationChannel=ask_user, and a confirmationText that summarizes the ask_user approval.",
      "Never call linear_apply_write_plan with confirmedByUser=true unless the user approval is present in the current conversation or Linear comment."
    ],
    async execute(_id, params, signal, _onUpdate, ctx) {
      const prepared = await prepareWriteConfirmation(pi, params, ctx);
      const inferredChannel = genericAskUser(pi, ctx) ? "ask_user" : "conversation_fallback";
      const args = ["apply", prepared.writePlanPath, prepared.confirmedByUser ? "--confirmed" : "--not-confirmed"];
      args.push("--confirmation-channel", prepared.confirmationChannel || inferredChannel);
      if (prepared.confirmationText) args.push("--confirmation-text", prepared.confirmationText);
      if (prepared.dryRun !== false) args.push("--dry-run");
      return callLinear(signal, args);
    }
  });
}
