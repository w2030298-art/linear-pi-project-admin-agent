import fs from "node:fs";
import path from "node:path";

const eventLog = path.resolve("state/linear-events.jsonl");
const seenFile = path.resolve("state/seen-linear-deliveries.json");

function ensure() { fs.mkdirSync(path.dirname(eventLog), { recursive: true }); }

export function alreadySeen(deliveryId: string): boolean {
  ensure();
  let seen: Record<string, boolean> = {};
  try { seen = JSON.parse(fs.readFileSync(seenFile, "utf8")); } catch {}
  return Boolean(seen[deliveryId]);
}

export function markSeen(deliveryId: string) {
  ensure();
  let seen: Record<string, boolean> = {};
  try { seen = JSON.parse(fs.readFileSync(seenFile, "utf8")); } catch {}
  seen[deliveryId] = true;
  fs.writeFileSync(seenFile, JSON.stringify(seen, null, 2));
}

export function appendEvent(event: unknown) {
  ensure();
  fs.appendFileSync(eventLog, JSON.stringify({ ts: new Date().toISOString(), event }) + "\n");
}
