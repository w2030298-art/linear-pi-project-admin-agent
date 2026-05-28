import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "github_repo_snapshot",
    label: "GitHub Repo Snapshot",
    description: "Collect repository facts via GitHub MCP when configured, or REST fallback.",
    parameters: Type.Object({
      owner: Type.String(),
      repo: Type.String(),
      ref: Type.Optional(Type.String()),
      includePullRequests: Type.Optional(Type.Boolean({ default: true })),
      includeActions: Type.Optional(Type.Boolean({ default: true }))
    }),
    promptSnippet: "github_repo_snapshot: reads GitHub repository facts for planning.",
    promptGuidelines: [
      "Use github_repo_snapshot before architecture decomposition when a Linear project maps to a repo.",
      "Do not treat GitHub data as Linear project state; use it as engineering evidence."
    ],
    async execute(_id, params, signal) {
      const args = ["scripts/github-evidence.mjs", "snapshot", "--owner", params.owner, "--repo", params.repo];
      if (params.ref) args.push("--ref", params.ref);
      if (params.includePullRequests === false) args.push("--no-prs");
      if (params.includeActions === false) args.push("--no-actions");
      const result = await pi.exec("node", args, { signal, timeout: 120000 });
      return text(result.stdout || result.stderr || { code: result.code });
    }
  });

  pi.registerTool({
    name: "github_file_read",
    label: "GitHub File Read",
    description: "Read a file from a GitHub repository via REST fallback. Prefer GitHub MCP host if active.",
    parameters: Type.Object({ owner: Type.String(), repo: Type.String(), path: Type.String(), ref: Type.Optional(Type.String()) }),
    async execute(_id, params, signal) {
      const args = ["scripts/github-evidence.mjs", "file", "--owner", params.owner, "--repo", params.repo, "--path", params.path];
      if (params.ref) args.push("--ref", params.ref);
      const result = await pi.exec("node", args, { signal, timeout: 60000 });
      return text(result.stdout || result.stderr || { code: result.code });
    }
  });
}
