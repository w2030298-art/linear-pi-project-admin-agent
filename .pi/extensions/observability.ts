import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

export default function (pi: ExtensionAPI) {
  const auditPath = process.env.AUDIT_LOG_PATH || "state/audit.jsonl";
  function log(event: unknown) {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.appendFileSync(auditPath, JSON.stringify({ ts: new Date().toISOString(), event }) + "
");
  }

  pi.on("session_start", (event: any) => log({ type: "session_start", event }));
  pi.on("tool_execution_start", (event: any) => log({ type: "tool_execution_start", toolName: event?.toolName || event?.name }));
  pi.on("tool_execution_end", (event: any) => log({ type: "tool_execution_end", toolName: event?.toolName || event?.name }));
}
