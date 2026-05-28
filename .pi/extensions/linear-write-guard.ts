import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MUTATING_LINEAR_TOOLS = new Set([
  "linear_apply_write_plan"
]);

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event: any, ctx: any) => {
    const name = event?.toolName || event?.name;
    if (!MUTATING_LINEAR_TOOLS.has(name)) return;

    const params = event?.params || event?.arguments || {};
    if (params.confirmedByUser !== true) {
      throw new Error(`Blocked ${name}: confirmedByUser=true is required.`);
    }

    const allowWrites = process.env.ALLOW_LINEAR_WRITES === "true";
    if (!allowWrites) {
      const ok = await ctx.ui.confirm(
        "Linear write requested",
        "ALLOW_LINEAR_WRITES is not true. Confirm one-time execution for this call?"
      );
      if (!ok) throw new Error(`Blocked ${name}: user denied write.`);
    }
  });
}
