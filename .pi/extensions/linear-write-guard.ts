import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MUTATING_LINEAR_TOOLS = new Set([
  "linear_apply_write_plan"
]);

export function linearWriteGuardDecision(
  params: { confirmedByUser?: boolean; dryRun?: boolean; confirmationText?: string; confirmationChannel?: string },
  _env: Record<string, string | undefined> = process.env
) {
  if (params.dryRun !== false) return { action: "allow" as const };
  if (params.confirmationChannel === "ask_user" && params.confirmedByUser !== true) {
    return { action: "allow" as const };
  }
  if (params.confirmedByUser === true) {
    const confirmationText = params.confirmationText || "";
    if (params.confirmationChannel === "conversation_fallback") {
      if (!confirmationText.trim()) {
        return {
          action: "block" as const,
          message:
            "Blocked linear_apply_write_plan: conversation fallback requires confirmationText with the user's explicit approval."
        };
      }
    }
    return { action: "allow" as const };
  }

  return {
    action: "block" as const,
    message:
      "Blocked linear_apply_write_plan: use ask_user exactly once to approve the exact dry-run plan, or explicitly tell the user that current conversation approval fallback will be used when generic ask_user is unavailable. Then call with confirmedByUser=true and confirmationText."
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
