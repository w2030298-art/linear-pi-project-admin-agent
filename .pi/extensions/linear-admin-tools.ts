import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
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
    description: "Apply a dry-run write plan after explicit user confirmation. Uses idempotency and readback.",
    parameters: Type.Object({
      writePlanPath: Type.String(),
      confirmedByUser: Type.Boolean(),
      confirmationText: Type.String(),
      dryRun: Type.Optional(Type.Boolean({ default: true }))
    }),
    promptSnippet: "linear_apply_write_plan: applies a confirmed Linear write plan with guardrails.",
    promptGuidelines: [
      "Use ask_user exactly once to ask the user to approve or reject the exact dry-run write plan.",
      "Do not ask the user to type a fixed confirmation phrase; the ask_user approval is the confirmation.",
      "After ask_user approval, call linear_apply_write_plan with confirmedByUser=true and a confirmationText that summarizes the ask_user approval.",
      "Never call linear_apply_write_plan with confirmedByUser=true unless the user approval is present in the current conversation or Linear comment."
    ],
    async execute(_id, params, signal) {
      const args = ["apply", params.writePlanPath, params.confirmedByUser ? "--confirmed" : "--not-confirmed"];
      if (params.dryRun !== false) args.push("--dry-run");
      return callLinear(signal, args);
    }
  });
}
