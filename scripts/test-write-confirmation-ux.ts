import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareWriteConfirmation } from '../.pi/extensions/linear-admin-tools.ts';
import { linearWriteGuardDecision } from '../.pi/extensions/linear-write-guard.ts';
import { runWriteConfirmationFlow } from '../.pi/extensions/pi-ask-user.ts';
import {
  consumeWriteConfirmationArtifact,
  registerWriteConfirmationArtifact,
  resetWriteConfirmationArtifactsForTests
} from '../.pi/extensions/write-confirmation-artifact.ts';

resetWriteConfirmationArtifactsForTests();

{
  let confirmCalls = 0;
  const approved = await runWriteConfirmationFlow(
    {
      hasUI: true,
      ui: {
        async input() { return undefined; },
        async confirm(title: string, message: string) {
          confirmCalls += 1;
          assert.match(title, /Approve Linear write plan/i);
          assert.match(message, /state\/write-plans\/test\.json/);
          assert.match(message, /plan-key-1/);
          assert.match(message, /Target project: Demo Project/i);
          return true;
        }
      }
    },
    {
      writePlanPath: 'state/write-plans/test.json',
      idempotencyKey: 'plan-key-1',
      targetProjectSummary: 'Demo Project (proj-1)',
      operationsSummary: '1 issue.create',
      risksSummary: 'No deletions',
      nonChangesSummary: 'Repo map unchanged'
    }
  );
  assert.equal(confirmCalls, 1);
  assert.equal(approved.ok, true);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approved, true);
  assert.equal(approved.confirmationChannel, 'ask_user');
  assert.match(approved.confirmationText, /ask_user approved/i);
  assert.doesNotMatch(approved.confirmationText, /Fallback reason|conversation fallback/i);

  const prepared = await prepareWriteConfirmation(
    {},
    {
      dryRun: false,
      writePlanPath: 'state/write-plans/test.json',
      idempotencyKey: 'plan-key-1',
      confirmedByUser: true,
      confirmationChannel: 'ask_user',
      confirmationText: approved.confirmationText,
      confirmationId: approved.confirmationId
    },
    { hasUI: true, ui: { async confirm() { return true; } } }
  );
  assert.equal(prepared.confirmedByUser, true);
  assert.equal(prepared.confirmationChannel, 'ask_user');
  assert.match(prepared.confirmationText, /ask_user approved/i);
}

{
  resetWriteConfirmationArtifactsForTests();
  const cancelled = await runWriteConfirmationFlow(
    {
      hasUI: true,
      ui: {
        async input() { return undefined; },
        async confirm() { return false; }
      }
    },
    {
      writePlanPath: 'state/write-plans/cancel.json',
      idempotencyKey: 'cancel-key'
    }
  );
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.approved, false);

  await assert.rejects(
    () => prepareWriteConfirmation(
      {},
      {
        dryRun: false,
        writePlanPath: 'state/write-plans/cancel.json',
        idempotencyKey: 'cancel-key',
        confirmedByUser: true,
        confirmationChannel: 'ask_user',
        confirmationText: 'stale approval'
      },
      { hasUI: true, ui: { async confirm() { return true; } } }
    ),
    /No active pi_ask_user write_confirmation approval/i
  );
}

{
  const unavailable = await runWriteConfirmationFlow(
    { hasUI: false, ui: { async input() { return undefined; } } },
    {
      writePlanPath: 'state/write-plans/no-ui.json',
      idempotencyKey: 'no-ui-key'
    }
  );
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.status, 'interactive_confirmation_unavailable');
  assert.match(unavailable.evidenceGaps?.[0] || '', /Pi UI is not available/i);
}

{
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/stale.json',
    idempotencyKey: 'stale-key',
    confirmationText: 'approved once'
  });
  consumeWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/stale.json',
    idempotencyKey: 'stale-key',
    confirmationText: 'approved once'
  });

  await assert.rejects(
    () => prepareWriteConfirmation(
      {},
      {
        dryRun: false,
        writePlanPath: 'state/write-plans/stale.json',
        idempotencyKey: 'stale-key',
        confirmedByUser: true,
        confirmationChannel: 'ask_user',
        confirmationText: 'approved once'
      },
      { hasUI: false }
    ),
    /No active pi_ask_user write_confirmation approval/i
  );
}

{
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/mismatch.json',
    idempotencyKey: 'mismatch-key',
    planDigest: 'digest-a',
    confirmationText: 'approved digest-a'
  });

  const mismatch = consumeWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/mismatch.json',
    idempotencyKey: 'mismatch-key',
    planDigest: 'digest-b',
    confirmationText: 'approved digest-a'
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'plan_digest_mismatch');
}

