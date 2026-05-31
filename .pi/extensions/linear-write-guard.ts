import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { validateWriteConfirmationArtifact } from "./write-confirmation-artifact.ts";

const MUTATING_LINEAR_TOOLS = new Set([
  "linear_apply_write_plan"
]);

export function linearWriteGuardDecision(
  params: {
    writePlanPath?: string;
    idempotencyKey?: string;
    planDigest?: string;
    confirmationId?: string;
    confirmationText?: string;
    confirmedByUser?: boolean;
    dryRun?: boolean;
    confirmationChannel?: string;
    allowConversationFallback?: boolean;
  },
  _env: Record<string, string | undefined> = process.env
) {
  if (params.dryRun !== false) return { action: "allow" as const };

  if (params.confirmationChannel === "conversation_fallback") {
    if (params.allowConversationFallback !== true) {
      return {
        action: "block" as const,
        message:
          "Blocked linear_apply_write_plan: interactive confirmation unavailable; real write not applied unless the user explicitly allows current-conversation text fallback."
      };
    }
    if (params.confirmedByUser !== true || !params.confirmationText?.trim()) {
      return {
        action: "block" as const,
        message:
          "Blocked linear_apply_write_plan: conversation fallback requires confirmedByUser=true and confirmationText with the user's explicit approval."
      };
    }
    return { action: "allow" as const };
  }

  if (params.confirmedByUser !== true) {
    return {
      action: "block" as const,
      message:
        "Blocked linear_apply_write_plan: real writes require one Approve & Write approval from pi_ask_user(flow=write_confirmation) before apply."
    };
  }

  const validated = validateWriteConfirmationArtifact({
    writePlanPath: params.writePlanPath || "",
    idempotencyKey: params.idempotencyKey,
    planDigest: params.planDigest,
    confirmationId: params.confirmationId,
    confirmationText: params.confirmationText,
    confirmationChannel: params.confirmationChannel || "ask_user",
    confirmedByUser: params.confirmedByUser
  });
  if (!validated.ok) {
    return { action: "block" as const, message: `Blocked linear_apply_write_plan: ${validated.message}` };
  }

  return { action: "allow" as const };
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
