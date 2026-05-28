import express from "express";
import dotenv from "dotenv";
import { verifyLinearSignature, verifyLinearTimestamp } from "./verify.js";
import { alreadySeen, appendEvent, markSeen } from "./store.js";
import { dispatchLinearEvent } from "./dispatch.js";

dotenv.config();

const app = express();
const port = Number(process.env.BRIDGE_PORT || 8787);
const secret = process.env.LINEAR_WEBHOOK_SECRET || "";

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "linear-pi-bridge" }));

app.post("/hooks/linear", express.raw({ type: "application/json" }), async (req, res) => {
  const raw = req.body as Buffer;
  const signature = req.header("linear-signature") || req.header("Linear-Signature") || undefined;
  if (!verifyLinearSignature(raw, signature, secret)) return res.sendStatus(401);

  let payload: any;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { return res.sendStatus(400); }
  if (!verifyLinearTimestamp(payload)) return res.sendStatus(401);

  const deliveryId = req.header("Linear-Delivery") || payload.webhookId || `${payload.type}:${payload.createdAt}:${payload.webhookTimestamp}`;
  if (alreadySeen(deliveryId)) return res.status(200).json({ ok: true, duplicate: true });
  markSeen(deliveryId);
  appendEvent({ deliveryId, payload });

  // Respond quickly to Linear. Dispatch is lightweight by default and queues a prompt file.
  try {
    const result = await dispatchLinearEvent(payload);
    return res.status(200).json({ ok: true, result });
  } catch (err: any) {
    appendEvent({ deliveryId, dispatchError: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(port, () => {
  console.log(`linear-pi-bridge listening on ${port}`);
});
