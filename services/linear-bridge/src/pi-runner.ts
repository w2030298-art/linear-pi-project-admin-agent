import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function cleanTaskName(task: string) {
  return task.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
}

function metadataLabel(key: string) {
  const labels: Record<string, string> = {
    webhookDeliveryId: "Webhook Delivery",
    webhookType: "Webhook Type",
    webhookAction: "Webhook Action",
    triggerLabel: "Trigger Label",
    issueIdentifier: "Issue Identifier",
    issueId: "Issue Id",
    projectId: "Project Id"
  };
  return labels[key] || key;
}

export async function runPiTask(task: { task: string; prompt: string; requiresFactPack: boolean; metadata?: Record<string, unknown> }) {
  fs.mkdirSync("state/pi-queue", { recursive: true });
  const id = `${Date.now()}-${crypto.randomUUID()}-${cleanTaskName(task.task)}`;
  const promptPath = path.resolve(`state/pi-queue/${id}.md`);
  const metadataLines = task.metadata ? Object.entries(task.metadata)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${metadataLabel(key)}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join("\n") : "";
  fs.writeFileSync(promptPath, `# Linear Bridge Task

Task: ${task.task}
Requires Fact Pack: ${task.requiresFactPack}
${metadataLines ? `${metadataLines}\n` : ""}

${task.prompt}
`, { flag: "wx" });

  // Conservative default: queue prompt file. Enable automatic Pi execution by setting PI_AUTO_RUN=true.
  if (process.env.PI_AUTO_RUN !== "true") return { queued: true, promptPath };

  const pi = process.env.PI_COMMAND || "pi";
  const child = spawn(pi, ["--mode", process.env.PI_MODE || "rpc", "--session-dir", process.env.PI_SESSION_DIR || ".pi/sessions"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
  });
  child.stdin.write(JSON.stringify({ type: "prompt", message: task.prompt }) + "\n");
  child.stdin.end();
  child.stdout.on("data", d => fs.appendFileSync(path.resolve(`state/pi-queue/${id}.out.log`), d));
  child.stderr.on("data", d => fs.appendFileSync(path.resolve(`state/pi-queue/${id}.err.log`), d));
  return { queued: true, promptPath, autoRun: true };
}
