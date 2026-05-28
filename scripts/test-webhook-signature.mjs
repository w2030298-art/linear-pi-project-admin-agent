#!/usr/bin/env node
import crypto from 'node:crypto';
import { json } from './utils.mjs';

const secret = process.env.LINEAR_WEBHOOK_SECRET || 'test-secret';
const body = JSON.stringify({ type: 'Issue', action: 'create', webhookTimestamp: Date.now(), data: { id: 'x' } });
const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
json({ body, signature: sig, header: 'Linear-Signature' });
