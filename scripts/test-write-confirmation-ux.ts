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
      confirmationText: ''
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
      confirmationText: 'Fallback reason: Generic ask_user is unavailable; pi_ask_user is repo-map only. User approval: 用户回复确认。 Write plan: plan.json. Idempotency key: key.',
      confirmationChannel: 'conversation_fallback'
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
    { confirmedByUser: true, dryRun: false, confirmationText: '用户回复确认。', confirmationChannel: 'conversation_fallback' },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.deepEqual(decision, { action: 'allow' });
}

{
  const decision = linearWriteGuardDecision(
    { confirmedByUser: true, dryRun: false, confirmationText: '', confirmationChannel: 'conversation_fallback' },
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
assert.match(adminTools, /current conversation explicit approval fallback/i);
assert.match(adminTools, /pi_ask_user is repo-map only/i);
assert.doesNotMatch(adminTools, /type .*确认执行/i);

console.log('write confirmation UX tests passed');
