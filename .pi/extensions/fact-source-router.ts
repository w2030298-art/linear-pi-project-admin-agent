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
      linearProjectIdOrKey: Type.Optional(Type.String({ description: "Project ID, Linear Project URL, /overview URL, exact/normalized Project name, or slug." })),
      repoKey: Type.Optional(Type.String()),
      includeGitHub: Type.Optional(Type.Boolean({ default: true })),
      includeLocal: Type.Optional(Type.Boolean({ default: true })),
      includeWeb: Type.Optional(Type.Boolean({ default: false })),
      query: Type.Optional(Type.String())
    }),
    promptSnippet: "fact_pack_build: builds a cited Fact Pack before Linear planning.",
    promptGuidelines: [
      "Use fact_pack_build before create_project, extend_project, single_project_review, project_report, and issue_dispatch tasks.",
      "linearProjectIdOrKey accepts a Project ID, Linear Project URL, /overview URL, exact/normalized Project name, or slug; unresolved or ambiguous locators must stay as project-selection evidence gaps.",
      "When no project is specified, call pi_ask_user with flow=project_select first; its options come from the local repo-map, not Linear.",
      "For report, extend_project, and issue_dispatch, load the compact Project baseline from the returned Fact Pack before calling linear_get_project_context again.",
      "Only call linear_get_project_context after Fact Pack baseline load reports absent, stale, or insufficient fields.",
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
    name: "fact_project_baseline_load",
    label: "Load Fact Pack Project Baseline",
    description: "Load a compact Project baseline and raw evidenceRef from a Fact Pack. Use this before re-reading full Linear project context.",
    parameters: Type.Object({
      factPackPath: Type.String(),
      maxAgeHours: Type.Optional(Type.Number({ default: 24 }))
    }),
    promptSnippet: "fact_project_baseline_load: reuses Fact Pack Project baseline; call live Linear context only when absent, stale, or insufficient.",
    promptGuidelines: [
      "Use after fact_pack_build for project_report, extend_project, and issue_dispatch.",
      "If shouldReadLive=false, cite baseline and evidenceRef instead of pasting raw JSON or calling linear_get_project_context.",
      "If status is absent, stale, or insufficient, call linear_get_project_context and record the refreshed evidence path."
    ],
    async execute(_id, params, signal) {
      const args = ["scripts/fact-pack.mjs", "baseline", params.factPackPath];
      if (params.maxAgeHours !== undefined) args.push("--max-age-hours", String(params.maxAgeHours));
      const result = await pi.exec("node", args, { signal, timeout: 30000 });
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
