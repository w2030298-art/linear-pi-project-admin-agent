import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_research",
    label: "Web Research",
    description: "Search the web for current official docs and external technical facts using Tavily or Brave.",
    parameters: Type.Object({
      query: Type.String(),
      provider: Type.Optional(Type.String({ enum: ["tavily", "brave"] })),
      maxResults: Type.Optional(Type.Number({ default: 8 })),
      includeDomains: Type.Optional(Type.Array(Type.String())),
      requireOfficialSources: Type.Optional(Type.Boolean({ default: false }))
    }),
    promptSnippet: "web_research: searches web for current external facts and returns citations.",
    promptGuidelines: [
      "Use web_research for current or external facts that may have changed.",
      "web_research results must be cited and may not override Linear/GitHub/local facts."
    ],
    async execute(_id, params, signal) {
      const args = ["scripts/web-search.mjs", "--query", params.query, "--max", String(params.maxResults ?? 8)];
      if (params.provider) args.push("--provider", params.provider);
      if (params.requireOfficialSources) args.push("--official");
      for (const d of params.includeDomains ?? []) args.push("--domain", d);
      const result = await pi.exec("node", args, { signal, timeout: 120000 });
      return text(result.stdout || result.stderr || { code: result.code });
    }
  });
}
