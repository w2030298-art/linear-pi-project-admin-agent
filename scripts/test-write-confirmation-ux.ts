import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareWriteConfirmation } from '../.pi/extensions/linear-admin-tools.ts';
import { linearWriteGuardDecision } from '../.pi/extensions/linear-write-guard.ts';
import { runWriteConfirmationFlow } from '../.pi/extensions/pi-ask-user.ts';
import {
  consumeWriteConfirmationArtifact,
  registerWriteConfirmationArtifact,
  resetWriteConfirmationArtifactsForTests,
  WRITE_CONFIRMATION_UI_TITLE
} from '../.pi/extensions/write-confirmation-artifact.ts';

resetWriteConfirmationArtifactsForTests();

{
  const dryRunPrepared = await prepareWriteConfirmation({}, {
    dryRun: true,
    writePlanPath: 'state/write-plans/test.json',
    confirmedByUser: false,
    confirmationText: ''
  });
  assert.equal(dryRunPrepared.dryRun, true);
  assert.equal(dryRunPrepared.confirmedByUser, false);
}

{
  let confirmCalls = 0;
  const approved = await runWriteConfirmationFlow(
    {
      hasUI: true,
      ui: {
        async input() { return undefined; },
        async confirm(title: string, message: string) {
          confirmCalls += 1;
          assert.equal(title, WRITE_CONFIRMATION_UI_TITLE);
          assert.match(message, /Approve & Write/i);
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
      nonChangesSummary: 'Repo map unchanged',
      planDigest: 'sha256:abc'
    }
  );
  assert.equal(confirmCalls, 1);
  assert.equal(approved.ok, true);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approved, true);
  assert.equal(approved.approvalArtifact?.confirmationChannel, 'ask_user');
  assert.equal(approved.approvalArtifact?.planDigest, 'sha256:abc');
  assert.match(approved.confirmationText, /User approved exact dry-run write plan via Pi UI/i);
  assert.ok(approved.approvalArtifact?.createdAt);
  assert.ok(approved.approvalArtifact?.expiresAt);

  let applyConfirmCalls = 0;
  const prepared = await prepareWriteConfirmation(
    {},
    {
      dryRun: false,
      writePlanPath: 'state/write-plans/test.json',
      idempotencyKey: 'plan-key-1',
      planDigest: 'sha256:abc',
      confirmedByUser: true,
      confirmationChannel: 'ask_user',
      confirmationText: approved.confirmationText,
      confirmationId: approved.confirmationId
    }
  );
  assert.equal(applyConfirmCalls, 0);
  assert.equal(prepared.confirmedByUser, true);
  assert.equal(prepared.confirmationChannel, 'ask_user');
  assert.match(prepared.confirmationText, /User approved exact dry-run write plan via Pi UI/i);
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
      }
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
      }
    ),
    /already consumed/i
  );
}

{
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/expired.json',
    idempotencyKey: 'expired-key',
    confirmationText: 'approved but expired',
    ttlMs: -1000
  });

  await assert.rejects(
    () => prepareWriteConfirmation(
      {},
      {
        dryRun: false,
        writePlanPath: 'state/write-plans/expired.json',
        idempotencyKey: 'expired-key',
        confirmedByUser: true,
        confirmationChannel: 'ask_user',
        confirmationText: 'approved but expired'
      }
    ),
    /expired/i
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
      }
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
    }
  );
  assert.equal(prepared.confirmationChannel, 'conversation_fallback');
  assert.equal(prepared.confirmationText, 'user explicitly allowed text fallback and approved.');
}

{
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/guard.json',
    idempotencyKey: 'guard-key',
    confirmationText: 'User approved exact dry-run write plan via Pi UI.'
  });

  const decision = linearWriteGuardDecision(
    {
      writePlanPath: 'state/write-plans/guard.json',
      confirmedByUser: true,
      dryRun: false,
      confirmationText: 'User approved exact dry-run write plan via Pi UI.',
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
  assert.match(decision.message, /Approve & Write/i);
}

{
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/guard-expired.json',
    idempotencyKey: 'guard-expired-key',
    confirmationText: 'expired approval',
    ttlMs: -1000
  });

  const decision = linearWriteGuardDecision(
    {
      writePlanPath: 'state/write-plans/guard-expired.json',
      confirmedByUser: true,
      dryRun: false,
      confirmationChannel: 'ask_user',
      idempotencyKey: 'guard-expired-key',
      confirmationText: 'expired approval'
    },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.equal(decision.action, 'block');
  assert.match(decision.message, /expired/i);
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
const guardSource = fs.readFileSync('.pi/extensions/linear-write-guard.ts', 'utf8');
assert.match(adminTools, /dry-run automatically/i);
assert.match(adminTools, /never pops its own confirmation UI/i);
assert.match(adminTools, /Approve & Write/i);
assert.doesNotMatch(adminTools, /genericAskUser|ctx\.ui\.confirm/i);
assert.match(askUserTool, /WRITE_CONFIRMATION_UI_TITLE/);
assert.match(guardSource, /validateWriteConfirmationArtifact/);
assert.doesNotMatch(guardSource, /confirm\(/i);

console.log('write confirmation UX tests passed');
