function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function detectHostConfirmationCapabilities(env = process.env, cwd = process.cwd()) {
  return {
    askUserAvailable: env.GENERIC_ASK_USER_AVAILABLE === 'true' || env.ASK_USER_AVAILABLE === 'true',
    piAskUserAvailable: env.PI_ASK_USER_AVAILABLE === 'false'
      ? false
      : true,
    conversationFallbackAllowed: env.CONVERSATION_APPROVAL_FALLBACK !== 'false',
    cwd
  };
}

export function resolveConfirmationChannel({ hostCapabilities = {} } = {}) {
  const askUserAvailable = hostCapabilities.askUserAvailable === true;
  const piAskUserAvailable = hostCapabilities.piAskUserAvailable === true;
  const conversationFallbackAllowed = hostCapabilities.conversationFallbackAllowed !== false;

  if (askUserAvailable) {
    return {
      channel: 'ask_user',
      label: 'ask_user approve/cancel',
      canApplyAfterExplicitApproval: true,
      fallbackReason: null,
      userPrompt:
        'Trigger one ask_user approve/cancel UI for the exact dry-run write plan before real apply.'
    };
  }

  if (conversationFallbackAllowed) {
    return {
      channel: 'conversation_fallback',
      label: 'current conversation explicit approval fallback',
      canApplyAfterExplicitApproval: true,
      fallbackReason: piAskUserAvailable
        ? 'Generic ask_user is unavailable; pi_ask_user is project-selection/repo-map only and cannot be used for Linear write confirmation.'
        : 'Generic ask_user is unavailable in this host.',
      userPrompt:
        'Generic ask_user is unavailable; tell the user that one explicit approval in the current conversation will be used as the confirmation source.'
    };
  }

  return {
    channel: 'unavailable',
    label: 'not writable until ask_user or explicit conversation approval is available',
    canApplyAfterExplicitApproval: false,
    fallbackReason: 'No generic ask_user is available and current-conversation fallback is disabled.',
    userPrompt:
      'Real apply is blocked until ask_user or an explicit current-conversation approval fallback is available.'
  };
}

export function buildConfirmationRecord({ channel, confirmationText, writePlanPath, idempotencyKey }) {
  const userApproval = clean(confirmationText);
  const planPath = clean(writePlanPath) || '(unknown write plan path)';
  const key = clean(idempotencyKey) || '(missing idempotencyKey)';

  if (channel.channel === 'conversation_fallback') {
    return {
      confirmationChannel: 'conversation_fallback',
      confirmationFallbackReason: channel.fallbackReason,
      confirmationText: [
        `Fallback reason: ${channel.fallbackReason}`,
        `User approval: ${userApproval || '(missing explicit current-conversation approval text)'}`,
        `Write plan: ${planPath}`,
        `Idempotency key: ${key}`
      ].join('\n')
    };
  }

  if (channel.channel === 'ask_user') {
    return {
      confirmationChannel: 'ask_user',
      confirmationFallbackReason: null,
      confirmationText: [
        'Confirmation channel: ask_user approve/cancel UI.',
        `User approval: ${userApproval || 'ask_user approved the exact dry-run write plan.'}`,
        `Write plan: ${planPath}`,
        `Idempotency key: ${key}`
      ].join('\n')
    };
  }

  return {
    confirmationChannel: 'unavailable',
    confirmationFallbackReason: channel.fallbackReason,
    confirmationText: [
      `Confirmation unavailable: ${channel.fallbackReason}`,
      `Write plan: ${planPath}`,
      `Idempotency key: ${key}`
    ].join('\n')
  };
}

export function resolveApplyMode({ mode, cliDryRun, cliConfirmed, allow, plan, hostCapabilities, confirmationText, writePlanPath }) {
  const planConfirmed = plan.confirmedByUser === true;
  const confirmed = cliConfirmed || planConfirmed;
  const modeDryRun = mode === 'dry-run';
  const cliConfirmedOverride = cliConfirmed && !cliDryRun && !modeDryRun && allow;
  const planDryRun = plan.dryRun !== false;
  const channel = resolveConfirmationChannel({ hostCapabilities });
  const dryRun = cliDryRun || modeDryRun || !allow || !confirmed || !channel.canApplyAfterExplicitApproval || (planDryRun && !cliConfirmedOverride);
  const baseEffectivePlan = !dryRun && cliConfirmed
    ? { ...plan, dryRun: false, confirmedByUser: true }
    : plan;
  const confirmation = !dryRun
    ? buildConfirmationRecord({
        channel,
        confirmationText: confirmationText || baseEffectivePlan.confirmationText,
        writePlanPath,
        idempotencyKey: baseEffectivePlan.idempotencyKey
      })
    : {};

  return {
    dryRun,
    effectivePlan: !dryRun
      ? { ...baseEffectivePlan, ...confirmation }
      : baseEffectivePlan,
    reason: {
      cliDryRun,
      modeDryRun,
      planDryRun,
      confirmed,
      allow,
      cliConfirmedOverride,
      confirmationChannel: channel
    }
  };
}
