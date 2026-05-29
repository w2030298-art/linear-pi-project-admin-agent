#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { json } from './utils.mjs';

const secret = process.env.LINEAR_WEBHOOK_SECRET || 'test-secret';
const body = JSON.stringify({ type: 'Issue', action: 'create', webhookTimestamp: Date.now(), data: { id: 'x' } });
const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');

function verify(rawBody, signature, key) {
  if (!signature || !key) return false;
  const expected = crypto.createHmac('sha256', key).update(rawBody).digest();
  const got = Buffer.from(signature, 'hex');
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}

function verifyTimestamp(payload, maxSkewMs = 60_000) {
  const ts = Number(payload?.webhookTimestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(Date.now() - ts) <= maxSkewMs;
}

const trueSignatureAccepted = verify(body, sig, secret);
const fakeSignatureRejected = !verify(body, '0'.repeat(sig.length), secret);
const timestampAccepted = verifyTimestamp(JSON.parse(body));
const staleTimestampRejected = !verifyTimestamp({ webhookTimestamp: Date.now() - 120_000 });

assert.equal(trueSignatureAccepted, true);
assert.equal(fakeSignatureRejected, true);
assert.equal(timestampAccepted, true);
assert.equal(staleTimestampRejected, true);

json({
  ok: true,
  header: 'Linear-Signature',
  trueSignatureAccepted,
  fakeSignatureRejected,
  timestampAccepted,
  staleTimestampRejected
});
