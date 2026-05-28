import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function text(content: unknown) {
  return { content: [{ type: "text" as const, text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }], details: content };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "workspace_manifest_diff",
    label: "Workspace Manifest Diff",
    description: "Read Linear workspace and compare it with config/workspace.manifest.json.",
    parameters: Type.Object({ writeDraft: Type.Optional(Type.Boolean({ default: false })) }),
    promptSnippet: "workspace_manifest_diff: detects labels, members, states and team drift.",
    async execute(_id, params, signal) {
      const args = ["scripts/workspace-sync.mjs"];
      if (params.writeDraft) args.push("--write-draft");
      const result = await pi.exec("node", args, { signal, timeout: 120000 });
      return text(result.stdout || result.stderr || { code: result.code });
    }
  });
}
