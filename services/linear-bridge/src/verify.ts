import crypto from "node:crypto";

export function verifyLinearSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const got = Buffer.from(signature, "hex");
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}

export function verifyLinearTimestamp(payload: any, maxSkewMs = 60_000): boolean {
  const ts = Number(payload?.webhookTimestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(Date.now() - ts) <= maxSkewMs;
}
