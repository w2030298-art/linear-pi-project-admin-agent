import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MUTATING_LINEAR_TOOLS = new Set([
  "linear_apply_write_plan"
]);

export function linearWriteGuardDecision(
  params: { confirmedByUser?: boolean; dryRun?: boolean; confirmationText?: string; confirmationChannel?: string; allowConversationFallback?: boolean },
  _env: Record<string, string | undefined> = process.env
) {
  if (params.dryRun !== false) return { action: "allow" as const };
  if (params.confirmationChannel === "ask_user" && params.confirmedByUser !== true) {
    return {
      action: "block" as const,
      message: "Blocked linear_apply_write_plan: real writes require pi_ask_user(flow=write_confirmation) approval before apply."
    };
  }
  if (params.confirmationChannel === "ask_user" && params.confirmedByUser === true) {
    if (!params.idempotencyKey?.trim()) {
      return {
        action: "block" as const,
        message: "Blocked linear_apply_write_plan: ask_user apply requires idempotencyKey from pi_ask_user write_confirmation."
      };
    }
  }
  if (params.confirmedByUser === true) {
    const confirmationText = params.confirmationText || "";
    if (params.confirmationChannel === "conversation_fallback") {
      if (params.allowConversationFallback !== true) {
        return {
          action: "block" as const,
          message:
            "Blocked linear_apply_write_plan: interactive confirmation unavailable; real write not applied unless the user explicitly allows current-conversation text fallback."
        };
      }
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
      "Blocked linear_apply_write_plan: call pi_ask_user(flow=write_confirmation) exactly once to approve the exact dry-run plan before apply. If pi_ask_user write_confirmation is unavailable, real writes are blocked unless the user explicitly allows current-conversation text fallback and the call includes allowConversationFallback=true, confirmationChannel=conversation_fallback, and confirmationText."
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
