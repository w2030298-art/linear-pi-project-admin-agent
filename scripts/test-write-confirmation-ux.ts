import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { prepareWriteConfirmation } from '../.pi/extensions/linear-admin-tools.ts';
import { linearWriteGuardDecision } from '../.pi/extensions/linear-write-guard.ts';
import { runPlanConfirmationFlow, runWriteConfirmationFlow } from '../.pi/extensions/pi-ask-user.ts';
import {
  consumeWriteConfirmationArtifact,
  registerWriteConfirmationArtifact,
  resetWriteConfirmationArtifactsForTests,
  WRITE_CONFIRMATION_UI_TITLE
} from './write-confirmation-artifact.ts';

process.env.LINEAR_APPROVAL_PRIVATE_KEY = 'test-private-key';
resetWriteConfirmationArtifactsForTests();

{
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-confirmation-artifacts-'));
  const storePath = path.join(storeDir, 'artifacts.json');
  const previousStorePath = process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH;
  process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH = storePath;
  resetWriteConfirmationArtifactsForTests();

  const register = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      [
        "import { registerWriteConfirmationArtifact } from './scripts/write-confirmation-artifact.ts';",
        "registerWriteConfirmationArtifact({",
        "  writePlanPath: 'state/write-plans/cross-process.json',",
        "  idempotencyKey: 'cross-process-key',",
        "  confirmationId: 'cross-process-confirmation',",
        "  confirmationText: 'cross process approval'",
        "});"
      ].join('\n')
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, WRITE_CONFIRMATION_ARTIFACT_STORE_PATH: storePath, LINEAR_APPROVAL_PRIVATE_KEY: 'test-private-key' },
      encoding: 'utf8'
    }
  );
  assert.equal(register.status, 0, register.stderr || register.stdout);
  resetWriteConfirmationArtifactsForTests({ preserveStore: true });

  const prepared = await prepareWriteConfirmation(
    {},
    {
      dryRun: false,
      writePlanPath: 'state/write-plans/cross-process.json',
      idempotencyKey: 'cross-process-key',
      confirmationId: 'cross-process-confirmation',
      confirmedByUser: true,
      confirmationChannel: 'ask_user',
      confirmationText: 'cross process approval'
    }
  );
  assert.equal(prepared.confirmationChannel, 'ask_user');
  assert.equal(prepared.confirmationId, 'cross-process-confirmation');

  const allowedBeforeCliConsume = linearWriteGuardDecision({
    dryRun: false,
    writePlanPath: 'state/write-plans/cross-process.json',
    idempotencyKey: 'cross-process-key',
    confirmationId: 'cross-process-confirmation',
    confirmedByUser: true,
    confirmationChannel: 'ask_user',
    confirmationText: 'cross process approval'
  });
  assert.deepEqual(allowedBeforeCliConsume, { action: 'allow' });

  const consumed = consumeWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/cross-process.json',
    idempotencyKey: 'cross-process-key',
    confirmationId: 'cross-process-confirmation',
    confirmationText: 'cross process approval'
  });
  assert.equal(consumed.ok, true);

  const reused = linearWriteGuardDecision({
    dryRun: false,
    writePlanPath: 'state/write-plans/cross-process.json',
    idempotencyKey: 'cross-process-key',
    confirmationId: 'cross-process-confirmation',
    confirmedByUser: true,
    confirmationChannel: 'ask_user',
    confirmationText: 'cross process approval'
  });
  assert.equal(reused.action, 'block');
  assert.match(reused.message, /already consumed/i);

  if (previousStorePath === undefined) delete process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH;
  else process.env.WRITE_CONFIRMATION_ARTIFACT_STORE_PATH = previousStorePath;
  fs.rmSync(storeDir, { recursive: true, force: true });
  resetWriteConfirmationArtifactsForTests();
}

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
    }
  );
  assert.equal(confirmCalls, 1);
  assert.equal(approved.ok, true);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approved, true);
  assert.equal(approved.approvalArtifact?.confirmationChannel, 'ask_user');
  assert.equal(approved.approvalArtifact?.approvalKind, 'write_confirmation');
  assert.equal(approved.approvalArtifact?.storage?.persisted, true);
  assert.match(approved.approvalArtifact?.storage?.path || '', /write-confirmation-artifacts/i);
  assert.match(approved.approvalArtifact?.source?.sourcePath || '', /write-confirmation-artifact\.ts$/);
  assert.match(approved.approvalArtifact?.source?.packageRoot || '', /linear-pi-project-admin-agent/);
  assert.ok(approved.approvalArtifact?.source?.runtimeCwd);
  assert.equal(approved.artifactStorage?.persisted, true);
  assert.deepEqual(approved.artifactBinding, {
    writePlanPath: 'state/write-plans/test.json',
    idempotencyKey: 'plan-key-1',
    confirmationId: approved.confirmationId
  });
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
  const selected: string[] = [];
  const approved = await runPlanConfirmationFlow(
    {
      hasUI: true,
      ui: {
        async input() { return undefined; },
        async select(title: string, options: string[]) {
          selected.push(title, ...options);
          return 'Yes';
        }
      }
    },
    {
      writePlanPath: 'state/write-plans/plan-confirm.json',
      idempotencyKey: 'plan-confirm-key',
      targetProjectSummary: 'Demo Project (proj-1)',
      operationsSummary: '1 issue.update',
      risksSummary: 'No destructive mutation',
      nonChangesSummary: 'No repo-map change',
    }
  );
  assert.equal(approved.ok, true);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approved, true);
  assert.equal(approved.approvalArtifact?.approvalKind, 'plan_confirmation');
  assert.match(approved.confirmationText, /User approved exact Linear write plan during planning via Pi UI/i);
  assert.deepEqual(approved.artifactBinding, {
    writePlanPath: 'state/write-plans/plan-confirm.json',
    idempotencyKey: 'plan-confirm-key',
    confirmationId: approved.confirmationId
  });
  assert.ok(selected.includes('Yes'));
  assert.ok(selected.includes('No'));
  assert.ok(selected.includes('调整意见'));

  const guard = linearWriteGuardDecision({
    dryRun: false,
    writePlanPath: 'state/write-plans/plan-confirm.json',
    idempotencyKey: 'plan-confirm-key',
    confirmationId: approved.confirmationId,
    confirmedByUser: true,
    confirmationChannel: 'ask_user',
    confirmationText: approved.confirmationText
  });
  assert.deepEqual(guard, { action: 'allow' });
}

