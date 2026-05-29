#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildConfirmationRecord,
  resolveApplyMode,
  resolveConfirmationChannel
} from './write-plan-execution.mjs';

{
  const decision = resolveApplyMode({
    mode: 'dry-run',
    cliDryRun: false,
    cliConfirmed: true,
    allow: true,
    plan: { dryRun: true, confirmedByUser: false }
  });
  assert.equal(decision.dryRun, true);
  assert.equal(decision.reason.modeDryRun, true);
}

{
  const decision = resolveApplyMode({
    mode: 'confirmed-only',
    cliDryRun: false,
    cliConfirmed: true,
    allow: true,
    plan: { dryRun: true, confirmedByUser: false }
  });
  assert.equal(decision.dryRun, false);
  assert.equal(decision.effectivePlan.dryRun, false);
  assert.equal(decision.effectivePlan.confirmedByUser, true);
  assert.equal(decision.reason.cliConfirmedOverride, true);
}

{
  const decision = resolveApplyMode({
    mode: 'confirmed-only',
    cliDryRun: false,
    cliConfirmed: true,
    allow: true,
    writePlanPath: 'state/write-plans/test-plan.json',
    confirmationText: '用户回复：确认执行 dry-run 中展示的写入计划。',
    hostCapabilities: { askUserAvailable: false, piAskUserAvailable: true },
    plan: {
      idempotencyKey: 'test-plan-key',
      dryRun: true,
      confirmedByUser: false
    }
  });
  assert.equal(decision.dryRun, false);
  assert.equal(decision.reason.confirmationChannel.channel, 'conversation_fallback');
  assert.equal(decision.effectivePlan.confirmationChannel, 'conversation_fallback');
  assert.match(decision.effectivePlan.confirmationText, /Generic ask_user is unavailable/i);
  assert.match(decision.effectivePlan.confirmationText, /用户回复：确认执行/);
  assert.match(decision.effectivePlan.confirmationText, /state\/write-plans\/test-plan\.json/);
  assert.match(decision.effectivePlan.confirmationText, /test-plan-key/);
}

{
  const askUserChannel = resolveConfirmationChannel({
    hostCapabilities: { askUserAvailable: true, piAskUserAvailable: true }
  });
  assert.equal(askUserChannel.channel, 'ask_user');
  assert.equal(askUserChannel.label, 'ask_user approve/cancel');
  assert.equal(askUserChannel.canApplyAfterExplicitApproval, true);

  const fallbackChannel = resolveConfirmationChannel({
    hostCapabilities: { askUserAvailable: false, piAskUserAvailable: true }
  });
  assert.equal(fallbackChannel.channel, 'conversation_fallback');
  assert.equal(fallbackChannel.label, 'current conversation explicit approval fallback');
  assert.match(fallbackChannel.fallbackReason, /pi_ask_user is repo-map only/i);

  const unavailableChannel = resolveConfirmationChannel({
    hostCapabilities: {
      askUserAvailable: false,
      piAskUserAvailable: false,
      conversationFallbackAllowed: false
    }
  });
  assert.equal(unavailableChannel.channel, 'unavailable');
  assert.equal(unavailableChannel.label, 'not writable until ask_user or explicit conversation approval is available');
  assert.equal(unavailableChannel.canApplyAfterExplicitApproval, false);
}

{
  const record = buildConfirmationRecord({
    channel: resolveConfirmationChannel({
      hostCapabilities: { askUserAvailable: false, piAskUserAvailable: true }
    }),
    confirmationText: '用户原文：确认',
    writePlanPath: 'plan.json',
    idempotencyKey: 'plan-key'
  });
  assert.equal(record.confirmationChannel, 'conversation_fallback');
  assert.match(record.confirmationText, /Fallback reason:/);
  assert.match(record.confirmationText, /User approval:/);
  assert.match(record.confirmationText, /Write plan: plan\.json/);
  assert.match(record.confirmationText, /Idempotency key: plan-key/);
}

{
  const decision = resolveApplyMode({
    mode: 'confirmed-only',
    cliDryRun: true,
    cliConfirmed: true,
    allow: true,
    plan: { dryRun: false, confirmedByUser: true }
  });
  assert.equal(decision.dryRun, true);
  assert.equal(decision.reason.cliDryRun, true);
}

console.log('linear apply mode tests passed');
