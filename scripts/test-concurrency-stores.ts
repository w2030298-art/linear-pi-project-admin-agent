import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const storeUrl = pathToFileURL(path.join(root, "services", "linear-bridge", "src", "store.ts")).href;
const piRunnerUrl = pathToFileURL(path.join(root, "services", "linear-bridge", "src", "pi-runner.ts")).href;
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linear-pi-concurrency-"));

function runNode(code: string, env: Record<string, string | undefined> = {}, runtimeCwd = testRoot) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "-e", `process.chdir(${JSON.stringify(runtimeCwd)});\n${code}`], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}

async function runMany(count: number, code: string, env: Record<string, string | undefined> = {}, cwd = testRoot) {
  return Promise.all(Array.from({ length: count }, () => runNode(code, env, cwd)));
}

{
  const deliveryId = `delivery-${process.pid}-${Date.now()}`;
  const results = await runMany(8, [
    `import { markSeen } from ${JSON.stringify(storeUrl)};`,
    `console.log(markSeen(${JSON.stringify(deliveryId)}) ? 'claimed' : 'duplicate');`
  ].join("\n"));
  assert.equal(results.filter(result => result.status === 0 && result.stdout.includes("claimed")).length, 1);
  assert.equal(results.filter(result => result.status === 0 && result.stdout.includes("duplicate")).length, 7);

  const recovered = await runNode([
    `import { alreadySeen } from ${JSON.stringify(storeUrl)};`,
    `console.log(alreadySeen(${JSON.stringify(deliveryId)}) ? 'seen' : 'missing');`
  ].join("\n"));
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout, /seen/);
}

{
  const deliveryId = `dispatch-${process.pid}-${Date.now()}`;
  const dispatchRoot = fs.mkdtempSync(path.join(testRoot, "dispatch-"));
  const results = await runMany(8, [
    `import { markSeen } from ${JSON.stringify(storeUrl)};`,
    `import { runPiTask } from ${JSON.stringify(piRunnerUrl)};`,
    `if (markSeen(${JSON.stringify(deliveryId)})) {`,
    "  const result = await runPiTask({ task: 'agent_session', prompt: 'same delivery', requiresFactPack: true });",
    "  console.log(result.promptPath);",
    "} else {",
    "  console.log('duplicate');",
    "}"
  ].join("\n"), {}, dispatchRoot);
  assert.equal(results.filter(result => result.status === 0 && result.stdout.includes("state")).length, 1);
  const queueFiles = fs.readdirSync(path.join(dispatchRoot, "state", "pi-queue")).filter(file => file.endsWith(".md"));
  assert.equal(queueFiles.length, 1);
}

{
  const queueRoot = fs.mkdtempSync(path.join(testRoot, "queue-"));
  const originalCwd = process.cwd();
  process.chdir(queueRoot);
  const { runPiTask } = await import(piRunnerUrl);
  const originalNow = Date.now;
  Date.now = () => 1_717_171_717_171;
  try {
    const results = await Promise.all(Array.from({ length: 20 }, () => runPiTask({
      task: "agent_session",
      prompt: "same millisecond",
      requiresFactPack: true
    })));
    const promptPaths = results.map(result => result.promptPath);
    assert.equal(new Set(promptPaths).size, 20);
    for (const promptPath of promptPaths) assert.equal(fs.existsSync(promptPath), true);
  } finally {
    Date.now = originalNow;
    process.chdir(originalCwd);
  }
}

fs.rmSync(testRoot, { recursive: true, force: true });
console.log("concurrency store tests passed");