{
  resetWriteConfirmationArtifactsForTests();
  const cancelled = await runPlanConfirmationFlow(
    {
      hasUI: true,
      ui: {
        async input() { return undefined; },
        async select() { return 'No'; }
      }
    },
    {
      writePlanPath: 'state/write-plans/plan-no.json',
      idempotencyKey: 'plan-no-key'
    }
  );
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.approved, false);

  const blocked = linearWriteGuardDecision({
    dryRun: false,
    writePlanPath: 'state/write-plans/plan-no.json',
    idempotencyKey: 'plan-no-key',
    confirmedByUser: true,
    confirmationChannel: 'ask_user',
    confirmationText: 'stale approval'
  });
  assert.equal(blocked.action, 'block');
  assert.match(blocked.message, /flow=plan_confirmation/i);
}

{
  resetWriteConfirmationArtifactsForTests();
  const revision = await runPlanConfirmationFlow(
    {
      hasUI: true,
      ui: {
        async input(title: string) {
          assert.match(title, /调整意见|Adjustment/i);
          return 'Split issue creation into two operations.';
        },
        async select() { return '调整意见'; }
      }
    },
    {
      writePlanPath: 'state/write-plans/plan-revision-a.json',
      idempotencyKey: 'plan-revision-key-a'
    }
  );
  assert.equal(revision.ok, false);
  assert.equal(revision.status, 'revision_requested');
  assert.equal(revision.approved, false);
  assert.equal(revision.feedback, 'Split issue creation into two operations.');
  assert.match(revision.nextActions?.[0] || '', /rewrite/i);

  const approvedAfterRevision = await runPlanConfirmationFlow(
    {
      hasUI: true,
      ui: {
        async input() { return undefined; },
        async select() { return 'Yes'; }
      }
    },
    {
      writePlanPath: 'state/write-plans/plan-revision-b.json',
      idempotencyKey: 'plan-revision-key-b',
    }
  );
  assert.equal(approvedAfterRevision.ok, true);
  assert.equal(approvedAfterRevision.status, 'approved');
  assert.equal(approvedAfterRevision.approvalArtifact?.approvalKind, 'plan_confirmation');
}

{
  const unavailable = await runPlanConfirmationFlow(
    { hasUI: false, ui: { async input() { return undefined; } } },
    {
      writePlanPath: 'state/write-plans/plan-no-ui.json',
      idempotencyKey: 'plan-no-ui-key'
    }
  );
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.status, 'interactive_confirmation_unavailable');
  assert.match(unavailable.evidenceGaps?.[0] || '', /plan_confirmation/i);
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
    /No active pi_ask_user approval/i
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
    /already_used.*already consumed/i
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
    /expired.*Re-run dry-run/i
  );
}

{
  resetWriteConfirmationArtifactsForTests();
  registerWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/mismatch.json',
    idempotencyKey: 'mismatch-key',
    confirmationText: 'approved text-a'
  });

  const mismatch = consumeWriteConfirmationArtifact({
    writePlanPath: 'state/write-plans/mismatch.json',
    idempotencyKey: 'mismatch-key',
    confirmationText: 'approved text-b'
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'confirmation_text_mismatch');
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
  assert.match(decision.message, /plan_confirmation/i);
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
assert.match(adminTools, /plan_confirmation/i);
assert.doesNotMatch(adminTools, /genericAskUser|ctx\.ui\.confirm/i);
assert.match(askUserTool, /WRITE_CONFIRMATION_UI_TITLE/);
assert.match(guardSource, /validateWriteConfirmationArtifact/);
assert.doesNotMatch(guardSource, /confirm\(/i);

console.log('write confirmation UX tests passed');
