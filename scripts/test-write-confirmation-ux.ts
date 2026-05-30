import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareWriteConfirmation } from '../.pi/extensions/linear-admin-tools.ts';
import { linearWriteGuardDecision } from '../.pi/extensions/linear-write-guard.ts';

{
  let confirmCalls = 0;
  const prepared = await prepareWriteConfirmation(
    {},
    {
      dryRun: false,
      writePlanPath: 'state/write-plans/test.json',
      confirmedByUser: false,
      confirmationText: 'Fallback reason: stale conversation fallback text must not survive ask_user approval.'
    },
    {
      hasUI: true,
      ui: {
        async confirm(title: string, message: string) {
          confirmCalls += 1;
          assert.match(title, /Approve Linear write plan/i);
          assert.match(message, /state\/write-plans\/test\.json/);
          return true;
        }
      }
    }
  );
  assert.equal(confirmCalls, 1);
  assert.equal(prepared.confirmedByUser, true);
  assert.equal(prepared.confirmationChannel, 'ask_user');
  assert.match(prepared.confirmationText, /ask_user approved/i);
  assert.doesNotMatch(prepared.confirmationText, /Fallback reason|conversation fallback/i);
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
  const decision = linearWriteGuardDecision(
    {
      confirmedByUser: true,
      dryRun: false,
      confirmationText: 'ask_user approved the exact dry-run plan',
      confirmationChannel: 'ask_user'
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
  assert.match(decision.message, /ask_user/i);
}

{
  const decision = linearWriteGuardDecision(
    { confirmedByUser: false, dryRun: false, confirmationChannel: 'ask_user' },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.equal(decision.action, 'block');
  assert.match(decision.message, /final approval state/i);
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
assert.match(adminTools, /ask_user exactly once/i);
assert.match(adminTools, /current conversation text fallback/i);
assert.match(adminTools, /pi_ask_user is project-selection\/repo-map only/i);
assert.match(adminTools, /interactive confirmation unavailable; real write not applied/i);
assert.doesNotMatch(adminTools, /type .*确认执行/i);

console.log('write confirmation UX tests passed');
