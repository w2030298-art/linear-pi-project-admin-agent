import { runPiTask } from "./pi-runner.js";

function labelNamesFromPayload(payload: any): string[] {
  const data = payload?.data || {};
  const labels = data?.labels?.nodes?.map((l: any) => l.name) || data?.labels || [];
  return Array.isArray(labels) ? labels.map((l: any) => typeof l === "string" ? l : l?.name).filter(Boolean) : [];
}

export function classifyLinearEvent(payload: any): { task: string; prompt: string; requiresFactPack: boolean } | null {
  const type = payload?.type;
  const action = payload?.action;
  const labelNames = labelNamesFromPayload(payload);

  if (type === "AgentSessionEvent") {
    return { task: "agent_session", requiresFactPack: true, prompt: `Handle Linear AgentSessionEvent: ${JSON.stringify(payload).slice(0, 5000)}` };
  }

  const trigger = labelNames.find((l: string) => l.startsWith("Agent:"));
  if (trigger) {
    const map: Record<string, string> = {
      "Agent:PlanProject": "create_project",
      "Agent:ExtendProject": "extend_project",
      "Agent:PortfolioReview": "portfolio_review",
      "Agent:ReportDraft": "project_report",
      "Agent:Dispatch": "issue_dispatch",
      "Agent:HygieneCheck": "hygiene_check",
      "Agent:SyncWorkspace": "workspace_sync"
    };
    const task = map[trigger];
    if (!task) return null;
    return { task, requiresFactPack: true, prompt: `Linear ${trigger} label detected on ${type}/${action}: ${JSON.stringify(payload).slice(0, 5000)}` };
  }

  return null;
}

export async function dispatchLinearEvent(payload: any) {
  const classified = classifyLinearEvent(payload);
  if (!classified) {
    const trigger = labelNamesFromPayload(payload).find((label: string) => label.startsWith("Agent:"));
    return { queued: false, reason: trigger ? "Unsupported Agent trigger" : "No Agent trigger" };
  }
  await runPiTask(classified);
  return { queued: true, task: classified.task };
}
