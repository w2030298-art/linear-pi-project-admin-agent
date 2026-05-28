import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fact_pack_build",
    label: "Build Fact Pack",
    description: "Build a Fact Pack from Linear, GitHub, local repo/docs, and optional web search before planning.",
    parameters: Type.Object({
      task: Type.String({ description: "Planning/reporting task that needs evidence." }),
      linearProjectIdOrKey: Type.Optional(Type.String()),
      repoKey: Type.Optional(Type.String()),
      includeGitHub: Type.Optional(Type.Boolean({ default: true })),
      includeLocal: Type.Optional(Type.Boolean({ default: true })),
      includeWeb: Type.Optional(Type.Boolean({ default: false })),
      query: Type.Optional(Type.String())
    }),
    promptSnippet: "fact_pack_build: builds a cited Fact Pack before Linear planning.",
    promptGuidelines: [
      "Use fact_pack_build before create_project, extend_project, cycle_plan, portfolio_review, project_report, and issue_dispatch tasks.",
      "fact_pack_build does not write to Linear; it returns facts, assumptions, conflicts, evidence gaps, and planning implications."
    ],
    async execute(_toolCallId, params, signal) {
      const args = ["scripts/fact-pack.mjs", "--task", params.task];
      if (params.linearProjectIdOrKey) args.push("--linear", params.linearProjectIdOrKey);
      if (params.repoKey) args.push("--repo", params.repoKey);
      if (params.includeGitHub === false) args.push("--no-github");
      if (params.includeLocal === false) args.push("--no-local");
      if (params.includeWeb) args.push("--web");
      if (params.query) args.push("--query", params.query);
      const result = await pi.exec("node", args, { signal, timeout: 120000 });
      return text(result.stdout || result.stderr || { code: result.code });
    }
  });

  pi.registerTool({
    name: "fact_conflict_report",
    label: "Fact Conflict Report",
    description: "Summarize conflicts in the latest Fact Pack and indicate which source should win.",
    parameters: Type.Object({ factPackPath: Type.Optional(Type.String()) }),
    async execute(_id, params, signal) {
      const args = ["scripts/fact-pack.mjs", "conflicts"];
      if (params.factPackPath) args.push(params.factPackPath);
      const result = await pi.exec("node", args, { signal, timeout: 30000 });
      return text(result.stdout || result.stderr || { code: result.code });
    }
  });
}
