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
    hostCapabilities: { askUserAvailable: true, piAskUserAvailable: true },
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
    hostCapabilities: { askUserAvailable: true, piAskUserAvailable: true },
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
    confirmationText: 'user explicitly allowed text fallback and approved.',
    hostCapabilities: {
      askUserAvailable: false,
      piAskUserAvailable: true,
      conversationFallbackAllowed: true
    },
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
  assert.match(decision.effectivePlan.confirmationText, /user explicitly allowed text fallback and approved/);
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
  assert.match(askUserChannel.userPrompt, /Click Approve/i);

  const fallbackChannel = resolveConfirmationChannel({
    hostCapabilities: {
      askUserAvailable: false,
      piAskUserAvailable: true,
      conversationFallbackAllowed: true
    }
  });
  assert.equal(fallbackChannel.channel, 'conversation_fallback');
  assert.equal(fallbackChannel.label, 'current conversation explicit approval fallback');
  assert.match(fallbackChannel.fallbackReason, /pi_ask_user is project-selection\/repo-map only/i);

  const unavailableChannel = resolveConfirmationChannel({
    hostCapabilities: {
      askUserAvailable: false,
      piAskUserAvailable: false,
      conversationFallbackAllowed: false
    }
  });
  assert.equal(unavailableChannel.channel, 'unavailable');
  assert.equal(unavailableChannel.label, 'interactive confirmation unavailable; real write not applied');
  assert.equal(unavailableChannel.canApplyAfterExplicitApproval, false);
}

{
  const unavailableChannel = resolveConfirmationChannel({
    hostCapabilities: { askUserAvailable: false, piAskUserAvailable: true }
  });
  assert.equal(unavailableChannel.channel, 'unavailable');
  assert.equal(unavailableChannel.canApplyAfterExplicitApproval, false);
  assert.match(unavailableChannel.fallbackReason, /interactive confirmation unavailable; real write not applied/i);
}

{
  const record = buildConfirmationRecord({
    channel: resolveConfirmationChannel({
      hostCapabilities: {
        askUserAvailable: false,
        piAskUserAvailable: true,
        conversationFallbackAllowed: true
      }
    }),
    confirmationText: 'user approved via explicitly allowed fallback',
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
  const record = buildConfirmationRecord({
    channel: resolveConfirmationChannel({
      hostCapabilities: { askUserAvailable: true, piAskUserAvailable: true }
    }),
    confirmationText: 'Fallback reason: stale current conversation fallback',
    writePlanPath: 'plan.json',
    idempotencyKey: 'plan-key'
  });
  assert.equal(record.confirmationChannel, 'ask_user');
  assert.doesNotMatch(record.confirmationText, /Fallback reason|conversation fallback/i);
  assert.match(record.confirmationText, /ask_user approved the exact dry-run write plan/i);
}

{
  const plan = {
    idempotencyKey: 'test-plan-key',
    dryRun: true,
    confirmedByUser: false
  };
  const decision = resolveApplyMode({
    mode: 'confirmed-only',
    cliDryRun: false,
    cliConfirmed: true,
    allow: true,
    writePlanPath: 'state/write-plans/test-plan.json',
    confirmationText: 'user typed confirm',
    hostCapabilities: { askUserAvailable: false, piAskUserAvailable: true },
    plan
  });
  assert.equal(decision.dryRun, true);
  assert.equal(decision.reason.confirmationChannel.channel, 'unavailable');
  assert.deepEqual(plan, {
    idempotencyKey: 'test-plan-key',
    dryRun: true,
    confirmedByUser: false
  });
}

{
  const decision = resolveApplyMode({
    mode: 'confirmed-only',
    cliDryRun: true,
    cliConfirmed: true,
    allow: true,
    hostCapabilities: { askUserAvailable: true, piAskUserAvailable: true },
    plan: { dryRun: false, confirmedByUser: true }
  });
  assert.equal(decision.dryRun, true);
  assert.equal(decision.reason.cliDryRun, true);
}

console.log('linear apply mode tests passed');
