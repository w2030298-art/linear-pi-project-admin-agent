import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export async function runPiTask(task: { task: string; prompt: string; requiresFactPack: boolean }) {
  fs.mkdirSync("state/pi-queue", { recursive: true });
  const id = `${Date.now()}-${task.task}`;
  const promptPath = path.resolve(`state/pi-queue/${id}.md`);
  fs.writeFileSync(promptPath, `# Linear Bridge Task

Task: ${task.task}
Requires Fact Pack: ${task.requiresFactPack}

${task.prompt}
`);

  // Conservative default: queue prompt file. Enable automatic Pi execution by setting PI_AUTO_RUN=true.
  if (process.env.PI_AUTO_RUN !== "true") return { queued: true, promptPath };

  const pi = process.env.PI_COMMAND || "pi";
  const child = spawn(pi, ["--mode", process.env.PI_MODE || "rpc", "--session-dir", process.env.PI_SESSION_DIR || ".pi/sessions"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
  });
  child.stdin.write(JSON.stringify({ type: "user_message", content: task.prompt }) + "
");
  child.stdin.end();
  child.stdout.on("data", d => fs.appendFileSync(`state/pi-queue/${id}.out.log`, d));
  child.stderr.on("data", d => fs.appendFileSync(`state/pi-queue/${id}.err.log`, d));
  return { queued: true, promptPath, autoRun: true };
}
