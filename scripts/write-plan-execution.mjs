export function resolveApplyMode({ mode, cliDryRun, cliConfirmed, allow, plan }) {
  const planConfirmed = plan.confirmedByUser === true;
  const confirmed = cliConfirmed || planConfirmed;
  const modeDryRun = mode === 'dry-run';
  const cliConfirmedOverride = cliConfirmed && !cliDryRun && !modeDryRun && allow;
  const planDryRun = plan.dryRun !== false;
  const dryRun = cliDryRun || modeDryRun || !allow || !confirmed || (planDryRun && !cliConfirmedOverride);

  return {
    dryRun,
    effectivePlan: !dryRun && cliConfirmed
      ? { ...plan, dryRun: false, confirmedByUser: true }
      : plan,
    reason: {
      cliDryRun,
      modeDryRun,
      planDryRun,
      confirmed,
      allow,
      cliConfirmedOverride
    }
  };
}
