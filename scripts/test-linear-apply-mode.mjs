#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveApplyMode } from './write-plan-execution.mjs';

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
    cliDryRun: true,
    cliConfirmed: true,
    allow: true,
    plan: { dryRun: false, confirmedByUser: true }
  });
  assert.equal(decision.dryRun, true);
  assert.equal(decision.reason.cliDryRun, true);
}

console.log('linear apply mode tests passed');
