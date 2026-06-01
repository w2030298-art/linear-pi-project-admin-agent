import fs from "node:fs";
import path from "node:path";

const eventLog = path.resolve("state/linear-events.jsonl");
const legacySeenFile = path.resolve("state/seen-linear-deliveries.json");
const seenFile = path.resolve("state/seen-linear-deliveries.jsonl");
const lockTimeoutMs = 5_000;
const staleLockMs = 30_000;
let seenDeliveries: Set<string> | undefined;

function ensure() { fs.mkdirSync(path.dirname(eventLog), { recursive: true }); }

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withFileLock<T>(targetFile: string, run: () => T): T {
  const lockDir = `${targetFile}.lock`;
  const startedAt = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const ageMs = Date.now() - fs.statSync(lockDir).mtimeMs;
        if (ageMs > staleLockMs) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {}
      if (Date.now() - startedAt > lockTimeoutMs) {
        throw new Error(`Timed out waiting for lock: ${lockDir}`);
      }
      sleepSync(20);
    }
  }

  try {
    return run();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function loadSeenDeliveries() {
  const seen = new Set<string>();

  try {
    const legacy = JSON.parse(fs.readFileSync(legacySeenFile, "utf8"));
    if (legacy && typeof legacy === "object") {
      for (const [deliveryId, marked] of Object.entries(legacy)) {
        if (marked) seen.add(deliveryId);
      }
    }
  } catch {}

  try {
    for (const line of fs.readFileSync(seenFile, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (typeof entry?.deliveryId === "string" && entry.deliveryId.trim()) {
          seen.add(entry.deliveryId);
        }
      } catch {}
    }
  } catch {}

  seenDeliveries = seen;
  return seen;
}

export function alreadySeen(deliveryId: string): boolean {
  ensure();
  return loadSeenDeliveries().has(deliveryId);
}

export function markSeen(deliveryId: string): boolean {
  ensure();
  return withFileLock(seenFile, () => {
    const seen = loadSeenDeliveries();
    if (seen.has(deliveryId)) return false;
    fs.appendFileSync(seenFile, JSON.stringify({ deliveryId, seenAt: new Date().toISOString() }) + "\n", "utf8");
    seen.add(deliveryId);
    seenDeliveries = seen;
    return true;
  });
}

export function appendEvent(event: unknown) {
  ensure();
  fs.appendFileSync(eventLog, JSON.stringify({ ts: new Date().toISOString(), event }) + "\n");
}