{
  resetWriteConfirmationArtifactsForTests();
  const ctx = {
    hasUI: true,
    ui: {
      async input() { return undefined; },
      async confirm() { return true; }
    }
  };
  await runWriteConfirmationFlow(ctx, {
    writePlanPath: 'state/write-plans/dup.json',
    idempotencyKey: 'dup-key'
  });
  const duplicate = await runWriteConfirmationFlow(ctx, {
    writePlanPath: 'state/write-plans/dup.json',
    idempotencyKey: 'dup-key'
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.status, 'duplicate_confirmation');
}

{
  await assert.rejects(
    () => prepareWriteConfirmation(
      {},
      {
        dryRun: false,
        writePlanPath: 'state/write-plans/test.json',
        confirmedByUser: true,
        confirmationText: 'user typed confirm',
        confirmationChannel: 'conversation_fallback'
      },
      { hasUI: false }
    ),
    /interactive confirmation unavailable; real write not applied/i
  );
}

{
  resetWriteConfirmationArtifactsForTests();
  const prepared = await prepareWriteConfirmation(
    {},
    {
      dryRun: false,
      writePlanPath: 'state/write-plans/test.json',
      confirmedByUser: true,
      confirmationText: 'user explicitly allowed text fallback and approved.',
      confirmationChannel: 'conversation_fallback',
      allowConversationFallback: true
    },
    { hasUI: false }
  );
  assert.equal(prepared.confirmationChannel, 'conversation_fallback');
  assert.equal(prepared.confirmationText, 'user explicitly allowed text fallback and approved.');
}

{
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/guard.json',
    idempotencyKey: 'guard-key',
    confirmationText: 'ask_user approved the exact dry-run write plan.'
  });

  const decision = linearWriteGuardDecision(
    {
      confirmedByUser: true,
      dryRun: false,
      confirmationText: 'ask_user approved the exact dry-run plan',
      confirmationChannel: 'ask_user',
      idempotencyKey: 'guard-key'
    },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.deepEqual(decision, { action: 'allow' });
}

{
  const decision = linearWriteGuardDecision(
    {
      confirmedByUser: true,
      dryRun: false,
      confirmationText: 'Fallback reason: Generic ask_user is unavailable. User approval: user approved. Write plan: plan.json. Idempotency key: key.',
      confirmationChannel: 'conversation_fallback',
      allowConversationFallback: true
    },
    { ALLOW_LINEAR_WRITES: 'false' }
  );
  assert.deepEqual(decision, { action: 'allow' });
}

{
  const decision = linearWriteGuardDecision(
    { confirmedByUser: false, dryRun: false },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.equal(decision.action, 'block');
  assert.match(decision.message, /pi_ask_user\(flow=write_confirmation\)/i);
}

{
  const decision = linearWriteGuardDecision(
    { confirmedByUser: false, dryRun: false, confirmationChannel: 'ask_user' },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.equal(decision.action, 'block');
  assert.match(decision.message, /pi_ask_user\(flow=write_confirmation\)/i);
}

{
  const decision = linearWriteGuardDecision(
    {
      confirmedByUser: true,
      dryRun: false,
      confirmationText: 'user typed confirm',
      confirmationChannel: 'conversation_fallback'
    },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.equal(decision.action, 'block');
  assert.match(decision.message, /interactive confirmation unavailable; real write not applied/i);
}

{
  const decision = linearWriteGuardDecision(
    {
      confirmedByUser: true,
      dryRun: false,
      confirmationText: 'user typed confirm',
      confirmationChannel: 'conversation_fallback',
      allowConversationFallback: true
    },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.deepEqual(decision, { action: 'allow' });
}

{
  const decision = linearWriteGuardDecision(
    {
      confirmedByUser: true,
      dryRun: false,
      confirmationText: '',
      confirmationChannel: 'conversation_fallback',
      allowConversationFallback: true
    },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.equal(decision.action, 'block');
  assert.match(decision.message, /explicit approval/i);
}

{
  const decision = linearWriteGuardDecision(
    { confirmedByUser: false, dryRun: true },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.deepEqual(decision, { action: 'allow' });
}

const adminTools = fs.readFileSync('.pi/extensions/linear-admin-tools.ts', 'utf8');
const askUserTool = fs.readFileSync('.pi/extensions/pi-ask-user.ts', 'utf8');
assert.match(adminTools, /pi_ask_user with flow=write_confirmation/i);
assert.match(adminTools, /current conversation text fallback/i);
assert.match(adminTools, /interactive confirmation unavailable; real write not applied/i);
assert.doesNotMatch(adminTools, /type .*确认执行/i);
assert.match(askUserTool, /flow === "write_confirmation"/);

console.log('write confirmation UX tests passed');
