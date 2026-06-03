import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MUTATING_LINEAR_TOOLS = new Set([
  "linear_apply_write_plan"
]);

function clean(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || "";
}

export function planConfirmationBindingError(params: {
  writePlanPath?: string;
  idempotencyKey?: string;
  confirmationText?: string;
}) {
  const writePlanPath = clean(params.writePlanPath);
  const idempotencyKey = clean(params.idempotencyKey);
  const confirmationText = clean(params.confirmationText);
  if (!writePlanPath || !idempotencyKey) {
    return "plan_confirmation requires writePlanPath and idempotencyKey from the exact write plan.";
  }
  if (!confirmationText) {
    return "plan_confirmation requires confirmationText returned by pi_ask_user(flow=plan_confirmation).";
  }
  const required = [
    "Confirmation channel: pi_ask_user plan_confirmation",
    `Write plan: ${writePlanPath}`,
    `Idempotency key: ${idempotencyKey}`
  ];
  const missing = required.find(fragment => !confirmationText.includes(fragment));
  return missing
    ? "confirmationText must be returned by pi_ask_user(flow=plan_confirmation) for the same writePlanPath and idempotencyKey."
    : null;
}

export function linearWriteGuardDecision(
  params: {
    writePlanPath?: string;
    idempotencyKey?: string;
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
        "Blocked linear_apply_write_plan: real writes require one plan_confirmation approval from pi_ask_user before apply."
    };
  }

  const bindingError = planConfirmationBindingError(params);
  if (bindingError) return { action: "block" as const, message: `Blocked linear_apply_write_plan: ${bindingError}` };

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
