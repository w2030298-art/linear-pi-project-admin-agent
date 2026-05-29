import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MUTATING_LINEAR_TOOLS = new Set([
  "linear_apply_write_plan"
]);

export function linearWriteGuardDecision(
  params: { confirmedByUser?: boolean },
  _env: Record<string, string | undefined> = process.env
) {
  if (params.confirmedByUser === true) return { action: "allow" as const };

  return {
    action: "block" as const,
    message:
      "Blocked linear_apply_write_plan: use ask_user exactly once to approve the exact dry-run plan, then call with confirmedByUser=true."
  };
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event: any) => {
    const name = event?.toolName || event?.name;
    if (!MUTATING_LINEAR_TOOLS.has(name)) return;

    const params = event?.input || event?.params || event?.arguments || {};
    const decision = linearWriteGuardDecision(params);
    if (decision.action === "block") throw new Error(decision.message);
  });
}
