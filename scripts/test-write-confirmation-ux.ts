import assert from 'node:assert/strict';
import fs from 'node:fs';
import { linearWriteGuardDecision } from '../.pi/extensions/linear-write-guard.ts';

{
  const decision = linearWriteGuardDecision(
    { confirmedByUser: true, dryRun: false, confirmationText: 'ask_user approved the exact dry-run plan' },
    { ALLOW_LINEAR_WRITES: 'true' }
  );
  assert.deepEqual(decision, { action: 'allow' });
}

{
  const decision = linearWriteGuardDecision(
    { confirmedByUser: true, dryRun: false, confirmationText: 'ask_user approved the exact dry-run plan' },
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

const adminTools = fs.readFileSync('.pi/extensions/linear-admin-tools.ts', 'utf8');
assert.match(adminTools, /ask_user exactly once/i);
assert.doesNotMatch(adminTools, /type .*确认执行/i);

console.log('write confirmation UX tests passed');
