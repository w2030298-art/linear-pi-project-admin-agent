#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildConfirmationRecord,
  resolveApplyMode,
  resolveConfirmationChannel
} from './write-plan-execution.mjs';

{
  const decision = resolveApplyMode({
    mode: 'confirmed-only',
    cliDryRun: true,
    cliConfirmed: false,
    allow: true,
    hostCapabilities: { askUserAvailable: false, piAskUserAvailable: true },
    plan: { dryRun: true, confirmedByUser: false }
  });
  assert.equal(decision.dryRun, true);
  assert.equal(decision.reason.confirmationChannel.channel, 'unavailable');
  assert.equal(decision.confirmationSelfCheck.canApproveAfterValidation, false);
  assert.match(decision.confirmationSelfCheck.nextAction, /linear_validate_and_apply_write_plan/i);
}

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
  const askUserChannel = resolveConfirmationChannel({
    hostCapabilities: { askUserAvailable: true, piAskUserAvailable: true }
  });
  assert.equal(askUserChannel.channel, 'ask_user');
  assert.equal(askUserChannel.label, 'ask_user approve/cancel');
  assert.equal(askUserChannel.canApplyAfterExplicitApproval, true);
  assert.match(askUserChannel.userPrompt, /Click Approve/i);

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
  assert.match(unavailableChannel.fallbackReason, /interactive confirmation unavailable/i);
  assert.match(unavailableChannel.fallbackReason, /fallback is not explicitly allowed/i);
}

{
  const record = buildConfirmationRecord({
    channel: resolveConfirmationChannel({
      hostCapabilities: { askUserAvailable: true, piAskUserAvailable: true }
    }),
    confirmationText: 'Fallback reason: stale current conversation fallback',
    confirmationId: 'ask-user-confirmation-1',
    writePlanPath: 'plan.json',
    idempotencyKey: 'plan-key'
  });
  assert.equal(record.confirmationChannel, 'ask_user');
  assert.equal(record.confirmationId, 'ask-user-confirmation-1');
  assert.doesNotMatch(record.confirmationText, /Fallback reason|conversation fallback/i);
  assert.match(record.confirmationText, /ask_user approved the exact final-validated write plan/i);
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
