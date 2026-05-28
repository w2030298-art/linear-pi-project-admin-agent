import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "local_repo_snapshot",
    label: "Local Repo Snapshot",
    description: "Read local repository branch, commit, dirty status, manifests, docs and selected files from allowlisted paths.",
    parameters: Type.Object({ root: Type.String(), query: Type.Optional(Type.String()) }),
    promptSnippet: "local_repo_snapshot: reads local working-copy facts with branch/commit/dirty status.",
    async execute(_id, params, signal) {
      const args = ["scripts/local-evidence.mjs", "--root", params.root];
      if (params.query) args.push("--query", params.query);
      const result = await pi.exec("node", args, { signal, timeout: 120000 });
      return text(result.stdout || result.stderr || { code: result.code });
    }
  });

  pi.registerTool({
    name: "local_docs_search",
    label: "Local Docs Search",
    description: "Search local documents in allowlisted document roots.",
    parameters: Type.Object({ query: Type.String(), root: Type.Optional(Type.String()) }),
    async execute(_id, params, signal) {
      const args = ["scripts/local-evidence.mjs", "docs", "--query", params.query];
      if (params.root) args.push("--root", params.root);
      const result = await pi.exec("node", args, { signal, timeout: 60000 });
      return text(result.stdout || result.stderr || { code: result.code });
    }
  });
}
